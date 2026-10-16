import type { AiCapability, ProviderKind } from './ai-config';

/**
 * What the app knows about model names, so a provider's raw model list can be shown and chosen
 * from sensibly: which models can be used at all, what each can do, a readable name, and which
 * one to recommend. Model names follow loose conventions, so these are best guesses from the
 * name; an admin can still change a model's capabilities, and a provider's own metadata wins.
 */

/** A model as a provider lists it. */
export interface RemoteModel {
  key: string;
  displayName?: string;
  capabilities?: AiCapability[];
  /** When the provider released it (seconds since 1970), if it says. Newer wins ties. */
  created?: number;
}

/** Image, speech, video, moderation and other non-text models: the app can't use them. */
const NOT_TEXT =
  /(dall-e|gpt-image|imagen|-image|image-gen|whisper|tts|audio|realtime|transcribe|moderation|sora|veo-|lyria|speech|davinci|babbage|computer-use|guard|(^|\/)aqa$)/i;
/** OpenAI models its chat-completions endpoint can't run (Responses-API-only or completions-only). */
const OPENAI_NOT_CHAT = /(-instruct|-pro($|-)|codex|deep-research)/i;

export function isUsableModelKey(kind: ProviderKind, key: string): boolean {
  if (NOT_TEXT.test(key)) return false;
  if (kind === 'openai' && OPENAI_NOT_CHAT.test(key)) return false;
  return true;
}

const EMBEDDING = /embed/i;
/** Models that read images as well as text (so they can also do OCR and document processing). */
const VISION =
  /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt-4o|(^|\/)o1$|(^|\/)o[134](-(?!mini)|$)|o4-mini|claude-(3|sonnet|opus|haiku)|gemini|llava|vision|-vl\b|vl[:-]|\dvl|minicpm-v|gemma-?3|llama-?4|pixtral|moondream)/i;

export function inferCapabilities(key: string): AiCapability[] {
  if (EMBEDDING.test(key)) return ['embedding'];
  return VISION.test(key) ? ['chat', 'vision', 'ocr', 'document'] : ['chat'];
}

/** OpenAI's reasoning families: they take no temperature and spend part of the token budget thinking. */
export function isReasoningModel(key: string): boolean {
  const k = key.toLowerCase().replace(/^.*\//, '');
  if (/^o\d(-|$)/.test(k)) return true;
  return /^gpt-5/.test(k) && !/chat/.test(k);
}

const BRANDS: Record<string, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  gemma: 'Gemma',
  llama: 'Llama',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  phi: 'Phi',
  text: 'Text',
};

/** A readable name for a model id, for providers that don't send one ("gpt-4o-mini" → "GPT-4o mini"). */
export function friendlyModelName(key: string): string {
  let id = key.replace(/^models\//, '');
  let suffix = '';
  const colon = id.indexOf(':');
  if (colon > 0) {
    const tag = id.slice(colon + 1);
    id = id.slice(0, colon);
    if (tag && tag !== 'latest') suffix = ` ${tag.toUpperCase()}`;
  }
  const dated = /-(\d{4}-\d{2}-\d{2}|\d{8})$/.exec(id);
  if (dated) {
    id = id.slice(0, dated.index);
    suffix = ` (${dated[1]})${suffix}`;
  }
  const parts = id.split(/[-_]/).filter(Boolean);
  // Consecutive small numbers are a version: "3-5" → "3.5".
  const words: string[] = [];
  for (const p of parts) {
    const prev = words[words.length - 1];
    if (/^\d{1,2}$/.test(p) && prev !== undefined && /^\d{1,2}(\.\d{1,2})*$/.test(prev)) words[words.length - 1] = `${prev}.${p}`;
    else words.push(p);
  }
  const first = words[0]?.toLowerCase() ?? '';
  let head: string;
  let rest: string[];
  if ((first === 'gpt' || first === 'chatgpt') && words.length > 1) {
    head = `${first === 'gpt' ? 'GPT' : 'ChatGPT'}-${words[1]}`;
    rest = words.slice(2);
  } else if (/^o\d$/.test(first)) {
    return `${words.join('-')}${suffix}`; // OpenAI writes these as-is: "o3-mini"
  } else {
    const brand = Object.keys(BRANDS).find((b) => first.startsWith(b));
    head = brand ? BRANDS[brand]! + words[0]!.slice(brand.length) : words[0] ? words[0][0]!.toUpperCase() + words[0].slice(1) : id;
    rest = words.slice(1);
  }
  return [head, ...rest].join(' ') + suffix;
}

/** What `pickRecommended` needs to know about a model. */
export interface RankedModel {
  id: string;
  modelKey: string;
  capabilities: AiCapability[];
  created?: number;
}

/**
 * Chat model families in order of preference for the app's AI features: short, structured answers
 * where speed matters more than depth. A fast general model first, then the larger ones, then
 * open models; anything else after that.
 */
const CHAT_PREFERENCE: RegExp[] = [
  /haiku/i,
  /gpt-[\d.]+o?-mini/i,
  /gemini[^/]*flash(?!.*lite)/i,
  /sonnet/i,
  /(^|\/)(gpt-[\d.]+o?|chatgpt-4o-latest)$/i,
  /gemini[^/]*pro/i,
  /mistral-(small|medium|large)/i,
  /deepseek-(chat|v)/i,
  /llama|qwen|gemma|mixtral|mistral|phi/i,
];
const EMBEDDING_PREFERENCE: RegExp[] = [/text-embedding-3-small/i, /text-embedding-3-large/i, /embed/i];

const PREVIEW = /(preview|-exp($|-)|experimental|beta|alpha)/i;
const DATED = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

function versionOf(key: string): number[] {
  return (key.match(/\d+(\.\d+)?/g) ?? []).map(Number);
}
function compareVersionsDesc(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (b[i] ?? -1) - (a[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/** The id of the best model for a capability, or null when none has it. */
export function pickRecommended(models: RankedModel[], capability: AiCapability): string | null {
  const candidates = models.filter((m) => m.capabilities.includes(capability));
  if (candidates.length === 0) return null;
  const order = capability === 'embedding' ? EMBEDDING_PREFERENCE : CHAT_PREFERENCE;
  const rank = (m: RankedModel) => {
    const i = order.findIndex((re) => re.test(m.modelKey));
    return i < 0 ? order.length : i;
  };
  const sorted = [...candidates].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(PREVIEW.test(a.modelKey)) - Number(PREVIEW.test(b.modelKey)) ||
      Number(DATED.test(a.modelKey)) - Number(DATED.test(b.modelKey)) ||
      Number(isReasoningModel(a.modelKey)) - Number(isReasoningModel(b.modelKey)) ||
      (a.created !== undefined && b.created !== undefined ? b.created - a.created : 0) ||
      compareVersionsDesc(versionOf(a.modelKey), versionOf(b.modelKey)) ||
      a.modelKey.localeCompare(b.modelKey),
  );
  return sorted[0]!.id;
}
