# DaleMUD Map Viewer

A browser-based 3D viewer for the rooms in [DaleMUD](https://github.com/sneezymud/dalemud)'s
`lib/tinyworld.wld`. Rooms are cubes on a 3D grid (north/south/east/west/up/down),
connected by links; a zone list picks the area and a details pane shows the
selected room's description, exits and extras. Mobs appear on the rooms where
they load at boot; clicking one shows its stats and the equipment it wears
and carries. The Mobs and Items tabs in the left pane search every mob and
object in the game as you type, and list everywhere each one loads.

## Layout

```
tools/convert_world.py   .wld/.zon/.mob/.obj  ->  web/data/*.json (run once)
tools/dale_entities.py   mob and object parsers, zone reset replay
tools/dale_tables.py     flag and name tables from the game source
tools/dale_reader.py     fread_string()/fscanf()-style stream reader
web/index.html           the viewer (static files, no build step)
web/app.js               three.js scene, picking, zone list, details pane
web/data/zones.json      zone index
web/data/zones/*.json    one file per zone: rooms with grid positions, mob placements,
                         and the mob and object prototypes that zone needs
web/data/mobs.json       every mob prototype with its load locations (fetched by the Mobs tab)
web/data/objects.json    every object prototype with its load locations (fetched by the Items tab)
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

Mob and object prototypes follow `read_mobile()` and `read_obj_from_file()`.
Files in `lib/objects/` override object prototypes and files in `lib/zones/`
replace a zone's reset table, as they do at boot. The reset tables are then
replayed once, in zone order, from an empty world, following `reset_zone()`:
per-prototype load limits are global and `if_flag` chains commands to the one
before. What the viewer shows is the world right after boot; nothing wanders.
A few entries in the world files are malformed; the converter keeps what it
can read and the viewer flags them.

Grid positions are computed with a breadth-first walk over exits (both
directions). When the ideal cell is taken, the room is pushed further along
the same direction, so the link stays straight but longer.

## Running

`fetch()` needs HTTP, so serve the `web` folder:

```sh
python -m http.server 8000 --directory web
```

Then open <http://localhost:8000/>. The URL hash (`#zone=30&room=3001`, or
`#zone=30&mob=10` for a mob) links to a specific room or mob; `&mobinfo=<vnum>`
or `&item=<vnum>` opens a mob or item from the search tabs.

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

Room cube colour is the sector type (city, forest, water…). Mob markers sit on
top of their room: blue is good, yellow neutral, red evil (alignment ±350),
and a diamond instead of a ball means the mob is aggressive.

## Credits and license

The world data comes from the [DaleMUD open source release](https://github.com/sneezymud/dalemud),
which descends from SillyMUD and DikuMUD. The viewer's **About & credits** panel (the ⓘ button)
credits their authors, and [`web/LICENSE-DIKU.txt`](web/LICENSE-DIKU.txt) is the DikuMUD License,
included unchanged as that license requires. It forbids any commercial use of the data.
