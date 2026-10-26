import type { FinalMinutesContent } from '../meetings/final-minutes';

/**
 * The client copy of approved final minutes. Next steps are written "action — owner, by date" (the
 * notes-based draft builds them from the action item's fields and the AI is asked for the same form),
 * so the owner is taken off structurally: a known person's name (or "unassigned") right after the last
 * dash, up to the comma before "by …" or the end. Nothing else is removed by guessing — the rest of the
 * text is shown as written, and the staff member who shows it sees every name highlighted first.
 * "Risks & open issues" stay internal unless they were ticked when the minutes were shown.
 */

export type PersonName = { firstName?: string | null; lastName?: string | null } | { name: string };

/** Each person's full name and first name, once each, longest first (so "Sara Ahmed" wins over "Sara"). */
export function nameVariants(people: PersonName[]): string[] {
  const out: string[] = [];
  const add = (n: string | null | undefined) => {
    const v = (n ?? '').trim().replace(/\s+/g, ' ');
    if (v.length >= 2 && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  for (const p of people) {
    const full = 'name' in p ? p.name : [p.firstName, p.lastName].filter(Boolean).join(' ');
    add(full);
    add('name' in p ? p.name.trim().split(/\s+/)[0] : p.firstName);
  }
  return out.map((n, i) => ({ n, i })).sort((a, b) => b.n.length - a.n.length || a.i - b.i).map((x) => x.n);
}

const DASH = /\s[—–-]\s/g;
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** "Send the form — Bilal, by 18 Oct" → "Send the form — by 18 Oct"; "Book the rig — Sara" → "Book the rig". */
export function stripOwner(step: string, names: string[]): string {
  const candidates = [...names, 'unassigned'];
  const dashes = [...step.matchAll(DASH)].map((m) => ({ at: m.index!, len: m[0].length, dash: m[0].trim() }));
  for (const d of dashes.reverse()) {
    const before = step.slice(0, d.at).trimEnd();
    const after = step.slice(d.at + d.len);
    const lower = after.toLowerCase();
    for (const name of candidates) {
      if (!lower.startsWith(name.toLowerCase()) || isWordChar(after[name.length])) continue;
      const rest = after.slice(name.length).trim();
      if (rest === '') return before;
      const tail = /^[,،]\s*(.+)$/u.exec(rest);
      if (tail) return `${before} ${d.dash} ${tail[1]}`;
    }
  }
  return step;
}

export function clientMinutesContent(content: FinalMinutesContent, opts: { names: string[]; includeRisks: boolean }): FinalMinutesContent {
  return {
    summary: content.summary,
    discussion: content.discussion.map((d) => ({ topic: d.topic, text: d.text })),
    decisions: [...content.decisions],
    risks: opts.includeRisks ? [...content.risks] : [],
    nextSteps: content.nextSteps.map((s) => stripOwner(s, opts.names)),
  };
}
