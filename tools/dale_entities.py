"""Mob and object prototypes, and the zone reset replay that places them.

Parsing mirrors read_mobile(), read_obj_from_file() and reset_zone() in the
original src/db.c. Each prototype is parsed from its own '#<vnum>' block, the
way the game seeks to an index position, so one malformed entry can't derail
the rest of the file.
"""

import re
import sys
from pathlib import Path

from dale_reader import Reader
from dale_tables import (
    ACT_BITS, ACT_ISNPC, ACT_SCRIPT, AFFECT_BITS, APPLY_IMMUNE_TYPES, APPLY_RACE_SLAYER,
    APPLY_SPELL_AFFECT, APPLY_SPELL_NUMBER, APPLY_TYPES, ATTACK_TYPES, CLASS_BITS, DRINKS,
    EXTRA_BITS, IMMUNITY_BITS, ITEM_TYPES, POSITIONS, RACES, SEXES, WEAR_BITS, WEAR_POSITIONS,
    bits, lookup, spell_name,
)

_block_start = re.compile(r"^#(\d+)[ \t]*\r?$", re.M)
_dice = re.compile(r"(\d+)[dD](\d+)([+-]\d+)?")


def split_blocks(text):
    """Yield (vnum, body) for each '#<vnum>' entry, stopping at '#99999' or '$'."""
    matches = list(_block_start.finditer(text))
    for i, m in enumerate(matches):
        vnum = int(m.group(1))
        if vnum >= 99999:
            break
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.end():end]
        dollar = re.search(r"^\$", body, re.M)
        if dollar:
            body = body[:dollar.start()]
        yield vnum, body.lstrip("\r\n")


def read_dice(r):
    tok = r.token()
    m = _dice.fullmatch(tok)
    if not m:
        raise ValueError(f"expected dice like 2d6+3, got {tok!r}")
    n, size, bonus = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    return {"text": f"{n}d{size}{bonus:+d}" if bonus else f"{n}d{size}",
            "avg": round(n * (size + 1) / 2 + bonus)}


# ---------------------------------------------------------------- mobs

def parse_mob(vnum, body, mob):
    """Fill mob in place, so a malformed entry keeps whatever parsed before the error."""
    r = Reader(body)
    mob["keywords"] = r.string().strip()
    mob["name"] = r.string().strip()
    mob["long"] = r.string().strip()
    mob["desc"] = r.string()
    act = r.int() | ACT_ISNPC
    affected = r.int()
    mob["alignment"] = r.int()
    letter = r.token()
    mob["format"] = letter

    if letter not in "SANBL" or len(letter) != 1:
        raise ValueError(f"unsupported mob format {letter!r}")
    if letter in "ABL":
        mob["attacks"] = r.int()
    level = r.int()
    mob["level"] = level
    mob["thac0"] = r.int()
    ac = r.int()
    if letter == "S":
        if ac > 10 or ac < -10:
            ac = int(ac / 10)  # C integer division truncates toward zero
        mob["ac"] = ac
        mob["hp"] = read_dice(r)
    else:
        mob["ac"] = ac
        bonus = r.int()
        # max_hit = dice(level, 8) + bonus
        mob["hp"] = {"text": f"{level}d8{bonus:+d}" if bonus else f"{level}d8",
                     "avg": round(level * 4.5 + bonus)}
    mob["damage"] = read_dice(r)

    gold = r.int()
    race = 0
    if gold == -1:
        gold = r.int()
        exp = r.int()
        race = r.int()
    else:
        exp = r.int()
    mob["gold"] = gold
    # A/N/L/B mobs compute experience at load time (DetermineExp); a negative
    # value is an explicit override. S mobs store it directly.
    if letter == "S":
        mob["exp"] = exp
    elif exp < 0:
        mob["exp"] = -exp
    mob["race"] = lookup(RACES, race, "race")

    mob["position"] = lookup(POSITIONS, r.int(), "position")
    mob["defaultPosition"] = lookup(POSITIONS, r.int(), "position")
    sex = r.int()
    resist = immune = susc = 0
    if 3 <= sex < 6:
        sex -= 3
        resist, immune, susc = r.int(), r.int(), r.int()
    elif sex >= 6:
        sex = 0
    mob["sex"] = lookup(SEXES, sex, "sex")

    if letter == "L":
        near, far = r.string().strip(), r.string().strip()
        if near or far:
            mob["sounds"] = {"near": near, "far": far}

    if letter == "B":
        act |= 1 << 18  # ACT_HUGE
    act &= ~(ACT_ISNPC | ACT_SCRIPT)
    mob["classes"] = [name for bit, name in CLASS_BITS.items() if act & (1 << bit)]
    mob["flags"] = bits(act, ACT_BITS)
    mob["affects"] = bits(affected, AFFECT_BITS)
    # In the game "immune" is resistance and "M_immune" full immunity.
    mob["resist"] = bits(resist, IMMUNITY_BITS)
    mob["immune"] = bits(immune, IMMUNITY_BITS)
    mob["susceptible"] = bits(susc, IMMUNITY_BITS)


def parse_all(blocks, parse, kind, out):
    """Parse each block; keep partial entries that at least have a name."""
    bad = []
    for vnum, body in blocks:
        entry = {"vnum": vnum}
        try:
            parse(vnum, body, entry)
        except (ValueError, EOFError) as e:
            bad.append(vnum)
            if not entry.get("name"):
                continue
            entry["malformed"] = str(e)
        out[vnum] = entry
    if bad:
        print(f"note: {len(bad)} malformed {kind} entries kept partially or skipped: "
              + " ".join(f"#{v}" for v in bad), file=sys.stderr)
    return out


def parse_mobs(text):
    return parse_all(split_blocks(text), parse_mob, "mob", {})


# ---------------------------------------------------------------- objects

def describe_affect(loc, mod):
    label = lookup(APPLY_TYPES, loc, "apply")
    if loc in APPLY_IMMUNE_TYPES:
        value = ", ".join(bits(mod, IMMUNITY_BITS)) or str(mod)
    elif loc == APPLY_SPELL_AFFECT:
        value = ", ".join(bits(mod, AFFECT_BITS)) or str(mod)
    elif loc in APPLY_SPELL_NUMBER:
        value = spell_name(mod) or str(mod)
    elif loc == APPLY_RACE_SLAYER:
        value = lookup(RACES, mod, "race")
    else:
        value = f"{mod:+d}"
    return [label, value]


def describe_values(type_, v):
    """Readable stats for the four type-dependent object values."""
    spells = lambda *xs: ", ".join(s for s in map(spell_name, xs) if s)
    t = ITEM_TYPES[type_] if 0 <= type_ < len(ITEM_TYPES) else None
    if t == "weapon":
        return [["damage", f"{v[1]}d{v[2]}"], ["attack", lookup(ATTACK_TYPES, v[3], "type")]]
    if t == "armor":
        return [["armor", f"{v[0]:+d}"]]
    if t == "light":
        return [["hours", "infinite" if v[2] < 0 else str(v[2])]]
    if t in ("scroll", "potion"):
        return [["level", str(v[0])], ["spells", spells(v[1], v[2], v[3]) or "none"]]
    if t in ("wand", "staff"):
        return [["level", str(v[0])], ["charges", f"{v[2]} of {v[1]}"], ["spell", spells(v[3]) or "none"]]
    if t == "container":
        out = [["capacity", str(v[0])]]
        if v[2] > 0:
            out.append(["key", f"#{v[2]}"])
        return out
    if t == "liquid container":
        return [["holds", f"{v[1]} of {v[0]}"], ["liquid", lookup(DRINKS, v[2], "liquid")]]
    if t == "food":
        return [["filling", f"{v[0]} hours"]] + ([["poisoned", "yes"]] if v[3] else [])
    if t == "money":
        return [["coins", str(v[0])]]
    return []


def parse_object(vnum, body, obj):
    """Fill obj in place, so a malformed entry keeps whatever parsed before the error."""
    # Files in lib/objects/ repeat their '#<vnum>' header; skip any leftovers.
    body = re.sub(r"\A(\s*#\d+\s*\n)+", "", body)
    r = Reader(body)
    obj["keywords"] = r.string().strip()
    obj["name"] = r.string().strip()
    obj["long"] = r.string().strip()
    action = r.string().strip()
    if action:
        obj["action"] = action
    type_, extra, wear = r.int(), r.int(), r.int()
    values = [r.int() for _ in range(4)]
    obj["weight"], obj["cost"], obj["rent"] = r.int(), r.int(), r.int()
    obj["type"] = lookup(ITEM_TYPES, type_, "type")
    obj["extra"] = bits(extra, EXTRA_BITS)
    obj["wear"] = [w for w in bits(wear, WEAR_BITS) if w != "take"]
    obj["takeable"] = bool(wear & 1)
    obj["values"] = values
    obj["stats"] = describe_values(type_, values)

    extras, affects = [], []
    tok = r.peek_token()
    while tok == "E":
        r.token()
        r.pos = body.find("\n", r.pos) + 1 or len(body)
        extras.append({"keywords": r.string().strip(), "desc": r.string()})
        tok = r.peek_token()
    while tok == "A" and len(affects) < 5:  # MAX_OBJ_AFFECT
        r.token()
        loc, mod = r.int(), r.int()
        if loc:
            affects.append(describe_affect(loc, mod))
        tok = r.peek_token()
    obj["extras"] = extras
    obj["affects"] = affects


def parse_objects(text, override_dir=None):
    objs = parse_all(split_blocks(text), parse_object, "object", {})
    # lib/objects/<vnum> files replace or add prototypes, as in generate_indices().
    if override_dir and override_dir.is_dir():
        files = [(int(f.name), f.read_text(encoding="latin-1"))
                 for f in sorted(override_dir.iterdir()) if f.name.isdigit()]
        parse_all(files, parse_object, "object override", objs)
    return objs


# ---------------------------------------------------------------- zone resets

COMMANDS_WITH_ARG3 = set("MOCEPD")


def parse_commands(lines):
    """Parse reset command lines as boot_zones()/LoadZoneFile() do."""
    cmds = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("*"):
            continue
        if line.startswith("S"):
            break
        letter = line[0]
        nums = []
        for tok in line[1:].split():
            if not re.fullmatch(r"-?\d+", tok):
                break
            nums.append(int(tok))
        want = 4 if letter in COMMANDS_WITH_ARG3 else 3
        if len(nums) < want:
            continue
        cmds.append((letter, *nums[:want]) + ((None,) if want == 3 else ()))
    return cmds


def replay_resets(zones, mob_protos, obj_protos, room_exists):
    """Run every zone's reset table once, in boot order, from an empty world.

    Returns (spawns, room_items, stats). spawns is a list of mob instances with
    their equipment and inventory; room_items maps a room vnum to the object
    instances lying there. Counts are global per prototype, as in the game.
    """
    mob_count, obj_count = {}, {}
    last_obj = {}  # vnum -> most recent instance, like get_obj_num()
    room_items = {}
    spawns = []
    stats = {"eqConflicts": 0, "missingProtos": 0}

    def new_obj(vnum):
        obj_count[vnum] = obj_count.get(vnum, 0) + 1
        inst = {"obj": vnum}
        last_obj[vnum] = inst
        return inst

    for zone in zones:
        mob = master = None
        last_cmd = True
        for letter, if_flag, a1, a2, a3 in zone["commands"]:
            if not (last_cmd or if_flag <= 0):
                last_cmd = False
                continue
            if letter in "MC" and a1 not in mob_protos or letter in "OGEP" and a1 not in obj_protos:
                stats["missingProtos"] += 1
                last_cmd = False
                continue

            if letter in "MC":
                if mob_count.get(a1, 0) >= a2:
                    last_cmd = False
                    continue
                if letter == "C" and master is None:
                    last_cmd = False
                    continue
                room = a3 if letter == "M" else master["room"]
                if letter == "M" and not room_exists(room):
                    last_cmd = False
                    continue
                mob_count[a1] = mob_count.get(a1, 0) + 1
                mob = {"mob": a1, "room": room, "equipment": [], "inventory": []}
                if letter == "C":
                    mob["follows"] = master
                else:
                    master = mob
                spawns.append(mob)
                last_cmd = True
            elif letter == "O":
                if obj_count.get(a1, 0) >= a2:
                    continue  # the game leaves last_cmd unchanged here
                if a3 >= 0 and room_exists(a3):
                    here = sum(1 for i in room_items.get(a3, []) if i["obj"] == a1)
                    limit = if_flag if if_flag > 0 else -if_flag + 1
                    if here < limit:
                        room_items.setdefault(a3, []).append(new_obj(a1))
                        last_cmd = True
                    else:
                        last_cmd = False
                else:
                    new_obj(a1)
                    last_cmd = True
            elif letter == "P":
                target = last_obj.get(a3)
                if obj_count.get(a1, 0) < a2 and target is not None:
                    target.setdefault("contents", []).append(new_obj(a1))
                    last_cmd = True
                else:
                    last_cmd = False
            elif letter == "G":
                if obj_count.get(a1, 0) < a2 and mob is not None:
                    mob["inventory"].append(new_obj(a1))
                    last_cmd = True
                else:
                    last_cmd = False
            elif letter == "E":
                if obj_count.get(a1, 0) < a2 and mob is not None:
                    inst = new_obj(a1)
                    if any(e["pos"] == a3 for e in mob["equipment"]):
                        stats["eqConflicts"] += 1
                    else:
                        mob["equipment"].append(dict(inst, pos=a3, slot=lookup(WEAR_POSITIONS, a3, "slot")))
                        last_obj[a1] = mob["equipment"][-1]
                    last_cmd = True
                else:
                    last_cmd = False
            elif letter == "D":
                last_cmd = True
            # Z, H and F don't change where anything loads.

    return spawns, room_items, stats


def load_saved_zone_commands(zones_dir, zones):
    """lib/zones/<index>.zon replaces that zone's command table (boot_saved_zones)."""
    replaced = 0
    if not zones_dir.is_dir():
        return replaced
    for f in zones_dir.iterdir():
        idx = int(re.match(r"\d*", f.name).group(0) or 0)
        if not idx or idx >= len(zones):
            continue
        zones[idx]["commands"] = parse_commands(f.read_text(encoding="latin-1").splitlines())
        replaced += 1
    return replaced


def collect_objects(instances, into):
    for inst in instances:
        into.add(inst["obj"])
        collect_objects(inst.get("contents", []), into)


def write_catalog(path: Path, protos, loads):
    """Every prototype, each with the list of places it loads at boot."""
    import json
    entries = [dict(p, loads=loads.get(v, [])) for v, p in sorted(protos.items())]
    path.write_text(json.dumps(entries, separators=(",", ":")), encoding="utf-8")
