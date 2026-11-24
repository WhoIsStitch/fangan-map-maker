using System.Collections.Generic;
using UnityEngine;

namespace TVF
{
    /// <summary>
    /// Ties a GameObject to an element of the map export (room, door, stairs, marker, label, map or project).
    /// In Play Mode it shows or hides its renderers, colliders and lights whenever MapState changes, following
    /// <see cref="cond"/>. It never disables its own GameObject, so it can always switch things back on.
    /// The importer finds objects again by <see cref="id"/>, so keep this component when editing imported maps.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class MapElement : MonoBehaviour
    {
        public const string ProjectKind = "project", MapKind = "map", RoomKind = "room", DoorKind = "door",
            StairsKind = "stairs", MarkerKind = "marker", LabelKind = "label";

        [Tooltip("Element id from the Map Maker (room_x, door_x, ...). Used to update this object on re-import.")]
        public string id = "";
        [Tooltip("project | map | room | door | stairs | marker | label")]
        public string kind = "";
        [Tooltip("Id of the map this element belongs to.")]
        public string mapId = "";
        public Cond cond = new Cond();
        [Tooltip("Where a player arriving here through a link is placed, relative to the map (floor) object.")]
        public bool hasArrival;
        public Vector3 arrivalPosition;
        public float arrivalRotY;

        /// <summary>False while the condition hides this element.</summary>
        public bool Visible { get; private set; } = true;

        readonly List<Component> hiddenByMe = new List<Component>();

        void OnEnable()
        {
            MapState.OnChanged += Refresh;
            Refresh();
        }

        void OnDisable() { MapState.OnChanged -= Refresh; }

        /// <summary>Re-checks the condition. Call after adding children at runtime (e.g. a spawned standee).</summary>
        public void Refresh() => SetVisible(MapConditions.IsMet(cond));

        public void SetVisible(bool visible)
        {
            if (visible)
            {
                foreach (var c in hiddenByMe) if (c != null) SetEnabled(c, true);
                hiddenByMe.Clear();
            }
            else
            {
                foreach (var c in OwnedParts())
                    if (IsEnabled(c)) { SetEnabled(c, false); hiddenByMe.Add(c); }
            }
            Visible = visible;
        }

        /// <summary>Renderers, colliders and lights on this object and its children, minus those under another MapElement.</summary>
        IEnumerable<Component> OwnedParts()
        {
            foreach (var c in GetComponentsInChildren<Component>(true))
            {
                if (!(c is Renderer || c is Collider || c is Light)) continue;
                if (c.GetComponentInParent<MapElement>(true) != this) continue;
                yield return c;
            }
        }

        static bool IsEnabled(Component c) =>
            c is Renderer r ? r.enabled : c is Collider col ? col.enabled : c is Behaviour b && b.enabled;

        static void SetEnabled(Component c, bool on)
        {
            if (c is Renderer r) r.enabled = on;
            else if (c is Collider col) col.enabled = on;
            else if (c is Behaviour b) b.enabled = on;
        }

        /// <summary>The map (floor) object this element belongs to, or null.</summary>
        public Transform MapRoot
        {
            get
            {
                for (var t = transform; t != null; t = t.parent)
                {
                    var e = t.GetComponent<MapElement>();
                    if (e != null && e.kind == MapKind) return t;
                }
                return null;
            }
        }

        /// <summary>The arrival point in world space (falls back to this object's own position).</summary>
        public void GetArrival(out Vector3 position, out Quaternion rotation)
        {
            var map = MapRoot;
            if (hasArrival && map != null)
            {
                position = map.TransformPoint(arrivalPosition);
                rotation = map.rotation * Quaternion.Euler(0, arrivalRotY, 0);
            }
            else
            {
                position = transform.position;
                rotation = Quaternion.Euler(0, transform.eulerAngles.y, 0);
            }
        }
    }
}
