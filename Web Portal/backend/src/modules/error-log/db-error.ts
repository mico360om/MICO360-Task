import { redactText } from './error-redact';

/**
 * What a database error says about its cause, for the Error log (1.22.5). A Prisma error's first line
 * ("Invalid `prisma.$queryRaw()` invocation:") names no cause: the cause is on its later lines and in
 * `code` / `meta`, which the Error log otherwise drops because they can quote what someone typed. This
 * keeps Prisma's code (P2010), the database's code (1064, 1038…) and the database's message with every
 * value masked — quoted values become '?', long numbers ?, while the names of tables, columns, keys and
 * clauses and MySQL's own words stay — in at most 300 characters.
 */
export interface DatabaseDiagnosis {
  /** Prisma's error code (P2010, P2024…), or null. */
  code: string | null;
  /** The database's own error code (1064, 1038…), or null. */
  dbCode: string | null;
  /** What the Error log shows after "Database said:" — the codes first, so a cut never takes them. */
  text: string;
}

/** At most this many characters are kept. */
export const DIAGNOSIS_MAX = 300;
/** At most this much of a message is ever read (a validation error prints the whole query). */
const READ_MAX = 20_000;

const PRISMA_ERRORS = new Set(['PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError', 'PrismaClientValidationError', 'PrismaClientInitializationError', 'PrismaClientRustPanicError']);

/** Words after which a quoted name is a name (a column, a key, a clause…), not a value. */
const NAME_WORDS = new Set([
  'column', 'columns', 'field', 'fields', 'key', 'table', 'tables', 'database', 'schema', 'index', 'constraint',
  'function', 'procedure', 'operation', 'argument', 'model', 'relation', 'view', 'trigger', 'mean', 'variable', 'engine',
]);
const NAME = /^[A-Za-z_][A-Za-z0-9_$.-]{0,127}$/;
/** MySQL's names for the parts of a statement ("in 'where clause'", "in 'field list'"). */
const CLAUSE = /^[a-z]{2,10} (?:clause|list|statement)$/i;
const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

/** May this quoted text stay? A name after a word that says it is one; everything else is a value. */
function isName(content: string, before: string, quote: string): boolean {
  const word = /([A-Za-z_]+)[\s:]*$/.exec(before.slice(-40))?.[1]?.toLowerCase() ?? '';
  if (word === 'in' && quote === "'") return CLAUSE.test(content);
  return NAME.test(content) && NAME_WORDS.has(word);
}

/**
 * Quoted parts of a text: names kept (`names`), all others '?'. A quote opens where a word doesn't
 * go on (not the apostrophe of "doesn't") and closes at the same quote with no word after it; one that
 * never closes masks the rest. Each character is looked at at most twice, so hostile text stays fast.
 */
function maskQuoted(s: string, names: boolean): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const quote = ch === "'" || ch === '"' || ch === '`';
    if (!quote || (names && isWordChar(s[i - 1]) && isWordChar(s[i + 1]))) {
      out += ch;
      i += 1;
      continue;
    }
    let end = -1;
    for (let j = i + 1; j < s.length; j++) {
      if (s[j] === ch && !isWordChar(s[j + 1])) {
        end = j;
        break;
      }
    }
    if (end < 0) return `${out}${ch}?`;
    const content = s.slice(i + 1, end);
    // In a statement's own text a `backticked` part is always a name.
    const keep = names ? isName(content, out, ch) : ch === '`' && NAME.test(content);
    out += keep ? s.slice(i, end + 1) : `${ch}?${ch}`;
    i = end + 1;
  }
  return out;
}

const longNumbers = (s: string) => s.replace(/\d{6,}/g, '?');

/**
 * A database's message with its values masked: quoted values '?', long numbers ?, emails and tokens
 * as the Error log masks them everywhere; the statement's own words near a syntax error ("near '…' at
 * line 1") stay with their literals masked. One line, at most 300 characters.
 */
export function maskDatabaseText(text: string): string {
  const s = String(text ?? '').slice(0, 4000).replace(/\s+/g, ' ').trim();
  let masked: string;
  const near = s.indexOf("near '");
  const end = near >= 0 ? s.lastIndexOf("' at line ") : -1;
  if (near >= 0 && end > near + 5) {
    const tail = "' at line ";
    masked = `${maskQuoted(s.slice(0, near), true)}near '${maskQuoted(s.slice(near + 6, end), false)}${tail}${maskQuoted(s.slice(end + tail.length), true)}`;
  } else {
    masked = maskQuoted(s, true);
  }
  return redactText(longNumbers(masked), DIAGNOSIS_MAX);
}

/** The lines after Prisma's "Invalid `…` invocation:" line (and the file it names, in the pretty form). */
function bodyOf(message: string): string[] {
  const lines = message.slice(0, READ_MAX).split('\n');
  const at = lines.findIndex((l) => /^Invalid `[^`]{1,200}` invocation(?::| in)$/.test(l.trim()));
  if (at < 0) return lines;
  return lines.slice(at + (lines[at]!.trim().endsWith(' in') ? 2 : 1));
}

/** Prisma's words for the cause: the first paragraph that isn't the query it printed or a code frame. */
function causeOf(message: string): string | null {
  const paragraphs: string[][] = [[]];
  for (const line of bodyOf(message)) {
    if (line.trim()) paragraphs[paragraphs.length - 1]!.push(line);
    else if (paragraphs[paragraphs.length - 1]!.length) paragraphs.push([]);
  }
  for (const p of paragraphs) {
    if (!p.length) continue;
    const first = p[0]!.trim();
    // The arguments it printed (they hold what was typed), the options it listed, a code frame.
    if (first.startsWith('{') || first.startsWith('[') || p.some((l) => l.includes('~~~') || /^\?\s/.test(l) || /^\s*→/.test(l) || /^\s+\d+\s*(?:\||\s|$)/.test(l))) continue;
    return p.map((l) => l.trim()).join(' ');
  }
  return null;
}

/** "Raw query failed. Code: `1064`. Message: `…`" → its code and message. */
function rawFailure(cause: string): { dbCode: string; message: string } | null {
  const m = /^Raw query failed\. Code: `([^`]{0,40})`\. Message: `/.exec(cause);
  if (!m) return null;
  const rest = cause.slice(m[0].length);
  return { dbCode: m[1]!, message: rest.endsWith('`') ? rest.slice(0, -1) : rest };
}

/** The connector's words for a server error: MysqlError { code: 1038, message: "…", … }. */
function connectorFailure(text: string): { dbCode: string; message: string } | null {
  const m = /MysqlError \{ code: (\d{1,6}), message: "/.exec(text.slice(0, READ_MAX));
  if (!m) return null;
  const from = m.index + m[0].length;
  let message = '';
  for (let i = from; i < text.length && i < from + 2000; i++) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) {
      message += text[i + 1];
      i += 1;
    } else if (c === '"') {
      break;
    } else {
      message += c;
    }
  }
  return { dbCode: m[1]!, message };
}

const prismaCode = (v: unknown): string | null => (typeof v === 'string' && /^P\d{4}$/.test(v) ? v : null);
const dbCodeOf = (v: unknown): string | null => {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  return /^[A-Za-z0-9]{1,10}$/.test(s) ? s : null;
};

/**
 * A Prisma error's diagnosis (null for any other error, which the Error log keeps as before). Known
 * request errors: the code, `meta.code` and `meta.message` (else the "Message: `…`" part of the text);
 * an unknown request error: the database's code and message from the connector's words; a validation
 * error: the line saying what was wrong, never the arguments it printed. Never throws.
 */
export function databaseDiagnosis(err: unknown): DatabaseDiagnosis | null {
  try {
    if (!err || typeof err !== 'object') return null;
    const e = err as { name?: unknown; code?: unknown; errorCode?: unknown; meta?: unknown; message?: unknown };
    if (typeof e.name !== 'string' || !PRISMA_ERRORS.has(e.name)) return null;
    const code = prismaCode(e.code) ?? prismaCode(e.errorCode);
    const message = typeof e.message === 'string' ? e.message : '';
    const cause = causeOf(message);
    let meta: { code?: unknown; message?: unknown } = {};
    try {
      if (e.meta && typeof e.meta === 'object') meta = e.meta as typeof meta;
    } catch {
      meta = {};
    }
    const raw = cause ? rawFailure(cause) : null;
    const connector = raw ? null : connectorFailure(message);
    const dbCode = dbCodeOf(meta.code) ?? dbCodeOf(raw?.dbCode) ?? dbCodeOf(connector?.dbCode);
    const dbMessage = typeof meta.message === 'string' && meta.message.trim() ? meta.message : (raw?.message ?? connector?.message ?? null);
    const said = dbMessage ?? cause;
    const parts = [code, dbCode ? `code ${dbCode}` : null, said ? maskDatabaseText(said) : null].filter((p): p is string => !!p);
    return { code, dbCode, text: parts.join(' · ').slice(0, DIAGNOSIS_MAX) };
  } catch {
    return null;
  }
}
