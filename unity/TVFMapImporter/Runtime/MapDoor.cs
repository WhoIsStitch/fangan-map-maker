using UnityEngine;

namespace TVF
{
    /// <summary>
    /// An imported door. Slides its panels open while the player is near (unless locked), and sends the player
    /// along its link when they walk through the opening. Locked doors stay shut; TryUse() returns the message to show.
    /// </summary>
    [RequireComponent(typeof(MapElement))]
    public sealed class MapDoor : MonoBehaviour
    {
        public enum Lock { Open, Locked, Sealed, Barred }

        [Tooltip("door | double | opening | shutter")]
        public string style = "door";
        public Lock lockState = Lock.Open;
        [Tooltip("Shown when the player tries a locked door. Empty = a default line for the lock type.")]
        [TextArea] public string lockMessage = "";
        [Tooltip("Story flag id that unlocks this door once set.")]
        public string unlockFlag = "";
        public Link link = new Link();
        public float width = 1.36f, height = 2.99f;

        [Header("Opening")]
        [Tooltip("The player is found by this tag; if nothing has it, the CharacterController carrying the main camera.")]
        public string playerTag = "Player";
        [Tooltip("Opens when the player is closer than this (units, measured on the floor).")]
        public float openDistance = 2.2f;
        [Tooltip("Seconds to open or close fully.")]
        public float openTime = .35f;
        [Tooltip("Moving parts and how far each slides when fully open (local to its parent).")]
        public Transform[] panels = new Transform[0];
        public Vector3[] panelOpenOffsets = new Vector3[0];

        public bool IsLocked => lockState != Lock.Open && !MapState.HasFlag(unlockFlag);
        public bool HasLink => link != null && link.IsSet;
        /// <summary>0 = shut, 1 = fully open.</summary>
        public float OpenAmount { get; private set; }

        MapElement element;
        Vector3[] closedPositions = new Vector3[0];

        void Awake()
        {
            element = GetComponent<MapElement>();
            closedPositions = new Vector3[panels.Length];
            for (int i = 0; i < panels.Length; i++)
                if (panels[i] != null) closedPositions[i] = panels[i].localPosition;
        }

        /// <summary>
        /// Call when the player interacts with the door. Returns the lock message when locked ("" otherwise);
        /// an unlocked linked door also takes the player through.
        /// </summary>
        public string TryUse()
        {
            if (IsLocked) return LockMessage;
            if (HasLink) MapLinkTraveller.TravelTo(link, MapLinkTraveller.FindPlayer(playerTag), element != null ? element.mapId : "");
            return "";
        }

        public string LockMessage
        {
            get
            {
                if (!string.IsNullOrEmpty(lockMessage)) return lockMessage;
                switch (lockState)
                {
                    case Lock.Locked: return "It's locked.";
                    case Lock.Sealed: return "It's sealed shut.";
                    case Lock.Barred: return "It's barred. It won't budge.";
                    default: return "";
                }
            }
        }

        public static Lock ParseLock(string value)
        {
            switch (value)
            {
                case "locked": return Lock.Locked;
                case "sealed": return Lock.Sealed;
                case "barred": return Lock.Barred;
                default: return Lock.Open;
            }
        }

        void Update()
        {
            if (panels.Length == 0) return;
            bool wantOpen = false;
            if (!IsLocked && (element == null || element.Visible))
            {
                var player = MapLinkTraveller.FindPlayer(playerTag);
                if (player != null)
                {
                    Vector3 offset = player.position - transform.position;
                    offset.y = 0;
                    wantOpen = offset.sqrMagnitude < openDistance * openDistance;
                }
            }
            float before = OpenAmount;
            OpenAmount = Mathf.MoveTowards(OpenAmount, wantOpen ? 1 : 0, Time.deltaTime / Mathf.Max(.01f, openTime));
            if (Mathf.Approximately(before, OpenAmount)) return;
            float eased = Mathf.SmoothStep(0, 1, OpenAmount);
            for (int i = 0; i < panels.Length && i < closedPositions.Length; i++)
            {
                if (panels[i] == null) continue;
                Vector3 slide = i < panelOpenOffsets.Length ? panelOpenOffsets[i] : Vector3.zero;
                panels[i].localPosition = closedPositions[i] + slide * eased;
            }
        }

        void OnTriggerEnter(Collider other)
        {
            if (!HasLink || IsLocked || MapLinkTraveller.IsBlocked) return;
            if (element != null && !element.Visible) return;
            if (MapLinkTraveller.IsPlayer(other, playerTag, out var player))
                MapLinkTraveller.TravelTo(link, player, element != null ? element.mapId : "");
        }
    }
}
