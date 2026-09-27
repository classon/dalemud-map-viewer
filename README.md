# DaleMUD Map Viewer

A browser-based 3D viewer for the rooms in [DaleMUD](https://github.com/sneezymud/dalemud)'s
`lib/tinyworld.wld`. Rooms are cubes on a 3D grid (north/south/east/west/up/down),
connected by links; a zone list picks the area and a details pane shows the
selected room's description, exits and extras.

## Layout

```
tools/convert_world.py   .wld + .zon  ->  web/data/*.json (run once)
web/index.html           the viewer (static files, no build step)
web/app.js               three.js scene, picking, zone list, details pane
web/data/zones.json      zone index
web/data/zones/*.json    one file per zone, rooms with precomputed grid positions
web/vendor/              three.js r160 + OrbitControls (vendored, works offline)
```

## Regenerating the data

```sh
python tools/convert_world.py /path/to/dalemud/lib
```

Point it at the directory holding `tinyworld.wld` and `tinyworld.zon`. The
parser follows `load_one_room()`, `setup_dir()` and `boot_zones()` in the
original `src/db.c`. Rooms belong to the first zone whose `top` is at or above
their vnum, the same rule the game uses.

Grid positions are computed with a breadth-first walk over exits (both
directions). When the ideal cell is taken, the room is pushed further along
the same direction, so the link stays straight but longer.

## Running

`fetch()` needs HTTP, so serve the `web` folder:

```sh
python -m http.server 8000 --directory web
```

Then open <http://localhost:8000/>. The URL hash (`#zone=30&room=3001`) links
to a specific room.

## Map key

| Link | Meaning |
|---|---|
| Grey | Two-way: A→B one way and B→A back the opposite way |
| Orange + arrow | One-way: no matching return exit |
| Magenta arc | Off-grid: target doesn't sit in the exit's direction (maze or "teleporting" exit) |
| Dashed violet | Room teleport (rooms that move you after a timer) |
| Green stub | Exit to another zone; click the small cube to jump there |
| Red stub | Exit to a room that doesn't exist |
| Tan / red plate | Door / secret door, on the side of the room it belongs to |

Room cube colour is the sector type (city, forest, water…).
