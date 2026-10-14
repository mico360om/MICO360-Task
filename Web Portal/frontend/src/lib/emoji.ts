/**
 * The emoji the chat offers (for messages and reactions), each with the words it can be found by.
 * A short, work-friendly set — the system keyboard has the rest.
 */
export interface EmojiEntry {
  char: string;
  /** Name and related words, lower case. */
  words: string;
  group: 'Smileys' | 'Gestures' | 'Hearts' | 'Work' | 'Nature' | 'Food' | 'Symbols';
}

const G = (group: EmojiEntry['group'], list: Array<[string, string]>): EmojiEntry[] => list.map(([char, words]) => ({ char, words, group }));

export const EMOJI: EmojiEntry[] = [
  ...G('Smileys', [
    ['😀', 'grinning smile happy'], ['😃', 'smiley happy joy'], ['😄', 'smile laugh happy'], ['😁', 'grin beaming'],
    ['😆', 'laughing squint'], ['😅', 'sweat smile relief'], ['😂', 'joy tears laugh lol funny'], ['🤣', 'rofl rolling laugh'],
    ['🙂', 'slight smile'], ['😉', 'wink'], ['😊', 'blush smile happy'], ['😇', 'innocent halo angel'],
    ['😍', 'heart eyes love'], ['🤩', 'star struck wow excited'], ['😘', 'kiss blow'], ['😋', 'yum tasty'],
    ['😎', 'cool sunglasses'], ['🤓', 'nerd geek'], ['🤔', 'thinking hmm'], ['🤨', 'raised eyebrow doubt'],
    ['😐', 'neutral meh'], ['😑', 'expressionless'], ['🙄', 'eye roll'], ['😏', 'smirk'],
    ['😌', 'relieved calm'], ['😴', 'sleeping tired zzz'], ['🥱', 'yawn tired bored'], ['😪', 'sleepy'],
    ['😷', 'mask sick'], ['🤒', 'sick fever thermometer'], ['🤯', 'mind blown shocked'], ['🥳', 'party celebrate birthday'],
    ['😮', 'wow surprised open mouth'], ['😲', 'astonished shocked'], ['😳', 'flushed embarrassed'], ['🥺', 'pleading please puppy'],
    ['😢', 'cry sad tear'], ['😭', 'sob crying sad'], ['😤', 'triumph huff frustrated'], ['😠', 'angry mad'],
    ['😡', 'rage angry furious'], ['🤗', 'hug hugging'], ['🤭', 'oops giggle hand over mouth'], ['🤫', 'shush quiet secret'],
    ['😬', 'grimace awkward'], ['🫡', 'salute respect yes sir'], ['🙃', 'upside down silly'], ['😶', 'speechless no mouth'],
  ]),
  ...G('Gestures', [
    ['👍', 'thumbs up like yes approve +1'], ['👎', 'thumbs down dislike no -1'], ['👌', 'ok okay perfect'], ['✌️', 'victory peace'],
    ['🤞', 'fingers crossed luck hope'], ['🤝', 'handshake deal agree'], ['👏', 'clap applause bravo'], ['🙌', 'raised hands celebrate hooray'],
    ['👋', 'wave hello hi bye'], ['🙏', 'pray thanks please folded hands'], ['💪', 'strong muscle flex'], ['👀', 'eyes looking watching'],
    ['🤷', 'shrug dunno whatever'], ['🤦', 'facepalm'], ['☝️', 'point up one'], ['👉', 'point right'],
    ['👈', 'point left'], ['👇', 'point down'], ['✋', 'raised hand stop high five'], ['🫶', 'heart hands love support'],
  ]),
  ...G('Hearts', [
    ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'],
    ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'],
    ['💔', 'broken heart sad'], ['💯', 'hundred perfect score'], ['✨', 'sparkles shiny new'], ['🔥', 'fire hot lit'],
  ]),
  ...G('Work', [
    ['✅', 'check done complete yes tick'], ['☑️', 'check box ballot'], ['✔️', 'check mark tick'], ['❌', 'cross no wrong cancel'],
    ['⚠️', 'warning caution alert'], ['❗', 'exclamation important'], ['❓', 'question'], ['💡', 'idea light bulb'],
    ['📌', 'pin pushpin important'], ['📎', 'paperclip attachment'], ['📝', 'memo note write'], ['📅', 'calendar date'],
    ['📆', 'calendar tear off schedule'], ['⏰', 'alarm clock time deadline'], ['⏳', 'hourglass waiting time'], ['🗓️', 'spiral calendar plan'],
    ['📊', 'bar chart stats report'], ['📈', 'chart up growth increase'], ['📉', 'chart down decrease'], ['💼', 'briefcase work business'],
    ['📁', 'folder files'], ['📄', 'document page file'], ['📧', 'email mail'], ['📞', 'phone call telephone'],
    ['💻', 'laptop computer'], ['🖥️', 'desktop computer'], ['⌨️', 'keyboard typing'], ['🔧', 'wrench fix tool'],
    ['🛠️', 'tools build fix'], ['⚙️', 'gear settings'], ['🔒', 'lock secure locked'], ['🔑', 'key access'],
    ['🚀', 'rocket launch ship fast'], ['🎯', 'target goal bullseye'], ['🏆', 'trophy win award'], ['🥇', 'gold medal first'],
    ['🎉', 'party popper tada celebrate congratulations'], ['🎊', 'confetti celebrate'], ['🎁', 'gift present'], ['🔔', 'bell notification'],
    ['📣', 'megaphone announce'], ['🧠', 'brain think smart'], ['🐛', 'bug issue defect'], ['🚧', 'construction work in progress wip'],
  ]),
  ...G('Nature', [
    ['☀️', 'sun sunny'], ['🌙', 'moon night'], ['⭐', 'star favorite'], ['🌟', 'glowing star'],
    ['🌈', 'rainbow'], ['☁️', 'cloud'], ['🌧️', 'rain'], ['⚡', 'lightning zap fast'],
    ['❄️', 'snow cold'], ['🌴', 'palm tree holiday'], ['🌹', 'rose flower'], ['🌱', 'seedling grow new'],
  ]),
  ...G('Food', [
    ['☕', 'coffee tea hot break'], ['🍵', 'tea'], ['🍕', 'pizza'], ['🍔', 'burger'],
    ['🍰', 'cake'], ['🎂', 'birthday cake'], ['🍩', 'donut'], ['🍪', 'cookie'],
    ['🍎', 'apple'], ['🍉', 'watermelon'], ['🥤', 'drink'], ['🍽️', 'plate lunch dinner meal'],
  ]),
  ...G('Symbols', [
    ['➕', 'plus add'], ['➖', 'minus'], ['➡️', 'right arrow next'], ['⬅️', 'left arrow back'],
    ['⬆️', 'up arrow'], ['⬇️', 'down arrow'], ['🔁', 'repeat recurring loop'], ['🔄', 'refresh update sync'],
    ['🆗', 'ok button'], ['🆕', 'new'], ['🔴', 'red circle'], ['🟢', 'green circle'],
    ['🟡', 'yellow circle'], ['🔵', 'blue circle'], ['⏸️', 'pause'], ['▶️', 'play start'],
  ]),
];

/** The reactions offered first, before the full picker. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '✅', '😮', '🙏'];

export const EMOJI_GROUPS: EmojiEntry['group'][] = ['Smileys', 'Gestures', 'Hearts', 'Work', 'Nature', 'Food', 'Symbols'];

/** Emoji whose name or related words contain every word of the search. */
export function searchEmoji(query: string): EmojiEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return EMOJI;
  return EMOJI.filter((e) => terms.every((t) => e.words.includes(t)));
}
