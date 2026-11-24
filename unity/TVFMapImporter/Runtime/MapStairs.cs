using UnityEngine;

namespace TVF
{
    /// <summary>Imported stairs. When linked, reaching the far end (the trigger box on this object) takes the player along the link.</summary>
    [RequireComponent(typeof(MapElement))]
    public sealed class MapStairs : MonoBehaviour
    {
        [Tooltip("up | down")]
        public string goes = "up";
        [Tooltip("Height the flight climbs, in units (from the linked floor's elevation, else the wall height).")]
        public float rise;
        public Link link = new Link();
        public string playerTag = "Player";

        public bool HasLink => link != null && link.IsSet;

        void OnTriggerEnter(Collider other)
        {
            if (!HasLink || MapLinkTraveller.IsBlocked) return;
            var element = GetComponent<MapElement>();
            if (element != null && !element.Visible) return;
            if (MapLinkTraveller.IsPlayer(other, playerTag, out var player))
                MapLinkTraveller.TravelTo(link, player, element != null ? element.mapId : "");
        }
    }
}
