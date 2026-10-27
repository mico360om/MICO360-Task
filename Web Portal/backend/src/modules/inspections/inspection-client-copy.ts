import { zonedDayKey } from '../../lib/due-date';
import { formatDateTime } from '../../lib/export-format';
import { allowedSignatures, effectiveResult, limitsText, readingText, RESULT_LABEL, resultLabel, SIGNATURE_LABEL, summarize } from './inspection-rules';
import type { AnswerRecord, InspectionRecord, SignatureRecord } from './inspection-store';
import { byRole, dataUrl } from './inspection-views';

/**
 * The client's copy of a finished inspection, built from an explicit allow-list: each field below
 * is copied on its own, so nothing else the records carry — who started or answered it, who made
 * the form, the form's own notes and item hints, the attached task, the follow-up tasks, ids of
 * anything but the inspection — can reach the client. The signatures are in it with the names the
 * signers typed: that is what signing is for (the owner's decision), and the preview shows them
 * before anyone ticks "Show to client".
 */
export interface ClientInspectionItem {
  label: string;
  kind: 'CHECK' | 'READING';
  /** 'Pass' | 'Fail' | 'N/A' (null: unanswered — a finished one has none). */
  result: string | null;
  /** The reading with its unit ("162.5 psi"). */
  reading: string | null;
  /** "0–150 psi". */
  limits: string | null;
  note: string | null;
}

export interface ClientInspectionSignature {
  /** 'Inspector' | 'Client' | 'Supervisor'. */
  role: string;
  name: string;
  signedAt: string;
  /** When, in words, in the company's time zone ("27 Oct 2026, 08:19"), as the PDF says it. */
  signedOn: string;
  /** A PNG data URL; null for a typed signature. */
  image: string | null;
  typed: boolean;
}

export interface ClientInspection {
  /** What its PDF is asked for by. */
  id: string;
  title: string;
  /** The day it was finished ('YYYY-MM-DD', company time zone). */
  date: string;
  place: string | null;
  counts: { total: number; passed: number; failed: number; na: number };
  result: string;
  sections: Array<{ title: string; items: ClientInspectionItem[] }>;
  signatures: ClientInspectionSignature[];
  /** Signatures the form asks for that weren't given ('Client', 'Supervisor'): "Not signed". */
  unsigned: string[];
  /** Which signing this is, counted from 1 (a reopen and a new signing make it 2). */
  revisionNumber: number;
  /** The day it was last reopened ('YYYY-MM-DD', company time zone); null if never. No names. */
  reopenedOn: string | null;
}

export function clientInspection(r: InspectionRecord, answers: AnswerRecord[], signatures: SignatureRecord[], timeZone: string): ClientInspection {
  const byItem = new Map(answers.map((a) => [a.itemId, a]));
  const s = summarize(r.structure, answers);
  const counts = { total: s.total, passed: s.passed, failed: s.failed, na: s.na };
  return {
    id: String(r.id),
    title: String(r.title),
    date: zonedDayKey(r.finishedAt ?? r.startedAt, timeZone),
    place: r.place ? String(r.place) : null,
    counts,
    result: resultLabel(counts),
    sections: r.structure.sections.map((sec) => ({
      title: String(sec.title),
      items: sec.items.map((item) => {
        const a = byItem.get(item.id);
        const result = effectiveResult(item, a);
        return {
          label: String(item.label),
          kind: item.kind,
          result: result ? RESULT_LABEL[result] : null,
          reading: item.kind === 'READING' && a?.reading ? readingText(item, a.reading) : null,
          limits: item.kind === 'READING' ? limitsText(item) || null : null,
          note: a?.note ? String(a.note) : null,
        };
      }),
    })),
    signatures: [...signatures].sort(byRole).map((sig) => ({
      role: SIGNATURE_LABEL[sig.role],
      name: String(sig.name),
      signedAt: sig.signedAt.toISOString(),
      signedOn: formatDateTime(sig.signedAt, timeZone),
      image: sig.method === 'DRAWN' ? dataUrl(sig.image) : null,
      typed: sig.method === 'TYPED',
    })),
    unsigned: allowedSignatures(r.structure)
      .filter((role) => !signatures.some((sig) => sig.role === role))
      .map((role) => SIGNATURE_LABEL[role]),
    revisionNumber: r.revision + 1,
    reopenedOn: r.reopenedAt ? zonedDayKey(r.reopenedAt, timeZone) : null,
  };
}

/** A shown report as the client page lists it: no items, no signatures (they load when it is opened). */
export interface ClientInspectionSummary {
  id: string;
  title: string;
  date: string;
  place: string | null;
  result: string;
  counts: { total: number; passed: number; failed: number; na: number };
  revisionNumber: number;
  reopenedOn: string | null;
}

/** From the inspection's row alone (its counts were stored when it finished): no further reads. */
export function clientInspectionSummary(r: InspectionRecord, timeZone: string): ClientInspectionSummary {
  const counts = { total: r.counts.itemCount, passed: r.counts.passed, failed: r.counts.failed, na: r.counts.na };
  return {
    id: String(r.id),
    title: String(r.title),
    date: zonedDayKey(r.finishedAt ?? r.startedAt, timeZone),
    place: r.place ? String(r.place) : null,
    result: resultLabel(counts),
    counts,
    revisionNumber: r.revision + 1,
    reopenedOn: r.reopenedAt ? zonedDayKey(r.reopenedAt, timeZone) : null,
  };
}
