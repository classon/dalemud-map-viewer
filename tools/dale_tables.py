"""Name tables copied from the DaleMUD source (src/constants.c, src/structs.h,
src/fight.c and src/spell_parser.c), used to turn numeric fields into text.

Bit tables are lists indexed by bit number; value tables by value.
"""

RACES = [
    "Half-Breed", "Human", "Moon-Elf", "Dwarven", "Halfling", "Gnome", "Reptilian", "Mysterion",
    "Lycanthropian", "Draconian", "Undead", "Orcish", "Insectoid", "Arachnoid", "Saurian", "Icthyiod",
    "Avian", "Giant", "Carnivororous", "Parasitic", "Slime", "Demonic", "Snake", "Herbivorous", "Tree",
    "Vegan", "Elemental", "Planar", "Diabolic", "Ghostly", "Goblinoid", "Trollish", "Vegman",
    "Mindflayer", "Primate", "Enfan", "Dark-Elf", "Golem", "Skexie", "Troglodyte", "Patryn",
    "Labrynthian", "Sartan", "Tytan", "Smurf", "Kangaroo", "Horse", "Ratperson", "Astralion", "God",
    "Giant Hill", "Giant Frost", "Giant Fire", "Giant Cloud", "Giant Storm", "Giant Stone",
    "Dragon Red", "Dragon Black", "Dragon Green", "Dragon White", "Dragon Blue", "Dragon Silver",
    "Dragon Gold", "Dragon Bronze", "Dragon Copper", "Dragon Brass", "Undead Vampire", "Undead Lich",
    "Undead Wight", "Undead Ghast", "Undead Spectre", "Undead Zombie", "Undead Skeleton",
    "Undead Ghoul", "Half-Elven", "Half-Ogre", "Half-Orc", "Half-Giant", "Lizardman", "Dark-Dwarf",
    "Deep-Gnome", "Gnoll", "Gold-Elf", "Wild-Elf", "Sea-Elf",
]

SEXES = ["neutral", "male", "female"]

POSITIONS = [
    "dead", "mortally wounded", "incapacitated", "stunned", "sleeping", "resting", "sitting",
    "fighting", "standing", "mounted",
]

# specials.act bits. Bits 21-30 are the mob's classes and are split out.
ACT_BITS = [
    "spec", "sentinel", "scavenger", "isnpc", "nice thief", "aggressive", "stay zone", "wimpy",
    "annoying", "hateful", "afraid", "immortal", "hunting", "deadly", "polymorphed",
    "meta aggressive", "guarding", "illusion", "huge", "script", "greet",
]
CLASS_BITS = {
    21: "magic user", 22: "warrior", 23: "cleric", 24: "thief", 25: "druid", 26: "monk",
    27: "barbarian", 28: "paladin", 29: "ranger", 30: "psionist",
}
ACT_ISNPC = 1 << 3
ACT_SCRIPT = 1 << 19

AFFECT_BITS = [
    "blind", "invisible", "detect evil", "detect invisible", "detect magic", "sense life", "hold",
    "sanctuary", "dragon ride", "growth", "curse", "flying", "poison", "tree travel", "paralysis",
    "infravision", "water breath", "sleep", "travelling", "sneak", "hide", "silence", "charm",
    "follow", "protect from evil", "true sight", "scrying", "fireshield", "group", "telepathy",
]

IMMUNITY_BITS = [
    "fire", "cold", "electricity", "energy", "blunt", "pierce", "slash", "acid", "poison", "drain",
    "sleep", "charm", "hold", "non-magic", "+1", "+2", "+3", "+4",
]

ITEM_TYPES = [
    "undefined", "light", "scroll", "wand", "staff", "weapon", "fire weapon", "missile", "treasure",
    "armor", "potion", "worn", "other", "trash", "trap", "container", "note", "liquid container",
    "key", "food", "money", "pen", "boat", "audio", "board", "tree", "rock",
]

WEAR_BITS = [
    "take", "finger", "neck", "body", "head", "legs", "feet", "hands", "arms", "shield", "about",
    "waist", "wrist", "wield", "hold", "throw", "light source", "back", "ears", "eyes",
]

EXTRA_BITS = [
    "glow", "hum", "metal", "mineral", "organic", "invisible", "magic", "nodrop", "bless",
    "anti-good", "anti-evil", "anti-neutral", "anti-cleric", "anti-mage", "anti-thief",
    "anti-warrior", "brittle", "resistant", "artifact", "anti-men", "anti-women", "anti-sun",
    "anti-barbarian", "anti-ranger", "anti-paladin", "anti-psionist", "anti-monk", "anti-druid",
    "only-class",
]

# Equipment slots, indexed by the E command's position argument.
WEAR_POSITIONS = [
    "light", "right finger", "left finger", "neck", "neck", "body", "head", "legs", "feet",
    "hands", "arms", "shield", "about body", "waist", "right wrist", "left wrist", "wielded",
    "held", "back", "right ear", "left ear", "eyes", "loaded",
]

APPLY_TYPES = [
    "none", "str", "dex", "int", "wis", "con", "chr", "sex", "level", "age", "weight", "height",
    "mana", "hit points", "move", "gold", "exp", "armor", "hitroll", "damroll", "save vs para",
    "save vs rod", "save vs petri", "save vs breath", "save vs spell", "save all", "resistance",
    "susceptibility", "immunity", "spell affect", "weapon spell", "eat spell", "backstab", "kick",
    "sneak", "hide", "bash", "pick", "steal", "track", "hit & dam", "spellfail", "attacks", "haste",
    "slow", "affect 2", "find traps", "ride", "race slayer", "align slayer", "mana regen",
    "hit regen", "move regen", "thirst", "hunger", "drunk", "temp str", "temp int", "temp dex",
    "temp wis", "temp con", "temp chr", "temp hp", "temp move", "temp mana",
]
APPLY_IMMUNE_TYPES = (26, 27, 28)
APPLY_SPELL_AFFECT = 29
APPLY_SPELL_NUMBER = (30, 31)
APPLY_RACE_SLAYER = 48

ATTACK_TYPES = [
    "hit", "pound", "pierce", "slash", "whip", "claw", "bite", "sting", "crush", "cleave", "stab",
    "smash", "smite", "blast", "strike",
]

DRINKS = [
    "water", "beer", "wine", "ale", "dark ale", "whisky", "lemonade", "firebreather",
    "local speciality", "slime mold juice", "milk", "tea", "coffee", "blood", "salt water",
    "coca cola",
]

# Spell numbers start at 1.
SPELLS = [None] + """armor|teleport|bless|blindness|burning hands|call lightning|charm person|chill touch|
clone|colour spray|control weather|create food|create water|cure blind|cure critic|cure light|curse|
detect evil|detect invisibility|detect magic|detect poison|dispel evil|earthquake|enchant weapon|
energy drain|fireball|harm|heal|invisibility|lightning bolt|locate object|magic missile|poison|
protection from evil|remove curse|sanctuary|shocking grasp|sleep|strength|summon|ventriloquate|
word of recall|remove poison|sense life|sneak|hide|steal|backstab|pick|kick|bash|rescue|identify|
infravision|cause light|cause critical|flamestrike|dispel good|weakness|dispel magic|knock|
know alignment|animate dead|paralyze|remove paralysis|fear|acid blast|water breath|fly|cone of cold|
meteor swarm|ice storm|shield|monsum one|monsum two|monsum three|monsum four|monsum five|monsum six|
monsum seven|fireshield|charm monster|cure serious|cause serious|refresh|second wind|turn|succor|
create light|continual light|calm|stone skin|conjure elemental|true sight|minor creation|faerie fire|
faerie fog|cacaodemon|polymorph self|mana|astral walk|resurrection|heroes feast|group fly|breath|web|
minor track|major track|golem|find familiar|changestaff|holy word|unholy word|power word kill|
power word blind|chain lightning|scare|aid|command|change form|feeblemind|shillelagh|goodberry|
flame blade|animal growth|insect growth|creeping death|commune|animal summon one|animal summon two|
animal summon three|fire servant|earth servant|water servant|wind servant|reincarnate|
charm vegetable|vegetable growth|tree|animate rock|tree travel|travelling|animal friendship|
invis to animals|slow poison|entangle|snare|gust of wind|barkskin|sunray|warp weapon|heat stuff|
find traps|firestorm|haste|slowness|dust devil|know monster|transport via plant|speak with plants|
silence|sending|teleport without error|portal|dragon ride|mount|****|****|****|first aid|
sign language|riding|switch opponents|dodge|remove trap|retreat|quivering palm|safe fall|
feign death|hunt|find trap|spring leap|disarm|read magic|evauluate|spy|doorbash|swim|necromancy|
vegetable lore|demonology|animal lore|reptile lore|people lore|giant lore|other lore|disguise|climb|
***|***|***|***|***|***|***|***|berserk|tan|avoid back attack|find food|find water|pray|memorizing|
bellow|darkness|minor invulnerability|major invulnerability|protection from drain|
protection from breath|anti magic shell|doorway|psi portal|psi summon|psi invisibility|canibalize|
flame shroud|aura sight|great sight|psionic blast|hypnosis|meditate|scry|adrenalize|brew|ration|
warcry|blessing|lay on hands|heroic rescue|dual wield|psi shield|protection from evil group|
prismatic spray|incendiary cloud|disintergrate|language common|language elvish|language halfling|
language dwarvish|language orcish|language giantish|language ogre|language gnomish|esp|
comprehend languages|protection from fire|protection from cold|protection from energy|
protection from electricity|enchant armor|messenger|protection fire breath|
protection frost breath|protection electric breath|protection acid breath|protection gas breath|
wizardeye|mind burn|clairvoyance|psionic danger sense|psionic disintergrate|telekinesis|levitation|
cell adjustment|chameleon|psionic strength|mind over body|probability travel|psionic teleport|
domination|mind wipe|psychic crush|tower of iron will|mindblank|psychic impersonation|ultra blast|
intensify|spot""".replace("\n", "").split("|")


def bits(value, table, offset=0):
    """Names of the set bits in value, for a table indexed by bit number."""
    names = []
    for i, name in enumerate(table):
        if name and value & (1 << (i + offset)):
            names.append(name)
    return names


def lookup(table, index, fallback="unknown"):
    if isinstance(index, int) and 0 <= index < len(table) and table[index]:
        return table[index]
    return f"{fallback} ({index})"


def spell_name(num):
    if num is None or num <= 0:
        return None
    return lookup(SPELLS, num, "spell")
