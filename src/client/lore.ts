import { Execution } from '../shared/types';

/**
 * Castle lore: true (or truly legendary) snippets shown in the round summary, the lobby,
 * the pause menu and the rules. Keep each one short enough to read in a few seconds.
 */
export const CASTLE_FACTS: readonly string[] = [
  'Boiling oil was rarely poured from castle walls: it cost far too much. Hot water and red-hot sand were cheaper.',
  'Castle toilets were called garderobes. Clothes were hung in them, as the stench was thought to keep moths away.',
  'Many moats were dry ditches. The wet ones also caught whatever fell from the garderobes.',
  'In 1215 King John brought down a corner of Rochester Castle by burning a tunnel propped up with the fat of forty pigs.',
  "In 1204 the French captured Richard the Lionheart's Château Gaillard. Legend says they got in up a latrine chute.",
  'Castle spiral stairs usually wind clockwise going up. Legend says this hampered right-handed attackers.',
  'Arrow slits were narrow outside but splayed wide inside, so archers could aim widely and were very hard to hit.',
  "In medieval England you needed the king's permission, a 'licence to crenellate', to put battlements on your house.",
  'The gaps in battlements are crenels. The solid teeth between them are merlons.',
  "'Portcullis' comes from the Old French 'porte coleice', meaning a sliding gate.",
  "'Dungeon' comes from 'donjon', a castle's great tower. Only later did it mean the prison in its cellar.",
  'Krak des Chevaliers withstood many sieges. It fell in 1271 after its knights received a forged letter ordering them to surrender.',
  "Harlech Castle held out for seven years in the Wars of the Roses. The siege inspired the song 'Men of Harlech'.",
  'In 1266 the rebels in Kenilworth Castle held out for six months behind a great artificial lake. Hunger and disease won in the end.',
  'A big counterweight trebuchet could fling a stone as heavy as a person at a castle wall.',
  'The Tower of London kept a royal zoo. In 1252 its polar bear was allowed to fish in the Thames on a long chain.',
  'Legend says the kingdom will fall if the ravens leave the Tower of London, so at least six are kept there to this day.',
  'The White Tower in London gets its name from 1240, when Henry III had it whitewashed.',
  'Windsor Castle, begun by William the Conqueror, is the largest lived-in castle in the world.',
  "Malbork Castle in Poland, built by the Teutonic Knights, is the world's largest castle by area.",
  "Dover Castle is called the 'Key of England'. Its tunnels were used to plan the Dunkirk evacuation in 1940.",
  "Edinburgh Castle stands on an extinct volcano. Its One O'Clock Gun still fires almost every day.",
  "The Bayeux Tapestry shows William the Conqueror's men heaping up a castle mound at Hastings in 1066.",
  'Earth-and-timber motte-and-bailey castles could go up in weeks. Stone castles took years.',
  'Defenders hung wooden galleries called hoardings outside the battlements, draped in wet hides against fire arrows.',
  'Machicolations are holes in an overhanging parapet for dropping stones on attackers at the foot of the wall.',
  "'Murder holes' in gatehouse ceilings let defenders drop rocks on intruders, or pour water on fires set against the gate.",
  "Caerphilly Castle's ruined south-east tower leans further than the Leaning Tower of Pisa.",
  'Beaumaris, the last of Edward I\'s great castles in Wales, was never finished: the money ran out.',
  "Edward I's Conwy Castle and its town walls went up in just four years, from 1283 to 1287.",
  'Glass was a luxury, so most castle windows made do with wooden shutters.',
  'Castle floors were strewn with rushes and sweet-smelling herbs, swept out and replaced every so often.',
  'Many sieges ended with a deal: the garrison would surrender on an agreed day unless help arrived first.',
  'A castle often fell to hunger or thirst long before its walls gave way.',
  "Sappers dug under walls in the shelter of a wheeled roof nicknamed a 'cat' or a 'sow'.",
  "A 'postern' was a small back gate for slipping messengers in and out during a siege.",
  "Himeji Castle, the 'White Heron Castle', has a maze of paths and gates built to confuse attackers.",
  "Japanese castles had 'stone-dropping windows' for pelting anyone who tried to climb the walls.",
  'Around 980 the Danish king Harald Bluetooth built perfectly circular ring forts, such as Trelleborg.',
  'Maiden Castle in Dorset is one of the largest Iron Age hill forts in Europe, ringed by huge earth ramparts.',
  'The Aztec capital Tenochtitlan stood on an island in a lake, joined to the shore by causeways with removable bridges.',
  "The Alhambra in Granada takes its name from the Arabic for 'the red one', after the colour of its walls.",
  'Great Zimbabwe\'s stone walls, some over ten metres high, were built without any mortar.',
  'The walled city of Carcassonne has two rings of walls, three kilometres of them, and 52 towers.',
  'Bodiam Castle sits in the middle of a moat so wide it looks like a lake.',
  "Medieval 'gong farmers' dug out cesspits by night. A filthy job, but a well-paid one.",
  "Castle feasts ended with 'subtleties': sculptures of sugar and marzipan shaped like castles, ships and beasts.",
  'Neuschwanstein, the fairy-tale castle that inspired Disney, was built in the 1800s and never finished.',
];

/** A little history for each finale, shown beneath the scene. */
export const FATE_FACTS: Record<Execution, string> = {
  tomatoes: 'Tomatoes only reached Europe from the Americas in the 1500s. Medieval crowds pelted the stocks with rotten eggs, mud and worse.',
  plank: 'Real pirates rarely made anyone walk the plank. Most accounts date from the 1800s, long after the golden age of piracy.',
  behead: 'In medieval England beheading was usually kept for nobles, as a quicker and more honourable end than the rope.',
  trebuchet: "At Stirling in 1304, Edward I refused the garrison's surrender until he had tried out his giant trebuchet, 'Warwolf'.",
  dragon: 'Medieval bestiaries claimed that dragons hunted elephants, coiling around their legs to bring them down.',
  dunk: "The ducking stool was mostly used on 'scolds', brawlers and cheating brewers and bakers, not just suspected witches.",
  jester: "A jester's licence let them mock the king to his face. Henry VIII's fool, Will Somers, was said to be one of the few who could cheer him up.",
};

let deck: number[] = [];

/** The next castle fact: every one is shown once before any repeats. */
export function nextFact(): string {
  if (!deck.length) {
    deck = CASTLE_FACTS.map((_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return CASTLE_FACTS[deck.pop()!];
}

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** Subtitles for the build phase banner, after the first one. */
const BUILD_CALLS = [
  'Close your walls!',
  'Mind the gaps, my liege!',
  'Mortar, lads, and be quick about it!',
  'The masons await your orders',
  'Patch it up before the ravens notice',
  'Stone by stone, the realm endures',
];

/** Subtitles for the lull before a battle's firing starts. */
const READY_CALLS = ['Ready your cannons…', 'Keep your powder dry…', 'Light the fuses…', 'Gunners, to your stations!', 'Aim true, for the realm!'];

export const buildCall = (round: number) => (round <= 2 ? BUILD_CALLS[0] : pick(BUILD_CALLS));
export const readyCall = (round: number) => (round <= 1 ? READY_CALLS[0] : pick(READY_CALLS));
