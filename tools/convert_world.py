#!/usr/bin/env python3
"""Convert DaleMUD world files (tinyworld.wld + tinyworld.zon) into JSON.

Writes one JSON file per zone plus an index, so the viewer never has to
touch the 2.5 MB world file. Each room gets a precomputed 3D grid position.

Usage:
    python tools/convert_world.py <path/to/lib> [--out web/data]

The parsing mirrors load_one_room(), setup_dir() and boot_zones() in the
original src/db.c, which read the files as a stream of '~'-terminated strings
and whitespace-separated integers.
"""

import argparse
import json
import re
import sys
from collections import deque
from pathlib import Path

DIR_NAMES = ["north", "east", "south", "west", "up", "down"]
OPPOSITE = [2, 3, 0, 1, 5, 4]
# Grid offsets in viewer space: x = east, y = up, z = south (three.js convention).
DIR_VECTORS = [(0, 0, -1), (1, 0, 0), (0, 0, 1), (-1, 0, 0), (0, 1, 0), (0, -1, 0)]

ROOM_FLAGS = [
    (1, "dark"), (2, "death"), (4, "no_mob"), (8, "indoors"), (16, "peaceful"),
    (32, "no_steal"), (64, "no_summon"), (128, "no_magic"), (256, "tunnel"),
    (512, "private"), (1024, "silence"), (2048, "large"), (4096, "no_death"),
    (8192, "save_room"),
]
TUNNEL = 256

EXIT_FLAGS = [
    (1, "door"), (2, "closed"), (4, "locked"), (8, "secret"),
    (16, "rslocked"), (32, "pickproof"), (64, "climb"),
]

SECTORS = [
    "inside", "city", "field", "forest", "hills", "mountain", "water_swim",
    "water_noswim", "air", "underwater", "desert", "tree",
]
SECT_WATER_NOSWIM = 7
SECT_UNDERWATER = 9

TELE_FLAGS = [(1, "look"), (2, "count"), (4, "random"), (8, "spin")]
TELE_COUNT = 2


def flag_names(value, table):
    return [name for bit, name in table if value & bit]


class Reader:
    """Stream reader that mimics fread_string() and fscanf(" %ld ")."""

    _ws = re.compile(r"\s*")
    _token = re.compile(r"\S+")

    def __init__(self, text):
        self.text = text
        self.pos = 0

    def skip_ws(self):
        self.pos = self._ws.match(self.text, self.pos).end()

    def at_end(self):
        self.skip_ws()
        return self.pos >= len(self.text)

    def peek_token(self):
        self.skip_ws()
        m = self._token.match(self.text, self.pos)
        return m.group(0) if m else None

    def token(self):
        self.skip_ws()
        m = self._token.match(self.text, self.pos)
        if not m:
            raise EOFError("unexpected end of file")
        self.pos = m.end()
        return m.group(0)

    def int(self):
        tok = self.token()
        try:
            return int(tok)
        except ValueError:
            raise ValueError(f"expected integer, got {tok!r} near offset {self.pos}")

    def optional_int(self):
        """Like fscanf("%ld"): on a non-number, consume nothing and return None."""
        tok = self.peek_token()
        if tok is None or not re.fullmatch(r"-?\d+", tok):
            return None
        return self.int()

    def string(self):
        """Read up to the next '~' and discard the rest of that line."""
        end = self.text.find("~", self.pos)
        if end < 0:
            raise EOFError("unterminated string")
        value = self.text[self.pos:end]
        nl = self.text.find("\n", end)
        self.pos = len(self.text) if nl < 0 else nl + 1
        return value.replace("\r", "").rstrip()


def parse_zones(text):
    r = Reader(text)
    zones = []
    bottom = 0
    while not r.at_end():
        tok = r.token()
        if not tok.startswith("#"):
            continue
        num = int(tok[1:])
        name = r.string().strip()
        if name.startswith("$"):
            break
        top = r.int()
        lifespan = r.int()
        reset_mode = r.int()
        # Skip the reset command table; it ends with a line holding just 'S'.
        while True:
            line_end = text.find("\n", r.pos)
            line = text[r.pos:line_end if line_end >= 0 else len(text)].strip()
            r.pos = len(text) if line_end < 0 else line_end + 1
            if line == "S" or line_end < 0:
                break
        zones.append({
            "id": num, "name": name, "bottom": bottom, "top": top,
            "lifespan": lifespan, "resetMode": reset_mode,
        })
        bottom = top + 1
    return zones


def parse_rooms(text):
    r = Reader(text)
    rooms = []
    while not r.at_end():
        tok = r.token()
        if not tok.startswith("#"):
            raise ValueError(f"expected '#<vnum>', got {tok!r} near offset {r.pos}")
        if tok == "#99999" or tok == "$~" or tok.startswith("$"):
            break
        vnum = int(tok[1:])
        # The vnum line was consumed by the token read; move to the next line.
        nl = r.text.find("\n", r.pos)
        r.pos = nl + 1
        room = {"vnum": vnum, "name": r.string().strip(), "desc": r.string()}

        r.int()  # zone number stored in the file; the game recomputes it
        room_flags = r.int()
        sector = r.int()
        if sector == -1:
            tele = {"time": r.int(), "target": r.int()}
            mask = r.int()
            tele["flags"] = flag_names(mask, TELE_FLAGS)
            if mask & TELE_COUNT:
                tele["count"] = r.int()
            sector = r.int()
            room["teleport"] = tele
        # Optional fields: the game's fscanf silently fails when they are absent.
        if sector in (SECT_WATER_NOSWIM, SECT_UNDERWATER):
            speed = r.optional_int()
            direction = r.optional_int()
            if speed is not None:
                room["river"] = {"speed": speed, "dir": direction}
        if room_flags & TUNNEL:
            limit = r.optional_int()
            if limit is not None:
                room["mobLimit"] = limit

        room["flags"] = flag_names(room_flags, ROOM_FLAGS)
        room["sector"] = SECTORS[sector] if 0 <= sector < len(SECTORS) else f"unknown({sector})"
        room["exits"] = []
        room["extras"] = []

        while True:
            code = r.token()
            if code.startswith("D"):
                d = int(code[1:])
                nl = r.text.find("\n", r.pos)
                r.pos = nl + 1
                desc = r.string().strip()
                keywords = r.string().strip()
                info, key, to_room, open_cmd = r.int(), r.int(), r.int(), r.int()
                exit_ = {"dir": d, "to": to_room}
                if desc:
                    exit_["desc"] = desc
                if keywords:
                    exit_["keywords"] = keywords
                flags = flag_names(info, EXIT_FLAGS)
                if flags:
                    exit_["flags"] = flags
                if key > 0:
                    exit_["key"] = key
                if open_cmd not in (-1, 0):
                    exit_["openCmd"] = open_cmd
                room["exits"].append(exit_)
            elif code == "E":
                nl = r.text.find("\n", r.pos)
                r.pos = nl + 1
                room["extras"].append({"keywords": r.string().strip(), "desc": r.string()})
            elif code == "S":
                break
            else:
                print(f"warning: unknown code {code!r} in room #{vnum}", file=sys.stderr)
        rooms.append(room)
    return rooms


def zone_for(vnum, zones):
    for z in zones:
        if vnum <= z["top"]:
            return z
    return None


def layout(rooms):
    """Assign integer grid positions by walking exits breadth-first.

    Each exit tries to put its target one step in the exit's direction. When
    that cell is taken, the target is pushed further along the same direction
    until a free cell is found. Exits that end up not matching a single grid
    step are drawn by the viewer as "warp" links.
    """
    by_vnum = {r["vnum"]: r for r in rooms}
    pos = {}
    components = []

    # Neighbours in both directions: an exit A --east--> B also lets us place
    # A west of B, so rooms with only one-way exits still join their area.
    # Forward exits come first; horizontal before vertical keeps levels flat.
    neighbours = {v: [] for v in by_vnum}
    for room in rooms:
        for e in room["exits"]:
            t, d = e["to"], e["dir"]
            if t in by_vnum and t != room["vnum"] and 0 <= d <= 5:
                neighbours[room["vnum"]].append((0, d >= 4, t, DIR_VECTORS[d]))
                neighbours[t].append((1, d >= 4, room["vnum"], DIR_VECTORS[OPPOSITE[d]]))
    for v in neighbours:
        neighbours[v].sort(key=lambda n: (n[0], n[1]))

    # Seed from the best-connected room so the main area grows from its
    # centre, then pick up any disconnected islands.
    seeds = sorted(rooms, key=lambda r: (-len(neighbours[r["vnum"]]), r["vnum"]))
    for seed in seeds:
        if seed["vnum"] in pos:
            continue
        local = {seed["vnum"]: (0, 0, 0)}
        occupied = {(0, 0, 0): seed["vnum"]}
        queue = deque([seed["vnum"]])
        while queue:
            v = queue.popleft()
            x, y, z = local[v]
            for _, _, t, (dx, dy, dz) in neighbours[v]:
                if t in local or t in pos:
                    continue
                k = 1
                while (x + dx * k, y + dy * k, z + dz * k) in occupied:
                    k += 1
                cell = (x + dx * k, y + dy * k, z + dz * k)
                local[t] = cell
                occupied[cell] = t
                queue.append(t)
        components.append(local)

    # Pack components side by side along x, largest first, with a gap.
    components.sort(key=len, reverse=True)
    cursor = 0
    for comp in components:
        xs = [c[0] for c in comp.values()]
        zs = [c[2] for c in comp.values()]
        shift_x = cursor - min(xs)
        shift_z = -min(zs) if len(components) > 1 else 0
        for v, (x, y, z) in comp.items():
            pos[v] = (x + shift_x, y, z + shift_z)
        cursor += max(xs) - min(xs) + 3

    # Re-centre the whole zone on the origin (integer grid).
    if pos:
        cx = (min(p[0] for p in pos.values()) + max(p[0] for p in pos.values())) // 2
        cz = (min(p[2] for p in pos.values()) + max(p[2] for p in pos.values())) // 2
        pos = {v: (p[0] - cx, p[1], p[2] - cz) for v, p in pos.items()}
    return pos


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "zone"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("lib", type=Path, help="DaleMUD lib directory containing tinyworld.wld/.zon")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "web" / "data")
    args = ap.parse_args()

    zones = parse_zones((args.lib / "tinyworld.zon").read_text(encoding="latin-1"))
    rooms = parse_rooms((args.lib / "tinyworld.wld").read_text(encoding="latin-1"))
    all_vnums = {r["vnum"] for r in rooms}

    zone_rooms = {z["id"]: [] for z in zones}
    orphans = 0
    for room in rooms:
        z = zone_for(room["vnum"], zones)
        if z is None:
            orphans += 1
            continue
        zone_rooms[z["id"]].append(room)

    zone_of_vnum = {r["vnum"]: zone_for(r["vnum"], zones)["id"] for rs in zone_rooms.values() for r in rs}

    out_zones = args.out / "zones"
    out_zones.mkdir(parents=True, exist_ok=True)
    for old in out_zones.glob("*.json"):
        old.unlink()

    index = []
    for z in zones:
        zrooms = zone_rooms[z["id"]]
        if not zrooms:
            continue
        positions = layout(zrooms)
        for room in zrooms:
            room["pos"] = list(positions[room["vnum"]])
            for e in room["exits"]:
                if e["to"] not in all_vnums:
                    e["missing"] = True
                elif zone_of_vnum[e["to"]] != z["id"]:
                    e["toZone"] = zone_of_vnum[e["to"]]
            if "teleport" in room:
                t = room["teleport"]["target"]
                if t in zone_of_vnum and zone_of_vnum[t] != z["id"]:
                    room["teleport"]["toZone"] = zone_of_vnum[t]
        filename = f"{z['id']}-{slugify(z['name'])}.json"
        data = dict(z, rooms=zrooms)
        (out_zones / filename).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        index.append({
            "id": z["id"], "name": z["name"], "bottom": z["bottom"], "top": z["top"],
            "roomCount": len(zrooms), "file": f"zones/{filename}",
        })

    (args.out / "zones.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    print(f"{len(rooms)} rooms in {len(index)} zones written to {args.out}"
          + (f" ({orphans} rooms outside any zone skipped)" if orphans else ""))


if __name__ == "__main__":
    main()
