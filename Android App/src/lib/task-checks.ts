import type { FormRef, InspectionListItem } from './inspection-types';

/**
 * A task's Inspections card (the website's TaskInspections): a check (a task that carries a form)
 * names its form and has one main button — Continue inspection while one is in progress, View
 * report once finished, else Start inspection; any task can have another inspection started for it;
 * a follow-up task names the inspection and item it follows up. Words verbatim.
 */
export const TASK_CHECK_WORDS = {
  heading: 'Inspections',
  carriedOut: 'Carried out with the form',
  formDeleted: 'Form deleted — this check can still be done.',
  continue: 'Continue inspection',
  report: 'View report',
  start: 'Start inspection',
  another: 'Start another inspection',
  forTask: 'Start an inspection for this task',
  formLabel: 'Inspection form',
  noForm: 'No form',
  formChosen: 'The task opens this checklist; finishing it completes the task.',
  formNone: 'A check carried out with a checklist (optional).',
  place: 'Place (optional)',
  placeExample: 'e.g. Rig 3',
  deleted: '{title} (deleted)',
  startFailed: 'Couldn’t start it. Check your connection and try again.',
  followsUp: 'Follows up “{item}” from the inspection',
} as const;

export type CheckMain = { kind: 'continue' | 'report'; inspectionId: string } | { kind: 'start' };

/** What the card offers: its main button (a check only), the form's line, the deleted-form note, and "start another". */
export function taskCheckCard(o: { form: FormRef | null; place: string | null; attached: InspectionListItem[]; canStart: boolean; noForms?: boolean }): {
  main: CheckMain | null;
  formLine: string | null;
  deletedNote: boolean;
  another: 'another' | 'forTask' | null;
} {
  const inProgress = o.attached.find((x) => x.status === 'IN_PROGRESS');
  const finished = o.attached.find((x) => x.status === 'FINISHED');
  const main: CheckMain | null = !o.form
    ? null
    : inProgress
      ? { kind: 'continue', inspectionId: inProgress.id }
      : finished
        ? { kind: 'report', inspectionId: finished.id }
        : o.canStart
          ? { kind: 'start' }
          : null;
  // With no forms in the company there is nothing to start from (a check carries its own form).
  const offerStart = o.canStart && !o.noForms;
  // A check that has none yet has its own Start above.
  const another = offerStart && !(o.form && !o.attached.length) ? (o.form ? 'another' : 'forTask') : null;
  return { main, formLine: o.form ? `${o.form.title}${o.place ? ` · ${o.place}` : ''}` : null, deletedNote: !!o.form?.deleted, another };
}

/** A follow-up task's line: "Follows up “Rails” from the inspection" and the inspection (it opens). */
export function followUpOfLine(f: { inspection: InspectionListItem; item: string } | null): { before: string; title: string; inspectionId: string } | null {
  return f ? { before: TASK_CHECK_WORDS.followsUp.replace('{item}', f.item), title: f.inspection.title, inspectionId: f.inspection.id } : null;
}

/**
 * Whether the card shows at all (the website's rule): not before the task's inspections are read
 * (or kept on the phone), nor while the forms load for a "Start an inspection" offer; and never
 * empty — nothing attached, not a follow-up, no form and nothing to start.
 */
export function showTaskInspections(o: { loaded: boolean; formsLoading: boolean; attached: readonly unknown[]; followUpOf: unknown; offerStart: boolean; form: FormRef | null }): boolean {
  if (!o.loaded || (o.offerStart && !o.form && o.formsLoading)) return false;
  return o.attached.length > 0 || !!o.followUpOf || o.offerStart || !!o.form;
}
