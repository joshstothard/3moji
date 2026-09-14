/**
 * The curated layer over the immutable CLDR names
 * ([ADR-0005](../../../../docs/adr/0005-the-emoji-set.md) decision 3).
 *
 * **Hand-authored data — not generated.** `emoji-candidates.generated.ts` is
 * produced from Unicode's own data by `scripts/generate-emoji-set.mjs`, and the
 * CLDR `spokenName` it carries is immutable. This module is the layer that sits
 * on top, holding names only: what the product says and shows, what a search
 * matches, and the plural the collapsed spoken form needs. Keeping it in its own
 * module is what lets `npm run generate:emoji` stay a no-op.
 *
 * Every row is keyed by the emoji's code point — the single-character string
 * that splitting a canonicalised Handle path yields, which is the key
 * `findEmojiByCodepoint` uses. The `U+XXXX` notation is provenance, not a lookup
 * key (see `docs/architecture/data-model.md` § Emoji Set).
 *
 * **There is one row per released emoji, and only for released emoji.** The
 * curation pass is per-drop (ADR-0007 decision 5): releasing a category means
 * adding its rows here alongside the one-line edit to `RELEASED_CATEGORIES`.
 * `emoji-curation.test.ts` asserts the key set equals the released set exactly,
 * so a missing or stray row is a red test rather than a silent gap.
 */
import type { EmojiCategory } from "./emoji-category";

/**
 * Which indefinite article the display name takes, or `"none"` for a name that
 * takes no article at all.
 *
 * `"none"` covers the plural and mass-noun names the CLDR list contains —
 * "chopsticks", "sparkles", "popcorn". Without it the collapsed spoken form
 * reads "a chopsticks".
 */
export type EmojiArticle = "a" | "an" | "none";

/** One hand-authored row of the curated layer. */
export interface EmojiCuration {
  /**
   * The CLDR short name of the emoji this row is keyed to, repeated here.
   *
   * Redundant on purpose: the set contains near-identical glyph pairs
   * (🐵/🐒, 🐶/🐕, 🐱/🐈, 🐭/🐁/🐀), so a row attached to the wrong key would
   * still satisfy every other assertion. The test asserts this against the set's
   * own `spokenName` for the key, which turns a mis-keyed row red.
   */
  readonly spokenName: string;
  /**
   * What the product says and shows, where the CLDR name reads badly aloud.
   *
   * Omitted — and so defaulted to `spokenName` — everywhere the canonical name
   * already reads well, which is the large majority. ADR-0005 decision 3 makes
   * this a review pass, not an authoring pass.
   */
  readonly displayName?: string;
  /**
   * The plural, stored rather than derived. English plurals are not mechanical
   * and the released set is small enough to write down (ADR-0005, consequences).
   */
  readonly plural: string;
  /**
   * Search-only alternatives. Never shown or spoken, so a regional name
   * ("aubergine") or a more common word than the canonical one ("ice cube")
   * belongs here whether or not `displayName` was overridden.
   */
  readonly synonyms?: readonly string[];
  /**
   * Omitted where the default vowel rule is right. Overridden where
   * pronunciation beats spelling ("a unicorn", "a ewe") and where the name is
   * plural or a mass noun and takes no article.
   */
  readonly article?: EmojiArticle;
  /**
   * The word this emoji's position takes in its canonical word alias, set only
   * where the `displayName` slug also names another emoji
   * ([ADR-0011](../../../../docs/adr/0011-canonical-word-aliases-name-one-handle-and-unclaimed-aliases-list-claimable-handles.md)).
   *
   * It must already be one of this row's own terms and name no other emoji, so
   * the canonical alias names exactly one Handle. `alias.test.ts` enforces both
   * over the released set, and also that it is absent wherever the display name
   * is already unique. Changing it for a released emoji changes a published
   * URL, exactly as renaming `displayName` does.
   */
  readonly aliasName?: string;
}

/**
 * The curated rows, grouped by category so a drop's pass is reviewable as one
 * contiguous block of the diff.
 */
type CurationTable = Readonly<Record<string, EmojiCuration>>;

/** Food & Drink — released at launch (113 emoji). */
const FOOD_AND_DRINK: CurationTable = {
  "🍇": {
    spokenName: "grapes",
    plural: "grapes",
    synonyms: ["grape", "bunch of grapes"],
    article: "none",
  },
  "🍈": {
    spokenName: "melon",
    plural: "melons",
  },
  "🍉": {
    spokenName: "watermelon",
    plural: "watermelons",
  },
  "🍊": {
    spokenName: "tangerine",
    plural: "tangerines",
    synonyms: ["orange", "mandarin", "satsuma"],
  },
  "🍋": {
    spokenName: "lemon",
    plural: "lemons",
  },
  "🍌": {
    spokenName: "banana",
    plural: "bananas",
  },
  "🍍": {
    spokenName: "pineapple",
    plural: "pineapples",
  },
  "🥭": {
    spokenName: "mango",
    plural: "mangoes",
  },
  "🍎": {
    spokenName: "red apple",
    plural: "red apples",
    synonyms: ["apple", "fruit"],
  },
  "🍏": {
    spokenName: "green apple",
    plural: "green apples",
    synonyms: ["apple", "fruit"],
  },
  "🍐": {
    spokenName: "pear",
    plural: "pears",
  },
  "🍑": {
    spokenName: "peach",
    plural: "peaches",
  },
  "🍒": {
    spokenName: "cherries",
    plural: "cherries",
    synonyms: ["cherry"],
    article: "none",
  },
  "🍓": {
    spokenName: "strawberry",
    plural: "strawberries",
  },
  "🥝": {
    spokenName: "kiwi fruit",
    plural: "kiwi fruits",
    synonyms: ["kiwi"],
  },
  "🍅": {
    spokenName: "tomato",
    plural: "tomatoes",
  },
  "🥥": {
    spokenName: "coconut",
    plural: "coconuts",
  },
  "🥑": {
    spokenName: "avocado",
    plural: "avocados",
  },
  "🍆": {
    spokenName: "eggplant",
    // ADR-0007's consequences call this the aubergine, and an accepted ADR is
    // immutable — so the data follows the decision, not the other way round.
    // 3moji is a British product; "eggplant" survives as a synonym so a search
    // for it still works.
    displayName: "aubergine",
    plural: "aubergines",
    synonyms: ["eggplant"],
  },
  "🥔": {
    spokenName: "potato",
    plural: "potatoes",
    synonyms: ["spud"],
  },
  "🥕": {
    spokenName: "carrot",
    plural: "carrots",
  },
  "🌽": {
    spokenName: "ear of corn",
    plural: "ears of corn",
    synonyms: ["corn", "corn on the cob", "maize"],
  },
  "🥒": {
    spokenName: "cucumber",
    plural: "cucumbers",
  },
  "🥬": {
    spokenName: "leafy green",
    plural: "leafy greens",
    synonyms: ["bok choy", "lettuce", "cabbage", "greens"],
  },
  "🥦": {
    spokenName: "broccoli",
    displayName: "head of broccoli",
    plural: "heads of broccoli",
    synonyms: ["broccoli"],
  },
  "🧄": {
    spokenName: "garlic",
    displayName: "bulb of garlic",
    plural: "bulbs of garlic",
    synonyms: ["garlic"],
  },
  "🧅": {
    spokenName: "onion",
    plural: "onions",
  },
  "🥜": {
    spokenName: "peanuts",
    plural: "peanuts",
    synonyms: ["peanut", "nuts"],
    article: "none",
  },
  "🌰": {
    spokenName: "chestnut",
    plural: "chestnuts",
  },
  "🍞": {
    spokenName: "bread",
    displayName: "loaf of bread",
    plural: "loaves of bread",
    synonyms: ["bread", "toast"],
  },
  "🥐": {
    spokenName: "croissant",
    plural: "croissants",
  },
  // "a baguette bread" is a redundant compound nobody says, and it leaves the
  // singular and the plural in different registers.
  "🥖": {
    spokenName: "baguette bread",
    displayName: "baguette",
    plural: "baguettes",
    synonyms: ["baguette bread", "french bread"],
  },
  "🥨": {
    spokenName: "pretzel",
    plural: "pretzels",
  },
  "🥯": {
    spokenName: "bagel",
    plural: "bagels",
  },
  "🥞": {
    spokenName: "pancakes",
    plural: "pancakes",
    synonyms: ["pancake", "flapjack"],
    article: "none",
  },
  "🧇": {
    spokenName: "waffle",
    plural: "waffles",
  },
  "🧀": {
    spokenName: "cheese wedge",
    plural: "cheese wedges",
    synonyms: ["cheese"],
  },
  // The CLDR name takes no article and no count: "a meat on bone" and "three
  // meat on bone" are both wrong, so the plural names the portion instead.
  "🍖": {
    spokenName: "meat on bone",
    plural: "portions of meat on bone",
    synonyms: ["meat", "drumstick", "chop"],
    article: "none",
  },
  "🍗": {
    spokenName: "poultry leg",
    plural: "poultry legs",
    synonyms: ["chicken leg", "drumstick"],
  },
  "🥩": {
    spokenName: "cut of meat",
    plural: "cuts of meat",
    synonyms: ["steak", "meat"],
  },
  "🥓": {
    spokenName: "bacon",
    displayName: "strip of bacon",
    plural: "strips of bacon",
    synonyms: ["bacon", "rasher"],
  },
  "🍔": {
    spokenName: "hamburger",
    plural: "hamburgers",
    synonyms: ["burger"],
  },
  "🍟": {
    spokenName: "french fries",
    plural: "french fries",
    synonyms: ["chips", "fries"],
    article: "none",
  },
  "🍕": {
    spokenName: "pizza",
    plural: "pizzas",
  },
  "🌭": {
    spokenName: "hot dog",
    plural: "hot dogs",
  },
  "🥪": {
    spokenName: "sandwich",
    plural: "sandwiches",
  },
  "🌮": {
    spokenName: "taco",
    plural: "tacos",
  },
  "🌯": {
    spokenName: "burrito",
    plural: "burritos",
  },
  "🥙": {
    spokenName: "stuffed flatbread",
    plural: "stuffed flatbreads",
    synonyms: ["kebab", "gyro", "pita"],
  },
  "🧆": {
    spokenName: "falafel",
    plural: "falafels",
  },
  "🥚": {
    spokenName: "egg",
    plural: "eggs",
  },
  "🍳": {
    spokenName: "cooking",
    displayName: "fried egg",
    plural: "fried eggs",
    synonyms: ["cooking", "frying pan"],
  },
  "🥘": {
    spokenName: "shallow pan of food",
    plural: "shallow pans of food",
    synonyms: ["paella", "pan"],
  },
  "🍲": {
    spokenName: "pot of food",
    plural: "pots of food",
    synonyms: ["stew", "casserole"],
  },
  "🥣": {
    spokenName: "bowl with spoon",
    plural: "bowls with spoons",
    synonyms: ["cereal", "porridge"],
  },
  "🥗": {
    spokenName: "green salad",
    plural: "green salads",
    synonyms: ["salad"],
  },
  "🍿": {
    spokenName: "popcorn",
    displayName: "bucket of popcorn",
    plural: "buckets of popcorn",
    synonyms: ["popcorn"],
  },
  "🧈": {
    spokenName: "butter",
    displayName: "stick of butter",
    plural: "sticks of butter",
    synonyms: ["butter"],
  },
  "🧂": {
    spokenName: "salt",
    displayName: "salt shaker",
    plural: "salt shakers",
    synonyms: ["salt", "seasoning"],
  },
  "🥫": {
    spokenName: "canned food",
    displayName: "can of food",
    plural: "cans of food",
    synonyms: ["tin", "canned food"],
  },
  "🍱": {
    spokenName: "bento box",
    plural: "bento boxes",
    synonyms: ["lunch box"],
  },
  "🍘": {
    spokenName: "rice cracker",
    plural: "rice crackers",
    synonyms: ["senbei"],
  },
  "🍙": {
    spokenName: "rice ball",
    plural: "rice balls",
    synonyms: ["onigiri"],
  },
  "🍚": {
    spokenName: "cooked rice",
    displayName: "bowl of rice",
    plural: "bowls of rice",
    synonyms: ["rice"],
  },
  "🍛": {
    spokenName: "curry rice",
    displayName: "plate of curry",
    plural: "plates of curry",
    synonyms: ["curry", "curry rice"],
  },
  "🍜": {
    spokenName: "steaming bowl",
    plural: "steaming bowls",
    synonyms: ["ramen", "noodles", "soup"],
  },
  "🍝": {
    spokenName: "spaghetti",
    displayName: "plate of spaghetti",
    plural: "plates of spaghetti",
    synonyms: ["spaghetti", "pasta"],
  },
  "🍠": {
    spokenName: "roasted sweet potato",
    plural: "roasted sweet potatoes",
    synonyms: ["sweet potato", "yam"],
  },
  "🍢": {
    spokenName: "oden",
    plural: "oden",
    synonyms: ["skewer", "kebab"],
  },
  "🍣": {
    spokenName: "sushi",
    plural: "sushi",
    synonyms: ["nigiri", "sashimi"],
    article: "none",
  },
  "🍤": {
    spokenName: "fried shrimp",
    plural: "fried shrimps",
    synonyms: ["prawn", "tempura"],
  },
  "🍥": {
    spokenName: "fish cake with swirl",
    plural: "fish cakes with swirls",
    synonyms: ["narutomaki", "fish cake"],
  },
  "🥮": {
    spokenName: "moon cake",
    plural: "moon cakes",
  },
  "🍡": {
    spokenName: "dango",
    plural: "dango",
    synonyms: ["mochi", "skewer"],
  },
  "🥟": {
    spokenName: "dumpling",
    plural: "dumplings",
    synonyms: ["gyoza", "potsticker", "pierogi"],
  },
  "🥠": {
    spokenName: "fortune cookie",
    plural: "fortune cookies",
  },
  "🥡": {
    spokenName: "takeout box",
    plural: "takeout boxes",
    synonyms: ["takeaway", "oyster pail"],
  },
  "🍦": {
    spokenName: "soft ice cream",
    plural: "soft ice creams",
    synonyms: ["ice cream", "soft serve", "cone"],
  },
  "🍧": {
    spokenName: "shaved ice",
    plural: "shaved ice",
    synonyms: ["snow cone", "kakigori"],
    article: "none",
  },
  "🍨": {
    spokenName: "ice cream",
    plural: "ice creams",
    synonyms: ["sundae"],
    // `ice cream` also names 🍦 (ADR-0011).
    aliasName: "sundae",
  },
  "🍩": {
    spokenName: "doughnut",
    plural: "doughnuts",
    synonyms: ["donut"],
  },
  "🍪": {
    spokenName: "cookie",
    plural: "cookies",
    synonyms: ["biscuit"],
  },
  "🎂": {
    spokenName: "birthday cake",
    plural: "birthday cakes",
    synonyms: ["cake", "birthday"],
  },
  "🍰": {
    spokenName: "shortcake",
    plural: "shortcakes",
    synonyms: ["cake", "slice of cake"],
  },
  "🧁": {
    spokenName: "cupcake",
    plural: "cupcakes",
    synonyms: ["fairy cake", "muffin"],
  },
  "🥧": {
    spokenName: "pie",
    plural: "pies",
  },
  "🍫": {
    spokenName: "chocolate bar",
    plural: "chocolate bars",
    synonyms: ["chocolate"],
  },
  "🍬": {
    spokenName: "candy",
    plural: "candies",
    synonyms: ["sweet", "sweets"],
  },
  "🍭": {
    spokenName: "lollipop",
    plural: "lollipops",
    synonyms: ["lolly"],
  },
  "🍮": {
    spokenName: "custard",
    plural: "custards",
    synonyms: ["flan", "pudding", "creme caramel"],
  },
  "🍯": {
    spokenName: "honey pot",
    plural: "honey pots",
    synonyms: ["honey"],
  },
  "🍼": {
    spokenName: "baby bottle",
    plural: "baby bottles",
    synonyms: ["milk bottle"],
  },
  "🥛": {
    spokenName: "glass of milk",
    plural: "glasses of milk",
    synonyms: ["milk"],
  },
  "☕": {
    spokenName: "hot beverage",
    displayName: "coffee cup",
    plural: "coffee cups",
    synonyms: ["coffee", "tea", "hot drink"],
  },
  "🍵": {
    spokenName: "teacup without handle",
    plural: "teacups without handles",
    synonyms: ["green tea", "tea"],
  },
  "🍶": {
    spokenName: "sake",
    displayName: "sake bottle",
    plural: "sake bottles",
    synonyms: ["sake", "rice wine"],
  },
  "🍾": {
    spokenName: "bottle with popping cork",
    plural: "bottles with popping corks",
    synonyms: ["champagne", "celebration", "prosecco"],
  },
  "🍷": {
    spokenName: "wine glass",
    plural: "wine glasses",
    synonyms: ["wine"],
  },
  "🍸": {
    spokenName: "cocktail glass",
    plural: "cocktail glasses",
    synonyms: ["martini", "cocktail"],
  },
  "🍹": {
    spokenName: "tropical drink",
    plural: "tropical drinks",
    synonyms: ["cocktail"],
  },
  "🍺": {
    spokenName: "beer mug",
    plural: "beer mugs",
    synonyms: ["beer", "pint"],
  },
  "🍻": {
    spokenName: "clinking beer mugs",
    plural: "clinking beer mugs",
    synonyms: ["beers", "cheers", "toast"],
    article: "none",
  },
  "🥂": {
    spokenName: "clinking glasses",
    plural: "clinking glasses",
    synonyms: ["champagne", "cheers", "toast"],
    article: "none",
  },
  "🥃": {
    spokenName: "tumbler glass",
    plural: "tumbler glasses",
    synonyms: ["whisky", "whiskey"],
  },
  "🥤": {
    spokenName: "cup with straw",
    plural: "cups with straws",
    synonyms: ["soda", "fizzy drink", "milkshake"],
  },
  "🧃": {
    spokenName: "beverage box",
    plural: "beverage boxes",
    synonyms: ["juice box", "carton"],
  },
  "🧉": {
    spokenName: "mate",
    displayName: "mate gourd",
    plural: "mate gourds",
    synonyms: ["mate", "yerba mate", "gourd"],
  },
  "🧊": {
    spokenName: "ice",
    displayName: "ice cube",
    plural: "ice cubes",
    synonyms: ["ice", "ice cubes", "frozen"],
  },
  "🥢": {
    spokenName: "chopsticks",
    plural: "chopsticks",
    synonyms: ["chopstick"],
    article: "none",
  },
  "🍴": {
    spokenName: "fork and knife",
    plural: "forks and knives",
    synonyms: ["cutlery", "restaurant"],
  },
  "🥄": {
    spokenName: "spoon",
    plural: "spoons",
  },
  "🔪": {
    spokenName: "kitchen knife",
    plural: "kitchen knives",
    synonyms: ["knife", "cleaver", "chef"],
  },
  "🏺": {
    spokenName: "amphora",
    plural: "amphoras",
    synonyms: ["vase", "jug", "urn"],
  },
};

/** Animals & Nature — released at launch (126 emoji). */
const ANIMALS_AND_NATURE: CurationTable = {
  "🐵": {
    spokenName: "monkey face",
    plural: "monkey faces",
  },
  "🐒": {
    spokenName: "monkey",
    plural: "monkeys",
  },
  "🦍": {
    spokenName: "gorilla",
    plural: "gorillas",
  },
  "🦧": {
    spokenName: "orangutan",
    plural: "orangutans",
  },
  "🐶": {
    spokenName: "dog face",
    plural: "dog faces",
    synonyms: ["puppy"],
  },
  "🐕": {
    spokenName: "dog",
    plural: "dogs",
    synonyms: ["puppy", "hound"],
  },
  "🦮": {
    spokenName: "guide dog",
    plural: "guide dogs",
    synonyms: ["assistance dog", "seeing eye dog"],
  },
  "🐩": {
    spokenName: "poodle",
    plural: "poodles",
  },
  "🐺": {
    spokenName: "wolf",
    plural: "wolves",
  },
  "🦊": {
    spokenName: "fox",
    plural: "foxes",
  },
  "🦝": {
    spokenName: "raccoon",
    plural: "raccoons",
  },
  "🐱": {
    spokenName: "cat face",
    plural: "cat faces",
    synonyms: ["kitten"],
  },
  "🐈": {
    spokenName: "cat",
    plural: "cats",
    synonyms: ["kitten", "kitty"],
  },
  "🦁": {
    spokenName: "lion",
    plural: "lions",
  },
  "🐯": {
    spokenName: "tiger face",
    plural: "tiger faces",
  },
  "🐅": {
    spokenName: "tiger",
    plural: "tigers",
  },
  "🐆": {
    spokenName: "leopard",
    plural: "leopards",
  },
  "🐴": {
    spokenName: "horse face",
    plural: "horse faces",
    synonyms: ["pony"],
  },
  "🐎": {
    spokenName: "horse",
    plural: "horses",
    synonyms: ["racehorse"],
  },
  "🦄": {
    spokenName: "unicorn",
    plural: "unicorns",
    article: "a",
  },
  "🦓": {
    spokenName: "zebra",
    plural: "zebras",
  },
  "🦌": {
    spokenName: "deer",
    plural: "deer",
    synonyms: ["stag", "doe"],
  },
  "🐮": {
    spokenName: "cow face",
    plural: "cow faces",
  },
  "🐂": {
    spokenName: "ox",
    plural: "oxen",
  },
  "🐃": {
    spokenName: "water buffalo",
    plural: "water buffaloes",
    synonyms: ["buffalo"],
  },
  "🐄": {
    spokenName: "cow",
    plural: "cows",
    synonyms: ["cattle"],
  },
  "🐷": {
    spokenName: "pig face",
    plural: "pig faces",
    synonyms: ["piglet"],
  },
  "🐖": {
    spokenName: "pig",
    plural: "pigs",
    synonyms: ["hog"],
  },
  "🐗": {
    spokenName: "boar",
    plural: "boars",
    synonyms: ["wild pig"],
  },
  "🐽": {
    spokenName: "pig nose",
    plural: "pig noses",
    synonyms: ["snout"],
  },
  "🐏": {
    spokenName: "ram",
    plural: "rams",
  },
  "🐑": {
    spokenName: "ewe",
    plural: "ewes",
    synonyms: ["sheep", "lamb"],
    article: "a",
  },
  "🐐": {
    spokenName: "goat",
    plural: "goats",
  },
  "🐪": {
    spokenName: "camel",
    plural: "camels",
    synonyms: ["dromedary"],
  },
  "🐫": {
    spokenName: "two-hump camel",
    plural: "two-hump camels",
    synonyms: ["bactrian camel"],
  },
  "🦙": {
    spokenName: "llama",
    plural: "llamas",
    synonyms: ["alpaca"],
  },
  "🦒": {
    spokenName: "giraffe",
    plural: "giraffes",
  },
  "🐘": {
    spokenName: "elephant",
    plural: "elephants",
  },
  "🦏": {
    spokenName: "rhinoceros",
    plural: "rhinoceroses",
    synonyms: ["rhino"],
  },
  "🦛": {
    spokenName: "hippopotamus",
    plural: "hippopotamuses",
    synonyms: ["hippo"],
  },
  "🐭": {
    spokenName: "mouse face",
    plural: "mouse faces",
  },
  "🐁": {
    spokenName: "mouse",
    plural: "mice",
  },
  "🐀": {
    spokenName: "rat",
    plural: "rats",
  },
  "🐹": {
    spokenName: "hamster",
    plural: "hamsters",
  },
  "🐰": {
    spokenName: "rabbit face",
    plural: "rabbit faces",
    synonyms: ["bunny"],
  },
  "🐇": {
    spokenName: "rabbit",
    plural: "rabbits",
    synonyms: ["bunny", "hare"],
  },
  "🦔": {
    spokenName: "hedgehog",
    plural: "hedgehogs",
  },
  "🦇": {
    spokenName: "bat",
    plural: "bats",
    // `bat` also names 🏓 (ADR-0011).
    aliasName: "bats",
  },
  "🐻": {
    spokenName: "bear",
    plural: "bears",
  },
  "🐨": {
    spokenName: "koala",
    plural: "koalas",
  },
  "🐼": {
    spokenName: "panda",
    plural: "pandas",
  },
  "🦥": {
    spokenName: "sloth",
    plural: "sloths",
  },
  "🦦": {
    spokenName: "otter",
    plural: "otters",
  },
  "🦨": {
    spokenName: "skunk",
    plural: "skunks",
  },
  "🦘": {
    spokenName: "kangaroo",
    plural: "kangaroos",
    synonyms: ["wallaby"],
  },
  "🦡": {
    spokenName: "badger",
    plural: "badgers",
    synonyms: ["honey badger"],
  },
  "🐾": {
    spokenName: "paw prints",
    plural: "paw prints",
    synonyms: ["paw print", "pawprint"],
    article: "none",
  },
  "🦃": {
    spokenName: "turkey",
    plural: "turkeys",
  },
  "🐔": {
    spokenName: "chicken",
    plural: "chickens",
    synonyms: ["hen"],
  },
  "🐓": {
    spokenName: "rooster",
    plural: "roosters",
    synonyms: ["cockerel"],
  },
  "🐣": {
    spokenName: "hatching chick",
    plural: "hatching chicks",
  },
  "🐤": {
    spokenName: "baby chick",
    plural: "baby chicks",
  },
  "🐥": {
    spokenName: "front-facing baby chick",
    plural: "front-facing baby chicks",
  },
  "🐦": {
    spokenName: "bird",
    plural: "birds",
  },
  "🐧": {
    spokenName: "penguin",
    plural: "penguins",
  },
  "🦅": {
    spokenName: "eagle",
    plural: "eagles",
  },
  "🦆": {
    spokenName: "duck",
    plural: "ducks",
  },
  "🦢": {
    spokenName: "swan",
    plural: "swans",
  },
  "🦉": {
    spokenName: "owl",
    plural: "owls",
  },
  "🦩": {
    spokenName: "flamingo",
    plural: "flamingos",
  },
  "🦚": {
    spokenName: "peacock",
    plural: "peacocks",
  },
  "🦜": {
    spokenName: "parrot",
    plural: "parrots",
  },
  "🐸": {
    spokenName: "frog",
    plural: "frogs",
    synonyms: ["toad"],
  },
  "🐊": {
    spokenName: "crocodile",
    plural: "crocodiles",
    synonyms: ["alligator"],
  },
  "🐢": {
    spokenName: "turtle",
    plural: "turtles",
    synonyms: ["tortoise"],
  },
  "🦎": {
    spokenName: "lizard",
    plural: "lizards",
    synonyms: ["gecko"],
  },
  "🐍": {
    spokenName: "snake",
    plural: "snakes",
    synonyms: ["serpent"],
  },
  "🐲": {
    spokenName: "dragon face",
    plural: "dragon faces",
  },
  "🐉": {
    spokenName: "dragon",
    plural: "dragons",
  },
  "🦕": {
    spokenName: "sauropod",
    plural: "sauropods",
    synonyms: ["dinosaur", "brontosaurus"],
  },
  "🦖": {
    spokenName: "T-Rex",
    plural: "T-Rexes",
    synonyms: ["dinosaur", "tyrannosaurus"],
  },
  "🐳": {
    spokenName: "spouting whale",
    plural: "spouting whales",
    synonyms: ["whale"],
  },
  "🐋": {
    spokenName: "whale",
    plural: "whales",
    // `whale` also names 🐳 (ADR-0011).
    aliasName: "whales",
  },
  "🐬": {
    spokenName: "dolphin",
    plural: "dolphins",
  },
  "🐟": {
    spokenName: "fish",
    plural: "fish",
  },
  "🐠": {
    spokenName: "tropical fish",
    plural: "tropical fish",
  },
  "🐡": {
    spokenName: "blowfish",
    plural: "blowfish",
    synonyms: ["pufferfish"],
  },
  "🦈": {
    spokenName: "shark",
    plural: "sharks",
  },
  "🐙": {
    spokenName: "octopus",
    plural: "octopuses",
  },
  "🐚": {
    spokenName: "spiral shell",
    plural: "spiral shells",
    synonyms: ["seashell", "conch"],
  },
  "🦀": {
    spokenName: "crab",
    plural: "crabs",
  },
  "🦞": {
    spokenName: "lobster",
    plural: "lobsters",
  },
  "🦐": {
    spokenName: "shrimp",
    plural: "shrimps",
    synonyms: ["prawn"],
  },
  "🦑": {
    spokenName: "squid",
    plural: "squid",
    synonyms: ["calamari"],
  },
  "🦪": {
    spokenName: "oyster",
    plural: "oysters",
    synonyms: ["pearl"],
  },
  "🐌": {
    spokenName: "snail",
    plural: "snails",
  },
  "🦋": {
    spokenName: "butterfly",
    plural: "butterflies",
  },
  "🐛": {
    spokenName: "bug",
    plural: "bugs",
    synonyms: ["caterpillar", "insect"],
  },
  "🐜": {
    spokenName: "ant",
    plural: "ants",
  },
  "🐝": {
    spokenName: "honeybee",
    plural: "honeybees",
    synonyms: ["bee", "bumblebee"],
  },
  "🐞": {
    spokenName: "lady beetle",
    plural: "lady beetles",
    synonyms: ["ladybird", "ladybug"],
  },
  "🦗": {
    spokenName: "cricket",
    plural: "crickets",
    synonyms: ["grasshopper", "insect"],
    // `cricket` also names 🏏 (ADR-0011).
    aliasName: "grasshopper",
  },
  "🦂": {
    spokenName: "scorpion",
    plural: "scorpions",
  },
  "🦟": {
    spokenName: "mosquito",
    plural: "mosquitoes",
  },
  "🦠": {
    spokenName: "microbe",
    plural: "microbes",
    synonyms: ["germ", "virus", "bacteria"],
  },
  "💐": {
    spokenName: "bouquet",
    plural: "bouquets",
    synonyms: ["flowers"],
  },
  "🌸": {
    spokenName: "cherry blossom",
    plural: "cherry blossoms",
    synonyms: ["sakura", "blossom"],
  },
  "💮": {
    spokenName: "white flower",
    plural: "white flowers",
  },
  "🌹": {
    spokenName: "rose",
    plural: "roses",
  },
  "🥀": {
    spokenName: "wilted flower",
    plural: "wilted flowers",
    synonyms: ["dead flower"],
  },
  "🌺": {
    spokenName: "hibiscus",
    plural: "hibiscuses",
  },
  "🌻": {
    spokenName: "sunflower",
    plural: "sunflowers",
  },
  "🌼": {
    spokenName: "blossom",
    plural: "blossoms",
    synonyms: ["flower"],
    // `blossom` also names 🌸 (ADR-0011).
    aliasName: "flower",
  },
  "🌷": {
    spokenName: "tulip",
    plural: "tulips",
  },
  "🌱": {
    spokenName: "seedling",
    plural: "seedlings",
    synonyms: ["sprout", "sapling"],
  },
  "🌲": {
    spokenName: "evergreen tree",
    plural: "evergreen trees",
    synonyms: ["pine tree", "fir", "conifer"],
  },
  "🌳": {
    spokenName: "deciduous tree",
    plural: "deciduous trees",
    synonyms: ["tree", "oak"],
  },
  "🌴": {
    spokenName: "palm tree",
    plural: "palm trees",
  },
  "🌵": {
    spokenName: "cactus",
    plural: "cacti",
  },
  "🌾": {
    spokenName: "sheaf of rice",
    plural: "sheaves of rice",
    synonyms: ["wheat", "rice", "barley"],
  },
  "🌿": {
    spokenName: "herb",
    plural: "herbs",
    synonyms: ["plant", "leaves"],
  },
  "🍀": {
    spokenName: "four leaf clover",
    plural: "four leaf clovers",
    synonyms: ["clover", "luck", "shamrock"],
  },
  "🍁": {
    spokenName: "maple leaf",
    plural: "maple leaves",
    synonyms: ["canada"],
  },
  "🍂": {
    spokenName: "fallen leaf",
    plural: "fallen leaves",
    synonyms: ["autumn", "fall"],
  },
  "🍃": {
    spokenName: "leaf fluttering in wind",
    plural: "leaves fluttering in wind",
    synonyms: ["leaf", "wind", "breeze"],
  },
  "🍄": {
    spokenName: "mushroom",
    plural: "mushrooms",
    synonyms: ["toadstool", "fungus"],
  },
};

/** Activities — released at launch (68 emoji). */
const ACTIVITIES: CurationTable = {
  "🎃": {
    spokenName: "jack-o-lantern",
    plural: "jack-o-lanterns",
    synonyms: ["pumpkin", "halloween"],
  },
  "🎄": {
    spokenName: "Christmas tree",
    plural: "Christmas trees",
    synonyms: ["christmas", "xmas"],
  },
  "🎆": {
    spokenName: "fireworks",
    plural: "fireworks",
    synonyms: ["firework", "celebration"],
    article: "none",
  },
  "🎇": {
    spokenName: "sparkler",
    plural: "sparklers",
    synonyms: ["firework"],
  },
  "🧨": {
    spokenName: "firecracker",
    plural: "firecrackers",
    synonyms: ["dynamite", "banger"],
  },
  "✨": {
    spokenName: "sparkles",
    plural: "sparkles",
    synonyms: ["sparkle", "glitter", "shiny"],
    article: "none",
  },
  "🎈": {
    spokenName: "balloon",
    plural: "balloons",
    synonyms: ["party"],
  },
  "🎉": {
    spokenName: "party popper",
    plural: "party poppers",
    synonyms: ["party", "celebration"],
  },
  "🎊": {
    spokenName: "confetti ball",
    plural: "confetti balls",
    synonyms: ["confetti", "celebration"],
  },
  "🎋": {
    spokenName: "tanabata tree",
    plural: "tanabata trees",
    synonyms: ["wish tree"],
  },
  "🎍": {
    spokenName: "pine decoration",
    plural: "pine decorations",
    synonyms: ["kadomatsu", "bamboo"],
  },
  "🎎": {
    spokenName: "Japanese dolls",
    plural: "Japanese dolls",
    synonyms: ["hinamatsuri", "dolls"],
    article: "none",
  },
  "🎏": {
    spokenName: "carp streamer",
    plural: "carp streamers",
    synonyms: ["koinobori", "windsock"],
  },
  "🎐": {
    spokenName: "wind chime",
    plural: "wind chimes",
    synonyms: ["furin", "bell"],
  },
  "🎑": {
    spokenName: "moon viewing ceremony",
    plural: "moon viewing ceremonies",
    synonyms: ["tsukimi", "moon"],
  },
  "🧧": {
    spokenName: "red envelope",
    plural: "red envelopes",
    synonyms: ["hongbao", "lai see", "lucky money"],
  },
  "🎀": {
    spokenName: "ribbon",
    plural: "ribbons",
    synonyms: ["bow"],
  },
  "🎁": {
    spokenName: "wrapped gift",
    plural: "wrapped gifts",
    synonyms: ["present", "gift", "birthday"],
  },
  "🎫": {
    spokenName: "ticket",
    plural: "tickets",
  },
  "🏆": {
    spokenName: "trophy",
    plural: "trophies",
    synonyms: ["cup", "award", "winner"],
  },
  "🏅": {
    spokenName: "sports medal",
    plural: "sports medals",
    synonyms: ["medal"],
  },
  "🥇": {
    spokenName: "1st place medal",
    plural: "1st place medals",
    synonyms: ["gold medal", "first place"],
  },
  "🥈": {
    spokenName: "2nd place medal",
    plural: "2nd place medals",
    synonyms: ["silver medal", "second place"],
  },
  "🥉": {
    spokenName: "3rd place medal",
    plural: "3rd place medals",
    synonyms: ["bronze medal", "third place"],
  },
  "⚽": {
    spokenName: "soccer ball",
    plural: "soccer balls",
    synonyms: ["football"],
  },
  "⚾": {
    spokenName: "baseball",
    plural: "baseballs",
  },
  "🥎": {
    spokenName: "softball",
    plural: "softballs",
  },
  "🏀": {
    spokenName: "basketball",
    plural: "basketballs",
  },
  "🏐": {
    spokenName: "volleyball",
    plural: "volleyballs",
  },
  "🏈": {
    spokenName: "american football",
    plural: "american footballs",
    synonyms: ["nfl", "gridiron"],
  },
  "🏉": {
    spokenName: "rugby football",
    plural: "rugby footballs",
    synonyms: ["rugby", "rugby ball"],
  },
  "🎾": {
    spokenName: "tennis",
    displayName: "tennis ball",
    plural: "tennis balls",
    synonyms: ["tennis", "racquet"],
  },
  "🥏": {
    spokenName: "flying disc",
    plural: "flying discs",
    synonyms: ["frisbee"],
  },
  "🎳": {
    spokenName: "bowling",
    displayName: "bowling ball",
    plural: "bowling balls",
    synonyms: ["bowling", "ten pin"],
  },
  "🏏": {
    spokenName: "cricket game",
    displayName: "cricket bat",
    plural: "cricket bats",
    synonyms: ["cricket", "bat and ball"],
  },
  "🏑": {
    spokenName: "field hockey",
    displayName: "field hockey stick",
    plural: "field hockey sticks",
    synonyms: ["hockey", "field hockey"],
  },
  "🏒": {
    spokenName: "ice hockey",
    displayName: "ice hockey stick",
    plural: "ice hockey sticks",
    synonyms: ["hockey", "ice hockey", "puck"],
  },
  "🥍": {
    spokenName: "lacrosse",
    displayName: "lacrosse stick",
    plural: "lacrosse sticks",
    synonyms: ["lacrosse"],
  },
  "🏓": {
    spokenName: "ping pong",
    displayName: "ping pong paddle",
    plural: "ping pong paddles",
    synonyms: ["table tennis", "ping pong", "bat"],
  },
  "🏸": {
    spokenName: "badminton",
    displayName: "badminton racquet",
    plural: "badminton racquets",
    synonyms: ["badminton", "shuttlecock"],
  },
  "🥊": {
    spokenName: "boxing glove",
    plural: "boxing gloves",
    synonyms: ["boxing"],
  },
  "🥋": {
    spokenName: "martial arts uniform",
    plural: "martial arts uniforms",
    synonyms: ["karate", "judo", "gi"],
  },
  "🥅": {
    spokenName: "goal net",
    plural: "goal nets",
    synonyms: ["goal"],
  },
  "⛳": {
    spokenName: "flag in hole",
    plural: "flags in holes",
    synonyms: ["golf", "putting green"],
  },
  "🎣": {
    spokenName: "fishing pole",
    plural: "fishing poles",
    synonyms: ["fishing rod", "fishing"],
  },
  "🤿": {
    spokenName: "diving mask",
    plural: "diving masks",
    synonyms: ["scuba", "snorkel", "diving"],
  },
  "🎽": {
    spokenName: "running shirt",
    plural: "running shirts",
    synonyms: ["running", "vest", "marathon"],
  },
  "🎿": {
    spokenName: "skis",
    plural: "skis",
    synonyms: ["skiing", "ski"],
    article: "none",
  },
  "🛷": {
    spokenName: "sled",
    plural: "sleds",
    synonyms: ["sledge", "toboggan"],
  },
  "🥌": {
    spokenName: "curling stone",
    plural: "curling stones",
    synonyms: ["curling"],
  },
  "🎯": {
    spokenName: "bullseye",
    plural: "bullseyes",
    synonyms: ["darts", "dartboard", "target"],
  },
  "🪀": {
    spokenName: "yo-yo",
    plural: "yo-yos",
  },
  "🪁": {
    spokenName: "kite",
    plural: "kites",
  },
  "🔫": {
    spokenName: "water pistol",
    plural: "water pistols",
    synonyms: ["water gun", "squirt gun"],
  },
  "🎱": {
    spokenName: "pool 8 ball",
    plural: "pool 8 balls",
    synonyms: ["billiards", "pool", "snooker"],
  },
  "🔮": {
    spokenName: "crystal ball",
    plural: "crystal balls",
    synonyms: ["fortune telling", "psychic", "magic"],
  },
  "🎮": {
    spokenName: "video game",
    displayName: "video game controller",
    plural: "video game controllers",
    synonyms: ["controller", "gamepad", "gaming"],
  },
  "🎰": {
    spokenName: "slot machine",
    plural: "slot machines",
    synonyms: ["gambling", "fruit machine", "casino"],
  },
  "🎲": {
    spokenName: "game die",
    plural: "game dice",
    synonyms: ["dice", "die", "board game"],
  },
  "🧩": {
    spokenName: "puzzle piece",
    plural: "puzzle pieces",
    synonyms: ["jigsaw", "puzzle"],
  },
  "🧸": {
    spokenName: "teddy bear",
    plural: "teddy bears",
    synonyms: ["teddy", "toy"],
  },
  "🃏": {
    spokenName: "joker",
    plural: "jokers",
    synonyms: ["playing card", "card"],
  },
  "🀄": {
    spokenName: "mahjong red dragon",
    plural: "mahjong red dragons",
    synonyms: ["mahjong", "tile"],
  },
  "🎴": {
    spokenName: "flower playing cards",
    plural: "flower playing cards",
    synonyms: ["hanafuda", "playing card"],
    article: "none",
  },
  "🎭": {
    spokenName: "performing arts",
    displayName: "theatre masks",
    plural: "theatre masks",
    synonyms: ["theatre", "drama", "masks", "performing arts"],
    article: "none",
  },
  "🎨": {
    spokenName: "artist palette",
    plural: "artist palettes",
    synonyms: ["art", "painting", "palette"],
  },
  "🧵": {
    spokenName: "thread",
    displayName: "spool of thread",
    plural: "spools of thread",
    synonyms: ["thread", "sewing", "cotton"],
  },
  "🧶": {
    spokenName: "yarn",
    displayName: "ball of yarn",
    plural: "balls of yarn",
    synonyms: ["yarn", "wool", "knitting"],
  },
};

/**
 * The curated layer, keyed by code point. One row per released emoji.
 *
 * Adding a category to `RELEASED_CATEGORIES` without adding its rows here is a
 * red test, not a silent gap.
 */
export const EMOJI_CURATION: CurationTable = {
  ...FOOD_AND_DRINK,
  ...ANIMALS_AND_NATURE,
  ...ACTIVITIES,
};

/**
 * The categories this module has curated, for the test that pairs them with
 * `RELEASED_CATEGORIES`. Spelled out rather than derived from the rows: a value
 * read back off the data it is meant to constrain constrains nothing.
 */
export const CURATED_CATEGORIES: readonly EmojiCategory[] = [
  "Food & Drink",
  "Animals & Nature",
  "Activities",
];
