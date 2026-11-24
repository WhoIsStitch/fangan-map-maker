using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace TVF.Editor
{
    /// <summary>TVF → Map Maker → Import Map...: builds or updates a Map Maker export (*.tvfmap-unity.json) in the open scene.</summary>
    public sealed class TVFMapImporterWindow : EditorWindow
    {
        const string Prefs = "TVF.MapImporter.";

        string jsonPath = "";
        MapProject loaded;
        string loadError = "";
        int mapChoice;   // 0 = all maps
        Vector2 scroll;
        MapImportSettings settings = new MapImportSettings();
        DefaultAsset prefabFolder;

        [MenuItem("TVF/Map Maker/Import Map...")]
        static void Open()
        {
            var window = GetWindow<TVFMapImporterWindow>("Map Importer");
            window.minSize = new Vector2(380, 420);
            if (string.IsNullOrEmpty(window.jsonPath)) window.Browse();
        }

        void OnEnable()
        {
            jsonPath = EditorPrefs.GetString(Prefs + "path", "");
            settings.generateColliders = EditorPrefs.GetBool(Prefs + "colliders", true);
            settings.generateCeilings = EditorPrefs.GetBool(Prefs + "ceilings", true);
            settings.useRoomColours = EditorPrefs.GetBool(Prefs + "colours", true);
            settings.labelText = EditorPrefs.GetBool(Prefs + "labels", false);
            settings.playerTag = EditorPrefs.GetString(Prefs + "playerTag", "Player");
            settings.floor = LoadMaterial("floor");
            settings.wall = LoadMaterial("wall");
            settings.ceiling = LoadMaterial("ceiling");
            settings.blocked = LoadMaterial("blocked");
            settings.door = LoadMaterial("door");
            settings.stairs = LoadMaterial("stairs");
            settings.prop = LoadMaterial("prop");
            string folder = EditorPrefs.GetString(Prefs + "prefabFolder", "");
            prefabFolder = AssetDatabase.IsValidFolder(folder) ? AssetDatabase.LoadAssetAtPath<DefaultAsset>(folder) : null;
            Load();
        }

        void OnDisable()
        {
            EditorPrefs.SetString(Prefs + "path", jsonPath ?? "");
            EditorPrefs.SetBool(Prefs + "colliders", settings.generateColliders);
            EditorPrefs.SetBool(Prefs + "ceilings", settings.generateCeilings);
            EditorPrefs.SetBool(Prefs + "colours", settings.useRoomColours);
            EditorPrefs.SetBool(Prefs + "labels", settings.labelText);
            EditorPrefs.SetString(Prefs + "playerTag", settings.playerTag ?? "Player");
            SaveMaterial("floor", settings.floor);
            SaveMaterial("wall", settings.wall);
            SaveMaterial("ceiling", settings.ceiling);
            SaveMaterial("blocked", settings.blocked);
            SaveMaterial("door", settings.door);
            SaveMaterial("stairs", settings.stairs);
            SaveMaterial("prop", settings.prop);
            EditorPrefs.SetString(Prefs + "prefabFolder", prefabFolder != null ? AssetDatabase.GetAssetPath(prefabFolder) : "");
        }

        static Material LoadMaterial(string key)
        {
            string path = EditorPrefs.GetString(Prefs + "mat." + key, "");
            return string.IsNullOrEmpty(path) ? null : AssetDatabase.LoadAssetAtPath<Material>(path);
        }

        static void SaveMaterial(string key, Material material) =>
            EditorPrefs.SetString(Prefs + "mat." + key, material != null ? AssetDatabase.GetAssetPath(material) : "");

        void Browse()
        {
            string start = File.Exists(jsonPath) ? Path.GetDirectoryName(jsonPath) : "";
            string picked = EditorUtility.OpenFilePanel("Choose a Map Maker export (Export → For Unity)", start, "json");
            if (string.IsNullOrEmpty(picked)) return;
            jsonPath = picked;
            mapChoice = 0;
            Load();
        }

        void Load()
        {
            loaded = null;
            loadError = "";
            if (string.IsNullOrEmpty(jsonPath)) return;
            if (!File.Exists(jsonPath)) { loadError = "File not found."; return; }
            try
            {
                var project = JsonUtility.FromJson<MapProject>(File.ReadAllText(jsonPath));
                if (project == null) { loadError = "The file is empty or not JSON."; return; }
                if (project.format != MapProject.Format)
                {
                    loadError = $"This isn't a Map Maker Unity export (format is \"{project.format}\"). Use Export → For Unity.";
                    return;
                }
                if (project.maps == null || project.maps.Length == 0) { loadError = "The file has no maps."; return; }
                loaded = project;
                mapChoice = Mathf.Clamp(mapChoice, 0, project.maps.Length);
            }
            catch (Exception e) { loadError = "Couldn't read the file: " + e.Message; }
        }

        void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            EditorGUILayout.LabelField("Map file", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUI.BeginChangeCheck();
                jsonPath = EditorGUILayout.DelayedTextField(jsonPath);
                if (EditorGUI.EndChangeCheck()) Load();
                if (GUILayout.Button("Browse...", GUILayout.Width(80))) Browse();
                if (GUILayout.Button("Reload", GUILayout.Width(60))) Load();
            }
            if (!string.IsNullOrEmpty(loadError)) EditorGUILayout.HelpBox(loadError, MessageType.Error);
            else if (loaded != null)
                EditorGUILayout.HelpBox($"{loaded.project}: {loaded.maps.Length} map(s), exported {loaded.exportedAt}.", MessageType.Info);

            if (loaded != null)
            {
                var options = new string[loaded.maps.Length + 1];
                options[0] = "All maps";
                for (int i = 0; i < loaded.maps.Length; i++)
                {
                    var m = loaded.maps[i];
                    options[i + 1] = m == null ? "(empty)" : $"{m.building} {m.name}".Trim() + "  (" + m.id + ")";
                }
                mapChoice = EditorGUILayout.Popup("Build", mapChoice, options);
            }

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Materials (empty = default in " + MapImportSettings.MaterialFolder + ")", EditorStyles.boldLabel);
            settings.floor = MaterialField("Floor", settings.floor);
            settings.wall = MaterialField("Wall", settings.wall);
            settings.ceiling = MaterialField("Ceiling", settings.ceiling);
            settings.blocked = MaterialField("Blocked room", settings.blocked);
            settings.door = MaterialField("Door", settings.door);
            settings.stairs = MaterialField("Stairs", settings.stairs);
            settings.prop = MaterialField("Prop placeholder", settings.prop);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Options", EditorStyles.boldLabel);
            settings.generateColliders = EditorGUILayout.Toggle(new GUIContent("Generate colliders", "Floors, walls, door panels, stairs ramps and placeholder props."), settings.generateColliders);
            settings.generateCeilings = EditorGUILayout.Toggle(new GUIContent("Generate ceilings", "For rooms with 'ceiling' ticked (never outdoors)."), settings.generateCeilings);
            settings.useRoomColours = EditorGUILayout.Toggle(new GUIContent("Use room colours", "Tint floors and walls with each room's 3D colours."), settings.useRoomColours);
            settings.labelText = EditorGUILayout.Toggle(new GUIContent("Labels as floor text"), settings.labelText);
            prefabFolder = (DefaultAsset)EditorGUILayout.ObjectField(new GUIContent("Prop prefab folder", "Props spawn the prefab with the same name from this folder; otherwise a placeholder box."),
                prefabFolder, typeof(DefaultAsset), false);
            if (prefabFolder != null && !AssetDatabase.IsValidFolder(AssetDatabase.GetAssetPath(prefabFolder)))
                EditorGUILayout.HelpBox("That isn't a folder.", MessageType.Warning);
            settings.playerTag = EditorGUILayout.TagField(new GUIContent("Player tag", "Doors and triggers look for this tag, then the main camera's CharacterController."), settings.playerTag);

            EditorGUILayout.Space();
            bool playing = EditorApplication.isPlayingOrWillChangePlaymode;
            if (playing) EditorGUILayout.HelpBox("Leave Play Mode to import.", MessageType.Warning);
            using (new EditorGUI.DisabledScope(loaded == null || playing))
            {
                var existing = loaded != null ? GameObject.Find(TVFMapBuilder.RootName(loaded)) : null;
                if (GUILayout.Button(existing != null ? "Update map in scene" : "Build map in scene", GUILayout.Height(32))) Import();
            }
            EditorGUILayout.EndScrollView();
        }

        static Material MaterialField(string label, Material value) =>
            (Material)EditorGUILayout.ObjectField(label, value, typeof(Material), false);

        void Import()
        {
            Load();   // pick up a fresh export
            if (loaded == null) return;
            settings.onlyMapId = mapChoice > 0 && loaded.maps[mapChoice - 1] != null ? loaded.maps[mapChoice - 1].id : "";
            string folder = prefabFolder != null ? AssetDatabase.GetAssetPath(prefabFolder) : "";
            settings.prefabFolder = AssetDatabase.IsValidFolder(folder) ? folder : "";

            var builder = new TVFMapBuilder(loaded, settings);
            var root = builder.Build();
            AssetDatabase.SaveAssets();
            Selection.activeGameObject = root;
            EditorSceneManager.MarkSceneDirty(root.scene);
            foreach (var warning in builder.Warnings) Debug.LogWarning("[TVF Map] " + warning);
            Debug.Log($"[TVF Map] Imported '{loaded.project}': {builder.Built} element(s) built or updated, {builder.Removed} removed.", root);
        }
    }
}
