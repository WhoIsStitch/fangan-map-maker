# ▦ Fangan Map Maker

**A free map maker for fan games.** Draw your school, hotel or island floor by floor, walk around it in first
person, preview the in-game map screen, then send it straight into Unity.

Made for fangan and visual-novel / investigation fan games: dorm rows, locked rooms that open in later
chapters, characters who move between rooms by chapter and time of day, investigation spots, evidence and
fast-travel points.

**Open it:** https://whoisstitch.github.io/fangan-map-maker/ (runs in your browser, nothing to install)

---

## What it does

- **Draw maps fast.** Rooms, corridors, outdoor areas, blocked areas, doors and stairs on a grid. Walls are made for
  you, corridors join up by themselves, and shortcuts work like Figma.
- **Several floors and areas.** Each floor or area is its own workspace in one project. Link doors, stairs and exits
  between them with the Connect tool, and see how they all join up.
- **Walk it in 3D.** First-person walk mode with doors that open, characters you can talk to and spots you can
  examine. Walk through a linked door or up the stairs and you arrive on the other map.
- **See the whole building.** A 3D view with every floor stacked, and lines showing the links between them.
- **Story-aware.** Anything can appear only in certain chapters, at certain times of day, or when a story flag is
  set. Rooms, doors and stairs can stay locked until a chapter. Pick a chapter at the top to see the map as it is
  at that point.
- **In-game map screen preview** in three styles (flat classic, tilted 3D, and tilted 3D with an alternative menu),
  with places, students, fast-travel points and fog of war.
- **Your own look.** Built-in styles plus a style editor; import your own icons, portraits and props, or draw pixel
  icons in the app.
- **Checklist.** Paste your room list by chapter and floor, and track what is drawn, placed, locked and done.
- **Export.** Unity JSON (with an importer included), C# id constants, PNG map images and 3D models (.glb).

## Getting started

1. Open the website (link above), or run it on your own computer (see below).
2. Start from the **Sample school**, or make a **New project**.
3. Press **?** in the app for every shortcut.

Your projects are saved in your browser automatically. Use **File › Download a copy** to keep a file you can back
up or share; open it again with **File › Open** or by dropping it on the page.

## Drawing

| Tool | Key | How |
|---|---|---|
| Select | E or V | Click, drag to move, drag across things to select them all. Alt-drag copies. |
| Hand | H | Drag to move around (or hold Space). |
| Room / Corridor / Outdoor / Blocked | R / C / O / X | Drag a rectangle. Shift+drag adds to the selected room; Alt+drag cuts a hole. |
| Door / Stairs | D / S | Click a wall for a door; drag a rectangle for stairs. |
| Connect | L | Click a door / stairs / spot, then click where it leads (on any floor). |
| Marker / Label / Erase | M / T / Q | Characters, evidence, props, lights, triggers, exits, fast-travel points, notes. |

A tool goes back to Select after one use. Double-click a tool to keep it, or hold **Shift** with its key.

## Into Unity

1. Copy the `unity/TVFMapImporter` folder into your Unity project's `Assets`.
2. In the Map Maker: **Export › For Unity (.json)**.
3. In Unity: **TVF › Map Maker › Import Map…** and pick the file. Re-importing updates the level in place.

The importer builds floors, walls, doors, stairs and markers, and includes components for linked doors, chapter
conditions and trigger zones. The file format is documented in [`docs/UNITY-FORMAT.md`](docs/UNITY-FORMAT.md) if
you'd rather write your own loader.

## Scale

**Project › Scale & 3D** sets how big one grid square is (from 0.2 m to 2 m), how many Unity units make a metre,
wall height, eye height and the walk-mode camera. In walk mode, press **−** / **=** to try different sizes live.

## Running it on your own computer

You need [Node.js](https://nodejs.org). Then double-click **`Start Map Maker.cmd`** (Windows), or run:

```
npm install
npm run dev
```

and open http://localhost:5178. Running it locally also lets **Ctrl+S** save projects straight into a
`projects` folder next to the app.

---

*Fangan Map Maker is an unofficial fan-made tool. It is not affiliated with or endorsed by Spike Chunsoft or the
Danganronpa series. All built-in icons and styles are original.*
