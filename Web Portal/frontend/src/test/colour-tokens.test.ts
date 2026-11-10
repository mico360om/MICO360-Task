import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { allTokens } from '../lib/colour-scheme';

/**
 * 1.23.8 One colour scheme: every status, priority, overdue, due-soon and health colour comes from
 * lib/colour-classes.ts (lib/colour-scheme.ts underneath). This fails when a component writes one itself:
 * a scheme colour as hex, its CSS variable, a Tailwind palette colour (`bg-red-500`), or the general
 * danger / warning / success tones on something that is a status, a priority, overdue, due soon or health.
 */
const SRC = resolve(__dirname, '..');
/** The scheme itself, and the status metadata (loaded on its own by the Android drift tests: it can't import). */
const SCHEME_FILES = new Set(['lib/colour-scheme.ts', 'lib/colour-classes.ts', 'lib/taskStatus.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const SOURCES = files(SRC).map((p) => ({ path: relative(SRC, p).replace(/\\/g, '/'), lines: readFileSync(p, 'utf8').split(/\r?\n/) }));

/** Comment lines say what a colour means; only code counts. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** Files that hold a project's own picture colours (its identity), not statuses: they may name any colour. */
const PROJECT_IDENTITY = new Set(['lib/project-icons.tsx', 'components/project-form/IdentityEditor.tsx', 'components/project-form/ProjectFormDialog.tsx', 'components/ProjectAvatar.tsx', 'components/projects/ProjectCard.tsx']);

/** The scheme's own colours, and the ones the old categories used (#948985 Backlog … #7A5AA8 Review). */
const SCHEME_HEX = new Set([
  ...allTokens().flatMap(([, t]) => [t.light.fill, t.light.text, t.light.soft, t.dark.fill, t.dark.text, t.dark.soft]),
  '#948985', '#9A918D', '#B87611', '#CB4632', '#3A6EA5', '#2E7D53', '#7A5AA8', '#A89D98', '#ACA39E', '#D6983C', '#E26452', '#689CD2', '#46AC76',
].map((h) => h.toUpperCase()));

const PALETTE = /\b(bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|accent|shadow|divide)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
const SCHEME_VAR = /--c-(status|prio|overdue|soon|health|cat)-?/;
/** A general tone (danger / warning / success) on the same line as a status, a priority, overdue, due soon or health. */
const GENERAL_TONE = /\b(?:bg|text|border|ring|fill)-(?:danger|warning|success)\b|\btone=["'{](?:danger|warning|success)\b|['"](?:danger|warning|success)['"]/;
const MEANING =
  /\b(overdue|Overdue|isOverdue|dueSoon|isDueSoon|dueToday|priority|Priority|PRIORITY|RAG|rag|Rag|health|Health|on-track|at-risk|BLOCKED|IN_PROGRESS|REVIEW|blocked)\b|\b(URGENT|HIGH|NORMAL|LOW|RED|AMBER|GREEN|late)\s*:|'(RED|AMBER|GREEN|late|URGENT|HIGH)'|\.late\b|>Late<|'(Not started|In progress|In review|On hold|Done)'\s*:|\b(Done|Blocked)\s*:/;

/**
 * Lines checked by hand that use a general tone for something else that happens to share the line (an
 * error message about saving a priority, a project's "late" stat in the Management PDF words…). Each says why.
 */
const ALLOWED: Array<[file: string, includes: string, why: string]> = [
  ['components/StatTile.tsx', "type Tone = 'brand' | 'success' | 'warning' | 'info' | 'danger' | 'overdue'", 'the list of tile tones: the general ones beside the scheme’s'],
  ['components/admin/error-log-words.ts', "BLOCKED: { label: 'Blocked', tone: 'warning' }", 'the Error log’s “blocked file” kind, not a task status'],
  ['components/chat/MessageItem.tsx', "const seen = onBubble ? 'text-sky-200' : 'text-info';", 'a chat message’s read tick on the brand bubble, not a status'],
  ['components/templates/TemplateStart.tsx', 'rounded-xl bg-warning-soft px-3 py-2 text-xs font-medium text-warning', 'a caution before creating a project (tasks would start overdue), not a task’s state'],
  ['pages/DashboardPage.tsx', '<span className="text-success">{Icon.checkCircle}</span>Nothing due', 'the all-clear tick, not a status'],
  ['components/project-dashboard/parts.tsx', "const BAR_TONE = { brand: 'bg-brand', success: 'bg-success', danger: 'bg-danger'", 'the list of bar tones: the general ones beside the scheme’s'],
  ['pages/ManagementPage.tsx', "tone?: 'brand' | 'success' | 'warning' | 'info' | 'danger' | 'overdue' | 'late'", 'the list of tile tones: the general ones beside the scheme’s'],
  ['components/management/parts.tsx', "type Tone = 'danger' | 'warning' | 'neutral' | 'overdue';", 'the list of number tones: the general ones beside the scheme’s'],
  ['components/management/parts.tsx', "const NUMBER_TONE: Record<Tone, string> = { danger: 'text-danger', warning: 'text-warning', neutral: 'text-ink', overdue: OVERDUE_CLASS.text };", 'the number tones: the general ones beside the scheme’s'],
  ['components/portal/portal-ui.tsx', "export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'danger' | 'success' | 'warning' | 'info' | 'brand' | 'overdue' | 'done'", 'the list of chip tones: the general ones beside the scheme’s'],
  ['pages/ManagementPage.tsx', "{tile({ label: 'Missing checks', value: t.missingChecks, hint: 'Inspections not done on time', tone: 'warning'", 'missing inspections (a warning), on the line after the late tasks'],
];

describe('colours come from the scheme (1.23.8)', () => {
  it('no hard-coded status, priority, overdue, due-soon or health colours', () => {
    const problems: string[] = [];
    for (const { path, lines } of SOURCES) {
      if (SCHEME_FILES.has(path)) continue;
      lines.forEach((line, i) => {
        if (isComment(line)) return;
        const where = `${path}:${i + 1}`;
        const allowed = ALLOWED.some(([f, inc]) => path === f && line.includes(inc));
        if (allowed) return;
        if (PALETTE.test(line)) problems.push(`${where} Tailwind palette colour: ${line.trim().slice(0, 140)}`);
        if (SCHEME_VAR.test(line)) problems.push(`${where} a scheme variable written out (use lib/colour-classes): ${line.trim().slice(0, 140)}`);
        if (!PROJECT_IDENTITY.has(path)) {
          for (const hex of line.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) {
            if (SCHEME_HEX.has(hex.toUpperCase())) problems.push(`${where} a scheme colour as hex ${hex}: ${line.trim().slice(0, 140)}`);
          }
        }
        // The meaning may sit on the line before (`{task.blocked ? (` and then the chip's classes).
        if (GENERAL_TONE.test(line) && (MEANING.test(line) || (i > 0 && MEANING.test(lines[i - 1]!)))) problems.push(`${where} a general tone for a status/priority/overdue/health: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('every allowance is still needed (remove it when its line changes)', () => {
    for (const [file, inc, why] of ALLOWED) {
      const src = SOURCES.find((s) => s.path === file);
      expect(src, `${file} (${why})`).toBeDefined();
      expect(src!.lines.some((l) => l.includes(inc)), `${file}: “${inc}” (${why})`).toBe(true);
    }
  });

  it('catches the mistakes it is for', () => {
    const flagged = (line: string) => PALETTE.test(line) || SCHEME_VAR.test(line) || (GENERAL_TONE.test(line) && MEANING.test(line));
    expect(flagged(`<span className="bg-red-500">`)).toBe(true);
    expect(flagged(`color: 'rgb(var(--c-cat-done))'`)).toBe(true);
    expect(flagged(`{overdue ? 'text-danger font-semibold' : 'text-ink-2'}`)).toBe(true);
    expect(flagged(`URGENT: 'bg-danger-soft text-danger',`)).toBe(true);
    expect(flagged(`<Badge tone="danger">Delete failed</Badge>`)).toBe(false);
  });
});
