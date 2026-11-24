# Fangan Map Maker → Unity export format (`*.tvfmap-unity.json`)

The Map Maker writes this file from **Export → For Unity**. It is built so Unity's `JsonUtility` can read it
directly: no `null`s, no dictionaries, no polymorphism. Empty strings and `-1` mean "not set".

All positions inside a map (rooms, walls, doors, markers, `arrival` points…) are **local to that map's root**,
which sits at `(ox, elevation, oz)`. To get a world position, add the map root's position.

All positions and sizes are already in **Unity units** (the project setting `unitsPerMetre`, default 1.36,
has been applied). Unity axes: **X = right, Y = up, Z = north** (up on the 2D map). Rotations (`rotY`) are degrees
clockwise around +Y looking down, 0 = facing +Z (north), the same as `Quaternion.Euler(0, rotY, 0)`.

```jsonc
{
  "format": "tvf-map-unity",
  "version": 1,
  "project": "My project",
  "exportedAt": "2026-11-23T12:00:00Z",
  "unitsPerMetre": 1.36,
  "cellSize": 1.36,          // one grid cell, in Unity units
  "wallHeight": 4.08,        // default wall height
  "doorHeight": 2.99,
  "wallThickness": 0.16,
  "eyeHeight": 1.95,
  "startMapId": "map_xxx",
  "chapters": ["Prologue", "Chapter 1", ...],   // index = chapter number used in conditions
  "times": ["Morning", "Daytime", ...],          // index = time slot used in conditions
  "flags": [{ "id": "flag_x", "name": "pool_open", "desc": "" }],
  "characters": [{ "id": "chr_nina", "name": "Nina", "color": "#ff8fb1" }],
  "evidence": [{ "id": "ev_x", "name": "Cameron's Account", "desc": "" }],
  "maps": [ MapData, ... ]
}
```

### MapData
```jsonc
{
  "id": "map_xxx", "name": "1F", "building": "School", "floor": 1,
  "elevation": 0.0,                 // Y of this floor, Unity units
  "ox": 0.0, "oz": 0.0,             // horizontal offset of this map relative to the others, Unity units
  "rooms":   [ RoomData ],
  "walls":   [ WallData ],
  "doors":   [ DoorData ],
  "stairs":  [ StairsData ],
  "markers": [ MarkerData ],
  "labels":  [ LabelData ]
}
```

### Cond (on every room/door/stairs/marker/label)
```jsonc
{ "chMin": -1, "chMax": -1, "times": [], "flag": "", "notFlag": "" }
```
The object exists only when: `chMin <= currentChapter <= chMax` (each bound ignored when -1),
`times` is empty or contains the current time slot, story flag `flag` is set (when not empty) and
`notFlag` is not set (when not empty). `flag`/`notFlag` hold flag **ids** (see `flags`).

### Link (on doors, stairs, markers)
```jsonc
{ "mapId": "", "targetId": "" }   // empty = no link. targetId is a door/stairs/marker/room id on mapId
```
Arrive at the target's `arrival` point (every door/stairs/marker has one, see below).

### RoomData
```jsonc
{
  "id": "room_x", "name": "Dining Hall",
  "kind": "room",            // room | hall | outdoor | blocked
  "icon": "food",            // built-in icon name or "" ; "asset:<id>" for a custom image
  "characterId": "",         // dorm owner, if any
  "color": "#f4a0a0",        // 2D map colour
  "floorColor": "#d9c7c0",   // 3D floor colour ("" = theme default)
  "wallColor": "",
  "ceiling": true,
  "height": 4.08,            // wall height for this room
  "lighting": "default",     // default | warm | cold | night | blacklight | emergency | crime scene | dark
  "discover": "enter",       // always | enter | flag  (for the in-game map's fog of war)
  "discoverFlag": "",
  "locked": false,           // always locked
  "unlockChapter": -1,       // locked in every chapter before this one (-1 = never chapter-locked)
  "lockMsg": "",             // what to say when the player tries a door into it
  "tags": "",
  "notes": "",
  "cond": Cond,
  "center": { "x": 0, "y": 0, "z": 0 },
  "rects": [ { "cx": 0, "cz": 0, "w": 4.08, "d": 6.8 } ]   // floor pieces: centre + width (X) + depth (Z)
}
```

### WallData
One straight wall piece. Walls are already split around door openings.
```jsonc
{
  "ax": 0, "az": 0, "bx": 4.08, "bz": 0,   // endpoints on the floor
  "base": 0, "height": 4.08,               // relative to the map elevation
  "roomA": "room_x", "roomB": "hall_y"     // rooms on each side ("" = outside). A = north/west side
}
```

### DoorData
```jsonc
{
  "id": "door_x", "name": "", "x": 0, "z": 0,   // centre of the opening, on the floor
  "width": 1.36, "height": 2.99, "rotY": 0,     // rotY 0 = door lies along X (opening faces north/south), 90 = along Z
  "style": "door",          // door | double | opening | shutter
  "lock": "open",           // open | locked | sealed | barred
  "lockMsg": "", "unlockFlag": "",
  "unlockChapter": -1,      // locked before this chapter (also locked if a room it leads into is chapter-locked)
  "roomA": "", "roomB": "", // rooms on each side (A = north/west)
  "link": Link, "cond": Cond,
  "arrival": { "x": 0, "y": 0, "z": 0, "rotY": 0 }  // where to put the player when arriving here via a link
}
```

### StairsData
```jsonc
{
  "id": "stairs_x", "name": "Stairs", "cx": 0, "cz": 0, "w": 2.72, "d": 5.44,
  "rotY": 0,               // direction of travel when walking onto the stairs (0 = north)
  "goes": "up",            // up | down
  "link": Link, "cond": Cond,
  "arrival": { "x": 0, "y": 0, "z": 0, "rotY": 0 }
}
```

### MarkerData
```jsonc
{
  "id": "npc_x", "kind": "npc",  // spawn | npc | hotspot | evidence | prop | light | camera | trigger | portal | fte
  "name": "", "x": 0, "y": 0, "z": 0, "rotY": 0,
  "w": 1.36, "d": 1.36, "height": 1.22,   // size (props, trigger zones)
  "characterId": "", "pose": "",          // npc / fte
  "text": "",                             // examine text (hotspot), message, etc.
  "evidenceId": "", "required": false,    // evidence
  "icon": "", "color": "", "prefab": "",  // prop: prefab name to spawn in Unity
  "lightColor": "#ffe9c4", "intensity": 1, "range": 8.16,
  "triggerType": "", "once": true, "eventId": "",
  "roomId": "",                           // room the marker stands in
  "link": Link, "cond": Cond,
  "arrival": { "x": 0, "y": 0, "z": 0, "rotY": 0 }
}
```
Designer notes (`kind: "note"`) are not exported.

### LabelData
```jsonc
{ "id": "label_x", "text": "Gym", "x": 0, "z": 0, "size": 1, "cond": Cond }
```
