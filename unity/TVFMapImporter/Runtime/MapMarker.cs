using System;
using UnityEngine;
using UnityEngine.Events;

namespace TVF
{
    /// <summary>
    /// An imported marker: spawn point, character spot (npc / fte), hotspot, evidence, prop, light, camera,
    /// trigger zone or portal. Holds everything the Map Maker exported; the game decides what to do with it
    /// (for example, spawning a standee at each npc marker). Trigger and portal markers react when the player
    /// walks into their box.
    /// </summary>
    [RequireComponent(typeof(MapElement))]
    public sealed class MapMarker : MonoBehaviour
    {
        [Tooltip("spawn | npc | hotspot | evidence | prop | light | camera | trigger | portal | fte")]
        public string kind = "";
        [Tooltip("Width (X), height (Y) and depth (Z) of a prop or trigger zone.")]
        public Vector3 size = new Vector3(1.36f, 1.22f, 1.36f);
        [Header("Characters (npc / fte)")]
        public string characterId = "";
        public string pose = "";
        [Header("Examine / evidence")]
        [TextArea] public string text = "";
        public string evidenceId = "";
        public bool required;
        [Header("Props")]
        public string icon = "";
        public string color = "";
        public string prefab = "";
        [Header("Lights")]
        public Color lightColor = new Color(1, .914f, .769f);
        public float intensity = 1;
        public float range = 8.16f;
        [Header("Triggers")]
        public string triggerType = "";
        public string eventId = "";
        [Tooltip("Fire only the first time the player walks in.")]
        public bool once = true;
        public string roomId = "";
        public Link link = new Link();
        public string playerTag = "Player";

        [Tooltip("Fires when the player walks into a trigger or portal marker.")]
        public UnityEvent onTriggered = new UnityEvent();
        /// <summary>Raised for every marker that fires, so game code can handle eventId / triggerType in one place.</summary>
        public static event Action<MapMarker> AnyTriggered;

        public bool HasFired { get; private set; }
        public bool HasLink => link != null && link.IsSet;
        public bool FiresOnEnter => kind == "trigger" || kind == "portal";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetForPlayMode() { AnyTriggered = null; }

        /// <summary>Lets a once-only trigger fire again.</summary>
        public void ResetTrigger() { HasFired = false; }

        /// <summary>Fires the marker as if the player walked in (respects "once"; portals always work).</summary>
        public void Fire(Transform player = null)
        {
            if (once && HasFired && kind != "portal") return;
            HasFired = true;
            onTriggered.Invoke();
            AnyTriggered?.Invoke(this);
            if (HasLink)
            {
                var element = GetComponent<MapElement>();
                MapLinkTraveller.TravelTo(link, player != null ? player : MapLinkTraveller.FindPlayer(playerTag),
                    element != null ? element.mapId : "");
            }
        }

        void OnTriggerEnter(Collider other)
        {
            if (!FiresOnEnter || (HasLink && MapLinkTraveller.IsBlocked)) return;
            var element = GetComponent<MapElement>();
            if (element != null && !element.Visible) return;
            if (MapLinkTraveller.IsPlayer(other, playerTag, out var player)) Fire(player);
        }
    }
}
