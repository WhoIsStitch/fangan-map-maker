using System;
using System.Collections.Generic;
using UnityEngine;

namespace TVF
{
    /// <summary>
    /// Moves the player between linked map elements (doors, stairs, portal markers, rooms), using the arrival point
    /// the Map Maker exported for the target. Linked doors, stairs and portals call this when the player walks
    /// through them; game code can call it too.
    /// </summary>
    public static class MapLinkTraveller
    {
        /// <summary>Optional: imported map roots to search. Empty = search every MapElement in the loaded scenes.</summary>
        public static readonly List<Transform> Roots = new List<Transform>();

        /// <summary>Map the player last travelled to (or was placed on).</summary>
        public static string CurrentMapId { get; private set; } = "";

        /// <summary>Raised after the player arrives at a target.</summary>
        public static event Action<MapElement> Travelled;

        /// <summary>Seconds after a trip during which link triggers ignore the player, so they don't bounce back.</summary>
        public static float Cooldown = .75f;
        static float blockedUntil;
        static Transform cachedPlayer;
        static string cachedTag;

        public static bool IsBlocked => Time.time < blockedUntil;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetForPlayMode()
        {
            Roots.Clear();
            CurrentMapId = "";
            Travelled = null;
            blockedUntil = 0;
            cachedPlayer = null;
            cachedTag = null;
        }

        public static IEnumerable<MapElement> AllElements()
        {
            if (Roots.Count == 0)
            {
                foreach (var e in UnityEngine.Object.FindObjectsByType<MapElement>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                    yield return e;
                yield break;
            }
            foreach (var root in Roots)
                if (root != null)
                    foreach (var e in root.GetComponentsInChildren<MapElement>(true)) yield return e;
        }

        /// <summary>Finds an element by map id and element id. An empty mapId matches any map.</summary>
        public static MapElement Find(string mapId, string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var e in AllElements())
                if (e.id == id && e.kind != MapElement.ProjectKind && (string.IsNullOrEmpty(mapId) || e.mapId == mapId))
                    return e;
            return null;
        }

        /// <summary>Follows a link. An empty link.mapId means "on the map we are leaving" (fromMapId).</summary>
        public static bool TravelTo(Link link, Transform player, string fromMapId = "")
        {
            if (link == null || !link.IsSet) return false;
            return TravelTo(string.IsNullOrEmpty(link.mapId) ? fromMapId : link.mapId, link.targetId, player);
        }

        /// <summary>Moves the player to the arrival point of element targetId on map mapId.</summary>
        public static bool TravelTo(string mapId, string targetId, Transform player)
        {
            if (player == null) player = FindPlayer();
            var target = Find(mapId, targetId);
            if (player == null || target == null)
            {
                Debug.LogWarning($"[TVF Map] Can't travel to '{targetId}' on map '{mapId}': " +
                                 (player == null ? "no player found." : "no imported element has that id."));
                return false;
            }
            target.GetArrival(out var position, out var rotation);
            Place(player, position, rotation);
            CurrentMapId = target.kind == MapElement.MapKind ? target.id : target.mapId;
            blockedUntil = Time.time + Cooldown;
            Travelled?.Invoke(target);
            return true;
        }

        /// <summary>Puts the player on the spawn marker of a map (the first one found), e.g. the project's startMapId.</summary>
        public static bool PlaceAtSpawn(string mapId, Transform player)
        {
            foreach (var e in AllElements())
            {
                if (e.kind != MapElement.MarkerKind || (!string.IsNullOrEmpty(mapId) && e.mapId != mapId)) continue;
                var marker = e.GetComponent<MapMarker>();
                if (marker == null || marker.kind != "spawn") continue;
                return TravelTo(e.mapId, e.id, player);
            }
            return false;
        }

        /// <summary>Teleports safely: a CharacterController is switched off while the transform moves.</summary>
        public static void Place(Transform player, Vector3 position, Quaternion rotation)
        {
            var motor = player.GetComponent<CharacterController>();
            bool wasEnabled = motor != null && motor.enabled;
            if (wasEnabled) motor.enabled = false;
            player.SetPositionAndRotation(position + Vector3.up * .02f, Quaternion.Euler(0, rotation.eulerAngles.y, 0));
            Physics.SyncTransforms();
            if (wasEnabled) motor.enabled = true;
        }

        /// <summary>The object tagged playerTag, else the CharacterController that carries the main camera, else the camera.</summary>
        public static Transform FindPlayer(string playerTag = "Player")
        {
            if (cachedPlayer != null && cachedTag == playerTag) return cachedPlayer;
            cachedTag = playerTag;
            GameObject tagged = null;
            if (!string.IsNullOrEmpty(playerTag))
            {
                try { tagged = GameObject.FindWithTag(playerTag); }
                catch (UnityException) { tagged = null; }   // tag not defined in this project
            }
            if (tagged != null) return cachedPlayer = tagged.transform;
            var cam = Camera.main;
            if (cam == null) return null;
            var motor = cam.GetComponentInParent<CharacterController>();
            return cachedPlayer = motor != null ? motor.transform : cam.transform;
        }

        /// <summary>True when the collider belongs to the player.</summary>
        public static bool IsPlayer(Collider other, string playerTag, out Transform player)
        {
            player = FindPlayer(playerTag);
            var motor = other.GetComponentInParent<CharacterController>();
            var hit = motor != null ? motor.transform : other.attachedRigidbody != null ? other.attachedRigidbody.transform : other.transform;
            if (player == null) { player = hit; return motor != null; }
            return hit == player || hit.IsChildOf(player) || player.IsChildOf(hit);
        }
    }
}
