using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace TVF.Editor
{
    /// <summary>Options for one import (filled in by TVFMapImporterWindow).</summary>
    [Serializable]
    public sealed class MapImportSettings
    {
        public const string MaterialFolder = "Assets/TVF/Materials/MapMaker";

        [Tooltip("Empty = build every map in the file.")]
        public string onlyMapId = "";
        public Material floor, wall, ceiling, blocked, door, stairs, prop;
        public bool generateColliders = true;
        public bool generateCeilings = true;
        [Tooltip("Tint floors and walls with each room's floorColor / wallColor (one material per colour).")]
        public bool useRoomColours = true;
        [Tooltip("Lay each map label on the floor as 3D text.")]
        public bool labelText;
        [Tooltip("Project folder searched for prop prefabs by name, e.g. Assets/TVF/Prefabs.")]
        public string prefabFolder = "";
        public string playerTag = "Player";

        /// <summary>Fills any empty material slot with a default saved under MaterialFolder (created once).</summary>
        public void EnsureDefaultMaterials()
        {
            floor = floor != null ? floor : TVFMapBuilder.DefaultMaterial("MapFloor", new Color(.78f, .74f, .70f), .2f);
            wall = wall != null ? wall : TVFMapBuilder.DefaultMaterial("MapWall", new Color(.86f, .84f, .80f), .05f);
            ceiling = ceiling != null ? ceiling : TVFMapBuilder.DefaultMaterial("MapCeiling", new Color(.92f, .92f, .90f), 0);
            blocked = blocked != null ? blocked : TVFMapBuilder.DefaultMaterial("MapBlocked", new Color(.34f, .34f, .37f), 0);
            door = door != null ? door : TVFMapBuilder.DefaultMaterial("MapDoor", new Color(.45f, .31f, .22f), .3f);
            stairs = stairs != null ? stairs : TVFMapBuilder.DefaultMaterial("MapStairs", new Color(.62f, .60f, .57f), .15f);
            prop = prop != null ? prop : TVFMapBuilder.DefaultMaterial("MapPropPlaceholder", new Color(.85f, .35f, .75f), .1f);
        }
    }

    /// <summary>
    /// Builds (or updates in place) the scene objects for a MapProject. Elements are matched by MapElement.id, so
    /// objects, components and inspector references survive a re-import; only each element's "Generated" child and
    /// each map's "Walls" group are rebuilt. Everything is one Undo step.
    /// </summary>
    public sealed class TVFMapBuilder
    {
        const string UndoName = "Import TVF map";
        const string GeneratedName = "Generated";
        const float FloorThickness = .1f;

        readonly MapProject project;
        readonly MapImportSettings settings;
        readonly Dictionary<string, Material> tinted = new Dictionary<string, Material>();
        readonly Dictionary<string, GameObject> prefabs = new Dictionary<string, GameObject>(StringComparer.OrdinalIgnoreCase);
        float thickness;

        public int Built { get; private set; }
        public int Removed { get; private set; }
        public List<string> Warnings { get; } = new List<string>();

        public TVFMapBuilder(MapProject project, MapImportSettings settings)
        {
            this.project = project;
            this.settings = settings;
            settings.EnsureDefaultMaterials();
            thickness = project.wallThickness > 0 ? project.wallThickness : .16f;
        }

        public static string RootName(MapProject p) => "TVF Map – " + (string.IsNullOrEmpty(p.project) ? "Untitled" : p.project);

        // ------------------------------------------------------------------ top level

        public GameObject Build()
        {
            Undo.IncrementCurrentGroup();
            Undo.SetCurrentGroupName(UndoName);
            int group = Undo.GetCurrentGroup();

            var root = FindRoot();
            if (root == null)
            {
                root = new GameObject(RootName(project));
                Undo.RegisterCreatedObjectUndo(root, UndoName);
            }
            else Undo.RegisterFullObjectHierarchyUndo(root, UndoName);
            root.name = RootName(project);
            var rootElement = Ensure<MapElement>(root);
            rootElement.kind = MapElement.ProjectKind;
            rootElement.id = project.project ?? "";
            rootElement.mapId = project.startMapId ?? "";   // the project root carries the start map id
            rootElement.cond = new Cond();

            var existingMaps = ExistingElements(root.transform);
            foreach (var map in project.maps ?? new MapData[0])
            {
                if (map == null || string.IsNullOrEmpty(map.id)) { Warnings.Add("A map without an id was skipped."); continue; }
                if (!string.IsNullOrEmpty(settings.onlyMapId) && settings.onlyMapId != map.id)
                {
                    existingMaps.Remove(map.id);   // not rebuilt this time, but still in the project: keep it
                    continue;
                }
                BuildMap(root.transform, existingMaps, map);
            }
            RemoveLeftovers(existingMaps);

            Undo.CollapseUndoOperations(group);
            return root;
        }

        GameObject FindRoot()
        {
            foreach (var e in UnityEngine.Object.FindObjectsByType<MapElement>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                if (e.kind == MapElement.ProjectKind && e.id == project.project && e.transform.parent == null) return e.gameObject;
            var byName = GameObject.Find(RootName(project));
            return byName != null && byName.transform.parent == null ? byName : null;
        }

        void BuildMap(Transform root, Dictionary<string, MapElement> existingMaps, MapData map)
        {
            var element = GetElement(root, existingMaps, map.id, MapElement.MapKind, map.id);
            element.cond = new Cond();
            element.hasArrival = false;
            var t = element.transform;
            t.name = string.IsNullOrEmpty(map.building) ? map.name : map.building + " " + map.name;
            if (string.IsNullOrWhiteSpace(t.name)) t.name = map.id;
            t.localPosition = new Vector3(map.ox, map.elevation, map.oz);
            t.localRotation = Quaternion.identity;
            t.localScale = Vector3.one;

            Sync(Container(t, "Rooms", 0), map.rooms, r => r.id, MapElement.RoomKind, map.id, (r, e, g) => BuildRoom(map, r, e, g));
            BuildWalls(t, map);
            Sync(Container(t, "Doors", 2), map.doors, d => d.id, MapElement.DoorKind, map.id, (d, e, g) => BuildDoor(map, d, e, g));
            Sync(Container(t, "Stairs", 3), map.stairs, s => s.id, MapElement.StairsKind, map.id, (s, e, g) => BuildStairs(map, s, e, g));
            Sync(Container(t, "Markers", 4), map.markers, m => m.id, MapElement.MarkerKind, map.id, (m, e, g) => BuildMarker(map, m, e, g));
            Sync(Container(t, "Labels", 5), map.labels, l => l.id, MapElement.LabelKind, map.id, (l, e, g) => BuildLabel(l, e, g));
        }

        // ------------------------------------------------------------------ update-in-place plumbing

        /// <summary>Direct children of parent that carry a MapElement, by id.</summary>
        static Dictionary<string, MapElement> ExistingElements(Transform parent)
        {
            var found = new Dictionary<string, MapElement>();
            foreach (Transform child in parent)
            {
                var e = child.GetComponent<MapElement>();
                if (e != null && !string.IsNullOrEmpty(e.id) && !found.ContainsKey(e.id)) found.Add(e.id, e);
            }
            return found;
        }

        void Sync<T>(Transform container, T[] items, Func<T, string> idOf, string kind, string mapId,
            Action<T, MapElement, Transform> build) where T : class
        {
            var existing = ExistingElements(container);
            foreach (var item in items ?? new T[0])
            {
                if (item == null) continue;
                string id = idOf(item);
                if (string.IsNullOrEmpty(id)) { Warnings.Add($"A {kind} without an id was skipped on map {mapId}."); continue; }
                var element = GetElement(container, existing, id, kind, mapId);
                var generated = FreshGenerated(element.transform);
                build(item, element, generated);
                Undo.RegisterCreatedObjectUndo(generated.gameObject, UndoName);
                Built++;
            }
            RemoveLeftovers(existing);
        }

        /// <summary>The existing object for this id (taken out of `existing`), or a new one.</summary>
        MapElement GetElement(Transform parent, Dictionary<string, MapElement> existing, string id, string kind, string mapId)
        {
            MapElement element;
            if (existing.TryGetValue(id, out element) && element != null) existing.Remove(id);
            else
            {
                var go = new GameObject(id);
                Undo.RegisterCreatedObjectUndo(go, UndoName);
                go.transform.SetParent(parent, false);
                element = Undo.AddComponent<MapElement>(go);
            }
            element.id = id;
            element.kind = kind;
            element.mapId = mapId;
            return element;
        }

        void RemoveLeftovers(Dictionary<string, MapElement> leftovers)
        {
            foreach (var e in leftovers.Values)
                if (e != null) { Undo.DestroyObjectImmediate(e.gameObject); Removed++; }
        }

        static Transform FreshGenerated(Transform owner)
        {
            var old = owner.Find(GeneratedName);
            if (old != null) Undo.DestroyObjectImmediate(old.gameObject);
            var go = new GameObject(GeneratedName);
            go.transform.SetParent(owner, false);
            return go.transform;
        }

        static Transform Container(Transform parent, string name, int order)
        {
            var t = parent.Find(name);
            if (t == null)
            {
                var go = new GameObject(name);
                Undo.RegisterCreatedObjectUndo(go, UndoName);
                t = go.transform;
                t.SetParent(parent, false);
            }
            t.SetSiblingIndex(Mathf.Min(order, parent.childCount - 1));
            return t;
        }

        static T Ensure<T>(GameObject go) where T : Component
        {
            var c = go.GetComponent<T>();
            if (c == null) c = Undo.AddComponent<T>(go);
            return c;
        }

        static void Remove<T>(GameObject go) where T : Component
        {
            var c = go.GetComponent<T>();
            if (c != null) Undo.DestroyObjectImmediate(c);
        }

        static void SetArrival(MapElement e, Arrival a)
        {
            e.hasArrival = a != null;
            if (a == null) return;
            e.arrivalPosition = new Vector3(a.x, a.y, a.z);
            e.arrivalRotY = a.rotY;
        }

        static Link Copy(Link l) => new Link { mapId = l != null ? l.mapId ?? "" : "", targetId = l != null ? l.targetId ?? "" : "" };

        // ------------------------------------------------------------------ rooms and walls

        float RoomHeight(RoomData r) => r != null && r.height > 0 ? r.height : project.wallHeight;

        void BuildRoom(MapData map, RoomData r, MapElement e, Transform g)
        {
            e.name = string.IsNullOrEmpty(r.name) ? r.id : r.name;
            e.cond = r.cond ?? new Cond();
            var centre = r.center ?? new Vec();
            e.transform.localPosition = new Vector3(centre.x, 0, centre.z);
            e.transform.localRotation = Quaternion.identity;
            e.hasArrival = true;   // rooms have no arrival point: arrive at the centre, on the floor
            e.arrivalPosition = new Vector3(centre.x, 0, centre.z);
            e.arrivalRotY = 0;

            float height = RoomHeight(r);
            bool solid = r.kind == "blocked";
            var floorMat = Tint(settings.floor, r.floorColor);
            foreach (var rect in r.rects ?? new RectData[0])
            {
                if (rect == null) continue;
                var at = new Vector3(rect.cx - centre.x, 0, rect.cz - centre.z);
                if (solid)
                {
                    Box("Block", g, at + Vector3.up * height * .5f, Quaternion.identity, new Vector3(rect.w, height, rect.d),
                        Tint(settings.blocked, r.wallColor), settings.generateColliders, true);
                    continue;
                }
                Box("Floor", g, at + Vector3.down * FloorThickness * .5f, Quaternion.identity,
                    new Vector3(rect.w, FloorThickness, rect.d), floorMat, settings.generateColliders, true);
                if (settings.generateCeilings && r.ceiling && r.kind != "outdoor")
                    Box("Ceiling", g, at + Vector3.up * (height + FloorThickness * .5f), Quaternion.identity,
                        new Vector3(rect.w, FloorThickness, rect.d), settings.ceiling, false, true);
            }
        }

        Material WallMaterial(MapData map, string roomId)
        {
            var room = map.FindRoom(roomId);
            return room != null ? Tint(settings.wall, room.wallColor) : settings.wall;
        }

        /// <summary>The Walls group has no ids to keep, so it is rebuilt from scratch: wall pieces, door lintels, corner posts.</summary>
        void BuildWalls(Transform mapRoot, MapData map)
        {
            var old = mapRoot.Find("Walls");
            if (old != null) Undo.DestroyObjectImmediate(old.gameObject);
            var walls = new GameObject("Walls").transform;
            walls.SetParent(mapRoot, false);
            walls.SetSiblingIndex(Mathf.Min(1, mapRoot.childCount - 1));

            var ends = new Dictionary<Vector2Int, (int count, float bottom, float top, Vector2 at)>();
            void AddEnd(float x, float z, float bottom, float top)
            {
                var key = new Vector2Int(Mathf.RoundToInt(x * 100), Mathf.RoundToInt(z * 100));
                ends.TryGetValue(key, out var v);
                ends[key] = (v.count + 1, v.count == 0 ? bottom : Mathf.Min(v.bottom, bottom), Mathf.Max(v.top, top), new Vector2(x, z));
            }

            foreach (var w in map.walls ?? new WallData[0])
            {
                if (w == null) continue;
                float dx = w.bx - w.ax, dz = w.bz - w.az, length = Mathf.Sqrt(dx * dx + dz * dz);
                if (length < .001f) continue;
                float height = w.height > 0 ? w.height : project.wallHeight;
                var rotation = Quaternion.Euler(0, Mathf.Atan2(dx, dz) * Mathf.Rad2Deg, 0);
                var mid = new Vector3((w.ax + w.bx) * .5f, w.@base + height * .5f, (w.az + w.bz) * .5f);
                Material a = WallMaterial(map, w.roomA), b = WallMaterial(map, w.roomB);
                if (a == b)
                    Box("Wall", walls, mid, rotation, new Vector3(thickness, height, length), a, settings.generateColliders, true);
                else
                {
                    // Two half-thickness slabs, so each side shows its own room's wall colour.
                    // Side A is north (+Z) for walls running mostly along X, west (-X) for walls running along Z.
                    Vector3 right = rotation * Vector3.right;
                    float sign = Mathf.Abs(dx) >= Mathf.Abs(dz) ? Mathf.Sign(right.z) : -Mathf.Sign(right.x);
                    Vector3 toA = right * sign * thickness * .25f;
                    var half = new Vector3(thickness * .5f, height, length);
                    Box("Wall A", walls, mid + toA, rotation, half, a, settings.generateColliders, true);
                    Box("Wall B", walls, mid - toA, rotation, half, b, settings.generateColliders, true);
                }
                AddEnd(w.ax, w.az, w.@base, w.@base + height);
                AddEnd(w.bx, w.bz, w.@base, w.@base + height);
            }

            // Fill the little square gaps where two or more wall pieces meet.
            foreach (var end in ends.Values)
            {
                if (end.count < 2 || end.top - end.bottom < .01f) continue;
                Box("Corner", walls, new Vector3(end.at.x, (end.bottom + end.top) * .5f, end.at.y), Quaternion.identity,
                    new Vector3(thickness, end.top - end.bottom, thickness), settings.wall, settings.generateColliders, true);
            }

            // A lintel above every door, from the door's height up to the taller of the two rooms.
            foreach (var d in map.doors ?? new DoorData[0])
            {
                if (d == null) continue;
                float doorHeight = d.height > 0 ? d.height : project.doorHeight;
                RoomData ra = map.FindRoom(d.roomA), rb = map.FindRoom(d.roomB);
                float top = ra == null && rb == null ? project.wallHeight : Mathf.Max(ra != null ? RoomHeight(ra) : 0, rb != null ? RoomHeight(rb) : 0);
                if (top - doorHeight < .01f) continue;
                Box("Lintel " + d.id, walls, new Vector3(d.x, (doorHeight + top) * .5f, d.z), Quaternion.Euler(0, d.rotY, 0),
                    new Vector3(d.width, top - doorHeight, thickness), WallMaterial(map, d.roomA), settings.generateColliders, true);
            }
            Undo.RegisterCreatedObjectUndo(walls.gameObject, UndoName);
        }

        // ------------------------------------------------------------------ doors and stairs

        void BuildDoor(MapData map, DoorData d, MapElement e, Transform g)
        {
            e.name = string.IsNullOrEmpty(d.name) ? d.id : d.name;
            e.cond = d.cond ?? new Cond();
            SetArrival(e, d.arrival);
            e.transform.localPosition = new Vector3(d.x, 0, d.z);
            e.transform.localRotation = Quaternion.Euler(0, d.rotY, 0);

            float width = Mathf.Max(.05f, d.width), height = d.height > 0 ? d.height : project.doorHeight;
            var door = Ensure<MapDoor>(e.gameObject);
            door.style = string.IsNullOrEmpty(d.style) ? "door" : d.style;
            door.lockState = MapDoor.ParseLock(d.@lock);
            door.lockMessage = d.lockMsg ?? "";
            door.unlockFlag = d.unlockFlag ?? "";
            door.link = Copy(d.link);
            door.width = width;
            door.height = height;
            door.playerTag = settings.playerTag;

            // Panels: slide sideways into the wall (door / double) or up into the lintel (shutter).
            var panels = new List<Transform>();
            var offsets = new List<Vector3>();
            float panelDepth = thickness * .5f, gap = .01f;
            void Panel(string name, float x, float w, Vector3 slide)
            {
                panels.Add(Box(name, g, new Vector3(x, height * .5f, 0), Quaternion.identity,
                    new Vector3(w - gap, height - gap, panelDepth), settings.door, settings.generateColliders, false).transform);
                offsets.Add(slide);
            }
            switch (door.style)
            {
                case "opening": break;
                case "double":
                    Panel("Panel L", -width * .25f, width * .5f, Vector3.left * (width * .5f - .05f));
                    Panel("Panel R", width * .25f, width * .5f, Vector3.right * (width * .5f - .05f));
                    break;
                case "shutter":
                    Panel("Shutter", 0, width, Vector3.up * (height - .05f));
                    break;
                default:
                    Panel("Panel", 0, width, Vector3.right * (width - .05f));
                    break;
            }
            door.panels = panels.ToArray();
            door.panelOpenOffsets = offsets.ToArray();

            if (door.HasLink)
            {
                var trigger = Ensure<BoxCollider>(e.gameObject);
                trigger.isTrigger = true;
                trigger.center = new Vector3(0, height * .5f, 0);
                trigger.size = new Vector3(width, height, thickness + .5f);
                IgnoreRaycasts(e.gameObject);
            }
            else Remove<BoxCollider>(e.gameObject);
        }

        void BuildStairs(MapData map, StairsData s, MapElement e, Transform g)
        {
            e.name = string.IsNullOrEmpty(s.name) ? s.id : s.name;
            e.cond = s.cond ?? new Cond();
            SetArrival(e, s.arrival);
            e.transform.localPosition = new Vector3(s.cx, 0, s.cz);
            e.transform.localRotation = Quaternion.Euler(0, s.rotY, 0);   // local +Z = direction of travel

            // The format has no stair height: use the elevation difference to the linked map, else one wall height.
            var target = s.link != null ? project.FindMap(s.link.mapId) : null;
            float rise = target != null && target != map ? Mathf.Abs(target.elevation - map.elevation) : 0;
            if (rise < .1f) rise = project.wallHeight;
            float width = Mathf.Max(.1f, s.w), depth = Mathf.Max(.1f, s.d);
            bool up = s.goes != "down";

            var stairs = Ensure<MapStairs>(e.gameObject);
            stairs.goes = up ? "up" : "down";
            stairs.rise = rise;
            stairs.link = Copy(s.link);
            stairs.playerTag = settings.playerTag;

            if (up)
            {
                int steps = Mathf.Clamp(Mathf.RoundToInt(rise / .2f), 1, 40);
                float stepHeight = rise / steps, tread = depth / steps;
                for (int i = 0; i < steps; i++)
                {
                    float h = stepHeight * (i + 1);
                    Box("Step " + (i + 1), g, new Vector3(0, h * .5f, -depth * .5f + tread * (i + .5f)), Quaternion.identity,
                        new Vector3(width, h, tread), settings.stairs, false, true);
                }
                if (settings.generateColliders)
                {
                    // One smooth invisible ramp to walk on instead of the step edges.
                    float slope = Mathf.Atan2(rise, depth) * Mathf.Rad2Deg, length = Mathf.Sqrt(rise * rise + depth * depth);
                    var ramp = new GameObject("Ramp");
                    ramp.transform.SetParent(g, false);
                    ramp.transform.localPosition = new Vector3(0, rise * .5f - .05f, 0);
                    ramp.transform.localRotation = Quaternion.Euler(-slope, 0, 0);
                    ramp.AddComponent<BoxCollider>().size = new Vector3(width, .1f, length);
                    MakeStatic(ramp);
                }
            }
            else
            {
                // Going down: the flight would be under this floor, so just mark the stairwell on the floor.
                Box("Stairwell", g, new Vector3(0, .005f, 0), Quaternion.identity, new Vector3(width, .01f, depth),
                    Tint(settings.stairs, "#3a3a40"), false, true);
            }

            if (stairs.HasLink)
            {
                var trigger = Ensure<BoxCollider>(e.gameObject);
                trigger.isTrigger = true;
                // Up: near the top of the flight. Down: once the player is a little way onto the stairwell.
                trigger.center = up ? new Vector3(0, rise * .85f + 1.1f, depth * .35f) : new Vector3(0, 1.1f, depth * .2f);
                trigger.size = up ? new Vector3(width, 2.2f, depth * .3f) : new Vector3(width, 2.2f, depth * .6f);
                IgnoreRaycasts(e.gameObject);
            }
            else Remove<BoxCollider>(e.gameObject);
        }

        // ------------------------------------------------------------------ markers and labels

        void BuildMarker(MapData map, MarkerData m, MapElement e, Transform g)
        {
            e.name = MarkerName(m);
            e.cond = m.cond ?? new Cond();
            SetArrival(e, m.arrival);
            e.transform.localPosition = new Vector3(m.x, m.y, m.z);
            e.transform.localRotation = Quaternion.Euler(0, m.rotY, 0);

            var size = new Vector3(Mathf.Max(.05f, m.w), Mathf.Max(.05f, m.height), Mathf.Max(.05f, m.d));
            var marker = Ensure<MapMarker>(e.gameObject);
            marker.kind = m.kind ?? "";
            marker.size = size;
            marker.characterId = m.characterId ?? "";
            marker.pose = m.pose ?? "";
            marker.text = m.text ?? "";
            marker.evidenceId = m.evidenceId ?? "";
            marker.required = m.required;
            marker.icon = m.icon ?? "";
            marker.color = m.color ?? "";
            marker.prefab = m.prefab ?? "";
            marker.lightColor = ParseColour(m.lightColor, new Color(1, .914f, .769f));
            marker.intensity = m.intensity;
            marker.range = m.range;
            marker.triggerType = m.triggerType ?? "";
            marker.eventId = m.eventId ?? "";
            marker.once = m.once;
            marker.roomId = m.roomId ?? "";
            marker.link = Copy(m.link);
            marker.playerTag = settings.playerTag;

            switch (marker.kind)
            {
                case "prop":
                    var prefab = FindPrefab(m.prefab);
                    if (prefab != null)
                    {
                        var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab, g);
                        instance.transform.localPosition = Vector3.zero;
                        instance.transform.localRotation = Quaternion.identity;
                    }
                    else
                    {
                        if (!string.IsNullOrEmpty(m.prefab)) Warnings.Add($"Prop prefab '{m.prefab}' not found (marker {m.id}); used a placeholder.");
                        Box(string.IsNullOrEmpty(m.prefab) ? "Placeholder" : "Placeholder (" + m.prefab + ")", g, Vector3.up * size.y * .5f,
                            Quaternion.identity, size, Tint(settings.prop, m.color), settings.generateColliders, true);
                    }
                    break;
                case "light":
                    var lightObject = new GameObject("Light");
                    lightObject.transform.SetParent(g, false);
                    // A light marker placed on the floor (y = 0) goes just under the ceiling of its room.
                    if (m.y < .01f) lightObject.transform.localPosition = Vector3.up * (RoomHeight(map.FindRoom(m.roomId)) - .3f);
                    var light = lightObject.AddComponent<Light>();
                    light.type = LightType.Point;
                    light.color = marker.lightColor;
                    light.intensity = m.intensity;
                    light.range = m.range > 0 ? m.range : 8;
                    light.shadows = LightShadows.None;
                    break;
            }

            // Hotspots and evidence get a trigger box so the player's look ray can hit them; triggers and portals fire on enter.
            bool needsBox = marker.kind == "trigger" || marker.kind == "portal" || marker.kind == "hotspot" || marker.kind == "evidence";
            if (needsBox)
            {
                var box = Ensure<BoxCollider>(e.gameObject);
                box.isTrigger = true;
                box.center = Vector3.up * size.y * .5f;
                box.size = size;
                // Walk-in zones shouldn't catch the player's look ray (hotspots and evidence should).
                if (marker.FiresOnEnter) IgnoreRaycasts(e.gameObject);
            }
            else Remove<BoxCollider>(e.gameObject);
        }

        string MarkerName(MarkerData m)
        {
            if (!string.IsNullOrEmpty(m.name)) return m.name;
            if (!string.IsNullOrEmpty(m.characterId))
            {
                var who = Array.Find(project.characters ?? new CharacterDef[0], c => c != null && c.id == m.characterId);
                if (who != null && !string.IsNullOrEmpty(who.name)) return m.kind + " " + who.name;
            }
            return string.IsNullOrEmpty(m.kind) ? m.id : m.kind + " " + m.id;
        }

        void BuildLabel(LabelData l, MapElement e, Transform g)
        {
            e.name = string.IsNullOrEmpty(l.text) ? l.id : "Label " + l.text;
            e.cond = l.cond ?? new Cond();
            e.hasArrival = false;
            e.transform.localPosition = new Vector3(l.x, 0, l.z);
            e.transform.localRotation = Quaternion.identity;
            if (!settings.labelText || string.IsNullOrEmpty(l.text)) return;

            var textObject = new GameObject("Text");
            textObject.transform.SetParent(g, false);
            textObject.transform.localPosition = Vector3.up * .02f;
            textObject.transform.localRotation = Quaternion.Euler(90, 0, 0);   // lying flat, readable from above
            var text = textObject.AddComponent<TextMesh>();
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.font = font;
            text.text = l.text;
            text.fontSize = 64;
            text.characterSize = .04f * (l.size > 0 ? l.size : 1);
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = new Color(1, 1, 1, .8f);
            if (font != null) textObject.GetComponent<MeshRenderer>().sharedMaterial = font.material;
        }

        GameObject FindPrefab(string name)
        {
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(settings.prefabFolder) || !AssetDatabase.IsValidFolder(settings.prefabFolder))
                return null;
            if (prefabs.TryGetValue(name, out var cached)) return cached;
            GameObject found = null;
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab " + name, new[] { settings.prefabFolder }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (!string.Equals(Path.GetFileNameWithoutExtension(path), name, StringComparison.OrdinalIgnoreCase)) continue;
                found = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                break;
            }
            prefabs[name] = found;
            return found;
        }

        // ------------------------------------------------------------------ geometry and materials

        static GameObject Box(string name, Transform parent, Vector3 localPosition, Quaternion localRotation, Vector3 size,
            Material material, bool collider, bool isStatic)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            go.transform.localRotation = localRotation;
            go.transform.localScale = Vector3.Max(size, Vector3.one * .01f);
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            if (!collider) UnityEngine.Object.DestroyImmediate(go.GetComponent<BoxCollider>());
            if (isStatic) MakeStatic(go);
            return go;
        }

        /// <summary>Puts a trigger volume on the built-in Ignore Raycast layer.</summary>
        static void IgnoreRaycasts(GameObject go)
        {
            int layer = LayerMask.NameToLayer("Ignore Raycast");
            if (layer >= 0) go.layer = layer;
        }

        static void MakeStatic(GameObject go) =>
            GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic |
                                                       StaticEditorFlags.OccludeeStatic | StaticEditorFlags.ReflectionProbeStatic);

        static Color ParseColour(string hex, Color fallback) =>
            !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out var c) ? c : fallback;

        /// <summary>The base material, or (with room colours on) a saved copy of it in the given colour.</summary>
        Material Tint(Material baseMaterial, string hex)
        {
            if (!settings.useRoomColours || string.IsNullOrEmpty(hex) || baseMaterial == null) return baseMaterial;
            if (!ColorUtility.TryParseHtmlString(hex, out var colour)) return baseMaterial;
            string key = baseMaterial.name + "_" + ColorUtility.ToHtmlStringRGB(colour);
            if (tinted.TryGetValue(key, out var cached)) return cached;
            string folder = MapImportSettings.MaterialFolder + "/Colours";
            EnsureFolder(folder);
            string path = folder + "/" + key + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(baseMaterial) { name = key };
                SetColour(material, colour);
                AssetDatabase.CreateAsset(material, path);
            }
            tinted[key] = material;
            return material;
        }

        /// <summary>Loads Assets/TVF/Materials/MapMaker/&lt;name&gt;.mat, creating it for the active render pipeline if missing.</summary>
        public static Material DefaultMaterial(string name, Color colour, float smoothness)
        {
            EnsureFolder(MapImportSettings.MaterialFolder);
            string path = MapImportSettings.MaterialFolder + "/" + name + ".mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material != null) return material;
            Shader shader = GraphicsSettings.currentRenderPipeline == null ? Shader.Find("Standard") : null;
            if (shader == null) shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("HDRP/Lit");
            if (shader == null) shader = Shader.Find("Standard");
            material = new Material(shader) { name = name };
            SetColour(material, colour);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", smoothness);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            AssetDatabase.CreateAsset(material, path);
            return material;
        }

        static void SetColour(Material material, Color colour)
        {
            if (material.HasProperty("_Color")) material.SetColor("_Color", colour);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", colour);
        }

        static void EnsureFolder(string folder)
        {
            if (AssetDatabase.IsValidFolder(folder)) return;
            string parent = Path.GetDirectoryName(folder).Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
        }
    }
}
