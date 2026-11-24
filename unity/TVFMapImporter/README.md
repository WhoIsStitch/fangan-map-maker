# TVF Map Importer (Unity)

Turns a Map Maker export into a walkable level in the Unity project: floors, walls, ceilings, doors that slide open, stairs, lights, props and markers for the game to use.

## Install

1. Copy this whole `TVFMapImporter` folder into the Unity project at `Assets/TVF/`, so you end up with `Assets/TVF/TVFMapImporter/Runtime` and `Assets/TVF/TVFMapImporter/Editor`.
2. Wait for Unity to finish compiling. A new menu appears: **TVF → Map Maker → Import Map...**

Nothing else is needed. It uses the built-in render pipeline's Standard shader, like the rest of the project.

## Import a map

1. In the Map Maker, use **Export → For Unity**. This saves a `*.tvfmap-unity.json` file.
2. In Unity, open the scene you want the map in.
3. Choose **TVF → Map Maker → Import Map...** and pick the file.
4. Pick what to build: **All maps** or a single floor.
5. Leave the materials empty to use the defaults. They are created once in `Assets/TVF/Materials/MapMaker/`, and you can edit them there. You can also drag in your own materials.
6. Choose your options:
   - **Generate colliders**: lets you walk on floors and stops you walking through walls, doors and props.
   - **Generate ceilings**: adds a ceiling to every room that has "ceiling" ticked (never outdoors).
   - **Use room colours**: tints floors and walls with each room's 3D colours. Each colour gets its own material in `Materials/MapMaker/Colours/`.
   - **Labels as floor text**: writes the map labels on the floor.
   - **Prop prefab folder**: a prop whose prefab name is `Vending Machine` spawns `Vending Machine.prefab` from this folder. If no prefab matches, you get a pink placeholder box of the right size.
   - **Player tag**: how doors and triggers recognise the player. If nothing has the tag, they use the CharacterController that carries the main camera, which is how the current exploration scene is set up.
7. Click **Build map in scene**. You get one object called `TVF Map – <project name>` with one child per floor, each made up of `Rooms`, `Walls`, `Doors`, `Stairs`, `Markers` and `Labels`.

Undo (Ctrl+Z) reverses a whole import in one step.

### Importing again after editing the map

Export again and click **Update map in scene**. Everything is matched by its Map Maker id, so:

- Objects you referenced from other scripts stay the same object, with the same components and inspector settings, such as events you hooked up on a trigger.
- Only the `Generated` child of each element is rebuilt, along with each floor's `Walls` group. **Don't put your own things inside `Generated` or `Walls`.** Put them next to them instead.
- Anything deleted in the Map Maker is deleted in the scene too.
- Objects you added yourself (with no `MapElement` component) are left alone.

## What each part does

| In the scene | Component | Notes |
|---|---|---|
| Every room, door, stairs, marker and label | `MapElement` | Stores the id and the "exists when" condition. In Play Mode it hides itself (renderers, colliders, lights) when the condition is false. |
| Doors | `MapDoor` | Slides open when the player is close, unless locked. `TryUse()` returns the lock message ("" when unlocked). A door unlocks when its `unlockFlag` is set. |
| Stairs | `MapStairs` | Steps and a smooth ramp going up. Going down, it shows a dark stairwell patch instead. If linked, reaching the end takes you to the other floor. |
| Markers | `MapMarker` | Holds every marker field. `npc`, `fte`, `spawn` and `camera` markers are empty points for the game to use. `light` markers make a point light. `prop` markers spawn a prefab. `trigger` markers fire `onTriggered` when you walk in (only the first time if `once` is ticked). `portal` markers take you along their link. |

## Hooking it into ExplorationController

**Story state.** Conditions read from `MapState`. Set it when the story moves on, and every map element updates itself:

```csharp
MapState.Set(1, 0);                   // chapter 1, time slot 0: indexes into the export's "chapters" and "times" lists
MapState.SetFlag("flag_pool_open");   // flag ids, not names
MapState.SetFlag("flag_pool_open", false);
```

**Starting position.** Put Stitch on the start floor's spawn marker. The project root's `MapElement.mapId` holds the export's `startMapId`.

```csharp
var root = GameObject.Find("TVF Map – My project").GetComponent<MapElement>();
MapLinkTraveller.PlaceAtSpawn(root.mapId, transform);   // in ExplorationController.Start()
```

**Travelling.** Linked doors, stairs and portals move the player on their own. To send the player somewhere from code:

```csharp
MapLinkTraveller.TravelTo("map_2f", "stairs_main", transform);
MapLinkTraveller.Travelled += target => Debug.Log("Now on " + MapLinkTraveller.CurrentMapId);
```

It switches the CharacterController off while it moves the player, so the move always works.

**Remove the test bounds.** `ExplorationController.Update()` clamps the player to ±18 units ("Bound movement to the test plane"). Delete those lines, or the player can't reach most of a real map.

**Interacting with doors, hotspots and evidence.** Next to the existing look raycast, check what you are looking at:

```csharp
var door = hit.collider.GetComponentInParent<MapDoor>();
if (door != null && Input.GetKeyDown(KeyCode.E)) { string msg = door.TryUse(); if (msg != "") ui.SetExploration(msg, "", false); }
var marker = hit.collider.GetComponentInParent<MapMarker>();   // marker.kind == "hotspot" → show marker.text
```

Walk-in trigger boxes (linked doors, stairs, triggers, portals) are put on the built-in **Ignore Raycast** layer. The current look ray uses the layer mask `~0`, which still hits that layer. Change it to `Physics.DefaultRaycastLayers` so that walking-zone boxes don't stand between you and the person you're looking at.

**Characters.** For each `npc` marker, spawn the standee for `marker.characterId` at the marker's position and rotation, as a child of the marker. Then call `GetComponent<MapElement>().Refresh()` so the standee also hides when the marker's condition is false.

**Story events.** Handle every trigger in one place:

```csharp
MapMarker.AnyTriggered += m => Debug.Log($"Trigger {m.eventId} ({m.triggerType})");
```
