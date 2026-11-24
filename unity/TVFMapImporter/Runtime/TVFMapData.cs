using System;

namespace TVF
{
    // Mirrors the Map Maker's "Export → For Unity" file (docs/UNITY-FORMAT.md) field for field, so
    // JsonUtility.FromJson<MapProject>(text) fills it directly. Empty strings and -1 mean "not set".
    // Field initialisers are the defaults used when a field is missing from the file.

    [Serializable]
    public sealed class MapProject
    {
        public string format = "";
        public int version;
        public string project = "";
        public string exportedAt = "";
        public float unitsPerMetre = 1.36f;
        public float cellSize = 1.36f;
        public float wallHeight = 4.08f;
        public float doorHeight = 2.99f;
        public float wallThickness = .16f;
        public float eyeHeight = 1.95f;
        public string startMapId = "";
        public string[] chapters = new string[0];
        public string[] times = new string[0];
        public FlagDef[] flags = new FlagDef[0];
        public CharacterDef[] characters = new CharacterDef[0];
        public EvidenceDef[] evidence = new EvidenceDef[0];
        public MapData[] maps = new MapData[0];

        public const string Format = "tvf-map-unity";

        public MapData FindMap(string id) => Array.Find(maps ?? new MapData[0], m => m != null && m.id == id);
    }

    [Serializable] public sealed class FlagDef { public string id = "", name = "", desc = ""; }
    [Serializable] public sealed class CharacterDef { public string id = "", name = "", color = ""; }
    [Serializable] public sealed class EvidenceDef { public string id = "", name = "", desc = ""; }

    [Serializable]
    public sealed class MapData
    {
        public string id = "";
        public string name = "";
        public string building = "";
        public int floor;
        public float elevation;           // Y of this floor
        public float ox, oz;              // horizontal offset of this map relative to the others
        public RoomData[] rooms = new RoomData[0];
        public WallData[] walls = new WallData[0];
        public DoorData[] doors = new DoorData[0];
        public StairsData[] stairs = new StairsData[0];
        public MarkerData[] markers = new MarkerData[0];
        public LabelData[] labels = new LabelData[0];

        public RoomData FindRoom(string roomId) =>
            string.IsNullOrEmpty(roomId) ? null : Array.Find(rooms ?? new RoomData[0], r => r != null && r.id == roomId);
    }

    /// <summary>When an object exists. See MapConditions.IsMet.</summary>
    [Serializable]
    public sealed class Cond
    {
        public int chMin = -1;
        public int chMax = -1;
        public int[] times = new int[0];
        public string flag = "";
        public string notFlag = "";

        public bool IsAlways => chMin < 0 && chMax < 0 && (times == null || times.Length == 0)
                                && string.IsNullOrEmpty(flag) && string.IsNullOrEmpty(notFlag);
    }

    /// <summary>A link to another element. Empty targetId = no link.</summary>
    [Serializable]
    public sealed class Link
    {
        public string mapId = "";
        public string targetId = "";

        public bool IsSet => !string.IsNullOrEmpty(targetId);
    }

    [Serializable] public sealed class Vec { public float x, y, z; }

    [Serializable] public sealed class Arrival { public float x, y, z, rotY; }

    [Serializable] public sealed class RectData { public float cx, cz, w, d; }

    [Serializable]
    public sealed class RoomData
    {
        public string id = "";
        public string name = "";
        public string kind = "room";        // room | hall | outdoor | blocked
        public string icon = "";
        public string characterId = "";
        public string color = "";
        public string floorColor = "";
        public string wallColor = "";
        public bool ceiling = true;
        public float height = 4.08f;
        public string lighting = "default";
        public string discover = "enter";   // always | enter | flag
        public string discoverFlag = "";
        public bool locked;
        public string tags = "";
        public string notes = "";
        public Cond cond = new Cond();
        public Vec center = new Vec();
        public RectData[] rects = new RectData[0];
    }

    [Serializable]
    public sealed class WallData
    {
        public float ax, az, bx, bz;
        public float @base;
        public float height = 4.08f;
        public string roomA = "";   // north / west side
        public string roomB = "";
    }

    [Serializable]
    public sealed class DoorData
    {
        public string id = "";
        public string name = "";
        public float x, z;
        public float width = 1.36f;
        public float height = 2.99f;
        public float rotY;
        public string style = "door";   // door | double | opening | shutter
        public string @lock = "open";   // open | locked | sealed | barred
        public string lockMsg = "";
        public string unlockFlag = "";
        public string roomA = "", roomB = "";
        public Link link = new Link();
        public Cond cond = new Cond();
        public Arrival arrival = new Arrival();
    }

    [Serializable]
    public sealed class StairsData
    {
        public string id = "";
        public string name = "";
        public float cx, cz;
        public float w = 2.72f, d = 5.44f;
        public float rotY;
        public string goes = "up";      // up | down
        public Link link = new Link();
        public Cond cond = new Cond();
        public Arrival arrival = new Arrival();
    }

    [Serializable]
    public sealed class MarkerData
    {
        public string id = "";
        public string kind = "";        // spawn | npc | hotspot | evidence | prop | light | camera | trigger | portal | fte
        public string name = "";
        public float x, y, z, rotY;
        public float w = 1.36f, d = 1.36f, height = 1.22f;
        public string characterId = "";
        public string pose = "";
        public string text = "";
        public string evidenceId = "";
        public bool required;
        public string icon = "";
        public string color = "";
        public string prefab = "";
        public string lightColor = "#ffe9c4";
        public float intensity = 1;
        public float range = 8.16f;
        public string triggerType = "";
        public bool once = true;
        public string eventId = "";
        public string roomId = "";
        public Link link = new Link();
        public Cond cond = new Cond();
        public Arrival arrival = new Arrival();
    }

    [Serializable]
    public sealed class LabelData
    {
        public string id = "";
        public string text = "";
        public float x, z;
        public float size = 1;
        public Cond cond = new Cond();
    }
}
