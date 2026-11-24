# TVF Map Maker

A map editor for TVF. Draw floor plans in a Danganronpa-style 2D editor, walk around them in first person,
see the whole building in 3D, and export them for Unity.

## Start it

Double-click **Start Map Maker.cmd**. It opens http://localhost:5178 in your browser.
(The first run installs what it needs, which takes about a minute. It needs Node.js.)

Your work autosaves in the browser every second. Press **Ctrl+S** to also save it into `MapMaker\projects\`
on disk (nothing is downloaded). After that first Ctrl+S the disk file updates itself whenever you change something.
Put that folder in Git or a shared drive to share with the team. Saved files are listed on the home screen under
**📁 Projects folder**. **Ctrl+Shift+S** downloads a copy if you want to send one to someone.

## Shortcuts (like Figma)

Tools: **V** select, **H** hand, **R** room, **C** corridor, **O** outdoor, **X** blocked, **D** door, **S** stairs,
**M** marker, **T** label, **E** erase. A tool goes back to Select after one use; double-click a tool to keep it.
Scroll pans, Ctrl+scroll zooms. Ctrl+C / X / V, Ctrl+Shift+V paste in place, Ctrl+D duplicate (move the copy and press
Ctrl+D again to repeat that step), Alt+drag copy, Ctrl+Alt+C / V copy and paste a look, Enter or Ctrl+R rename,
Ctrl+] / Ctrl+[ forward and back, Ctrl+Shift+H hide, Ctrl+Shift+L lock, Shift+1 / 2 / 0 zoom to fit, selection or
100%, Ctrl+/ search. Press **?** in the app for the full list.

## Projects

The app opens on **your projects**: every project saved in this browser, with map previews (hover a card to
flip through its floors). Star, rename, duplicate, download or trash projects from the ⋯ menu or by right-clicking.
The ⌂ button (top left) brings you back here. Drop `.tvfmap.json` files onto the page to add them.

## Styles

Pick a style in the top bar, or choose **🎨 Make / edit styles…** to open the style editor. Start from a preset,
change any colour (with transparency), the font, glow and the 3D colours, and watch the preview update. Save it for the
whole project or one map. Use **Export / Import** to share a style as a `.tvfstyle.json` file.

## The four modes (top bar)

| Mode | What it's for |
|---|---|
| ✏️ **Edit** | Draw and edit the map. |
| 🚶 **Walk** (Tab) | First-person walk from the mouse position. WASD, Shift to run, E to talk/examine, M minimap, C ceiling. Walking through a linked door, stairs or exit takes you to the other map. |
| 🏢 **Building** (B) | Every floor stacked in 3D. Orbit around, spread the floors apart, see the links as lines. Click a room to edit it. |
| 🗺️ **Map screen** | Preview of the in-game map: Place list, Student locations, fog of war. Press **V3 style** for the tilted DRV3-style screen ([JMP] fast-travel points, floor stack, GO!). Keys: W/S or arrows to pick, Tab to switch lists, Q/E to change floor, Enter to walk there, scroll to zoom, drag to pan. |

## Drawing

| Tool | Key | How |
|---|---|---|
| Select | V | Click, drag to move, drag empty space to box-select, Alt-drag to copy. Handles resize. |
| Room / Hall / Outdoor / Blocked | R / H / O / X | Drag a rectangle. **Shift+drag** adds to the selected room (L-shapes), **Alt+drag** cuts a hole. |
| Door | D | Click a wall. Drag along it for a wider door. |
| Stairs | S | Drag a rectangle, then link it to another floor. |
| Marker | M | Characters, investigation spots, evidence, props, lights, cameras, trigger zones, exits, free-time spots, notes. |
| Label | T | Text on the map. |
| Erase | E | Click or drag over things. |

Hallways join up with no walls between them. Rooms get walls automatically; add doors to get in.
Press **?** in the app for every shortcut.

## Linking maps

Select a door, stairs or Exit marker. In the Inspector, under **Link to another map**, either:
- **Pick on map…**: switch to the other floor on the left and click where it leads (links both ways), or
- choose the map, then **Make matching arrival**, which builds matching stairs/exit on the other map for you.

Double-click a linked thing to jump there (Backspace goes back). **⇄ Links** shows how all your maps connect.

## Chapters, time of day and story flags

Every object has **When does it exist?**: a chapter range, times of day, and "only if / unless" a story flag.
Use the chapter and time pickers in the top bar (and ⚑ Flags) to see the map as it is at that point in the story.
Things hidden by the current setting show as faint dashed outlines in the editor.

## Your own images and icons

- **Images** tab: click or drop PNG/JPG/GIF/WebP/SVG files. Use them as room icons, prop cut-outs, exit icons,
  character portraits or a reference picture to trace over (Inspector with nothing selected › *Trace over a picture*).
- Drop an image straight onto a room to make it the room's icon, or onto empty floor to make a prop.
- **Draw a pixel icon…** opens a small pixel editor (8×8 up to 32×32).
- **Project › Characters**: click a circle to set a portrait, or **Import portraits by name** to match `Nina.png` etc.
- Styles: pick one in the top bar, or **Project › Make a custom style** and change every colour.

## Into Unity

1. Copy `unity/TVFMapImporter` into `TVF-Unity/Assets/TVF/`.
2. In the Map Maker: **Export › For Unity (.json)** (and **C# ids** for `MapIds.cs` constants).
3. In Unity: **TVF › Map Maker › Import Map…** and pick the json. Re-importing updates the level in place.

See `unity/TVFMapImporter/README.md` for hooking it into `ExplorationController`, and
`docs/UNITY-FORMAT.md` for the exact file format if you want to write your own loader.
Also available: **Export › 3D model (.glb)** for a quick blockout in Blender or Unity, and **Map image (PNG)** for
the in-game map screen.

## Scale

1 grid cell = 1 m by default. TVF uses 1.36 Unity units per metre (Stitch, 5′9″, is 2.376 units tall).
Both are in **Project › Scale & 3D**.
