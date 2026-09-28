"""Advertised level ranges for zones, from the in-game "help areas" entry
(lib/help_table, "AREAS"), which the help itself calls ROUGH.

The help names areas loosely, so each is matched to zone ids by hand. Only
confident matches are listed; Abbarach and Rhyodin ("not sure"), and
Lycanthropia, Bay Isle, Orshingal and Ivory tower (no matching zone) are
left out. Zones not listed here get an estimate from their mob levels.

Each entry: zone ids -> (min level, max level or None for "and up", text as
the help gives it).
"""

HELP_AREAS = [
    ((247, 24791), 1, 5, "1–5"),          # DeadHamme
    ((66,), 10, 40, "10–40"),             # Prydain
    ((170,), 10, 15, "10–15"),            # White Plume
    ((37,), 10, 30, "10–30"),             # Arena (Felix)
    ((16,), 10, 50, "10–30 / 30–50"),     # Mages tower (lower, upper levels)
    ((82,), 15, 30, "15–30"),             # Hill giants
    ((131, 13799), 20, 50, "20–50"),      # Graecia
    ((15101,), 5, None, "5–15 / 10+"),    # Skexies (two parts)
    ((130,), 1, 50, "all"),               # New Thalos
    ((68,), 5, 20, "5–20"),               # Artica
    ((109,), 5, 10, "5–10"),              # Temple Labyrinth
    ((192,), 5, 10, "5–10"),              # Mistamere
    ((3,), 1, 10, "1–10"),                # Temple Annex
    ((70, 71, 72), 5, 20, "5–20"),        # Sewers
    ((40, 41), 3, 20, "3–20"),            # Moria
    ((11,), 3, None, "3–15+"),            # Shire
    ((52,), 10, 20, "10–20"),             # Thalos
    ((65,), 10, 30, "10–30"),             # Dwarven Kingdom
    ((51,), 20, 40, "20–40"),             # Drow
    ((53,), 15, 30, "15–30"),             # The Pyramid
    ((200,), 5, 50, "5–50"),              # Arachnos
    ((110,), 5, 30, "5–30"),              # Castle Python
    ((219,), 1, 9, "1–9"),                # Elven Forest
    ((300,), 45, None, "45+"),            # Ravenloft
    ((28,), 15, 30, "15–30"),             # Astral Plane
    ((23,), 10, 25, "10–25"),             # Jungles of Chult
    ((24, 25), 28, 50, "28–50"),          # Jungle Pyramid
    ((100,), 1, 25, "1–25"),              # Spider Haunt
    ((4,), 1, 10, "1–10"),                # Doom
    ((190,), 20, 50, "20–50"),            # Torture Keep
]


def advertised_levels():
    out = {}
    for ids, lo, hi, text in HELP_AREAS:
        for zone_id in ids:
            out[zone_id] = {"min": lo, "max": hi, "text": text, "source": "help"}
    return out


def estimated_levels(mob_levels):
    """The middle half of a zone's mob levels (one entry per loaded mob), which
    skips the odd shopkeeper or boss at either end. Needs a few mobs to mean
    anything."""
    if len(mob_levels) < 3:
        return None
    lv = sorted(mob_levels)
    lo = lv[int(0.25 * (len(lv) - 1))]
    hi = lv[int(round(0.75 * (len(lv) - 1)))]
    lo = max(lo, 1)
    hi = max(hi, lo)
    return {"min": lo, "max": hi, "text": f"~{lo}–{hi}" if hi > lo else f"~{lo}", "source": "mobs"}
