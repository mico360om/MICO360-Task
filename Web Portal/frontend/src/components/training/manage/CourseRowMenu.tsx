import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ManageCourseRow } from '../../../api/training';
import { TOUCH_SQUARE } from '../../../lib/touch';
import { ActionMenu, type ActionMenuItem } from '../../meeting/ActionMenu';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AssignDialog } from './AssignDialog';
import { ASK_WORDS, type CourseAsk } from './PublishPanel';
import { count, errorCode, problemText } from './manage-ui';
import { MANAGE_KEY, REPORTS_KEY, manageKeys, tc } from './manage-queries';

/** What a row's action says above the list: done, or why not (with the way to the course's editor when that helps). */
export interface RowNotice {
  tone: 'ok' | 'error' | 'info';
  text: string;
  /** Offer "Edit the course" (a publish refused for what the editor fixes). */
  editId?: string;
}

const editorPath = (id: string, publish = false) => `/training/manage/courses/${encodeURIComponent(id)}${publish ? '?publish=1' : ''}`;

/** The publish item the course's state offers (as the editor's Publish panel says it), or null. */
function publishItem(c: ManageCourseRow): { label: string; direct: boolean } | null {
  if (c.status === 'DRAFT') return c.everPublished ? { label: 'Publish again', direct: false } : { label: 'Publish', direct: true };
  if (c.status === 'ARCHIVED') return { label: 'Publish again', direct: false };
  return c.unpublishedChanges ? { label: 'Publish changes', direct: false } : null;
}

const DONE: Readonly<Record<CourseAsk, (t: string) => string>> = {
  unpublish: (t) => `Unpublished “${t}”: it is a draft again.`,
  archive: (t) => `Archived “${t}”.`,
  delete: (t) => `Deleted “${t}”.`,
};
const FAILED: Readonly<Record<CourseAsk, string>> = { unpublish: 'Couldn’t unpublish it.', archive: 'Couldn’t archive it.', delete: 'Couldn’t delete it.' };

/**
 * A course's ⋯ menu in the Manage list (the same rights as its editor): Edit; Preview as learner; Assign (published
 * only); Publish (a draft never published: straight away) / Publish changes / Publish again (the editor's publish
 * window) ; Duplicate (a draft copy, then its editor); Unpublish, Archive and Delete (a draft never published) ask
 * first. Arrows, Home and End move in the menu; Escape closes it back to its button (ActionMenu).
 */
export function CourseRowMenu({ course, onNotice }: { course: ManageCourseRow; onNotice: (n: RowNotice | null) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [asking, setAsking] = useState<CourseAsk | null>(null);
  const [askProblem, setAskProblem] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = course.title;
  const publish = publishItem(course);

  const refreshList = () => {
    void qc.invalidateQueries({ queryKey: MANAGE_KEY });
    void qc.invalidateQueries({ queryKey: REPORTS_KEY });
  };

  async function publishNow() {
    if (busy) return;
    setBusy(true);
    onNotice({ tone: 'info', text: `Publishing “${t}”…` });
    try {
      const next = await tc().publish(course.id);
      qc.setQueryData(manageKeys.course(course.id), next);
      refreshList();
      onNotice({ tone: 'ok', text: `Published “${t}”. People can now find it, and you can assign it.` });
    } catch (err) {
      // Published before after all (the list was out of date): the editor asks what kind of change it is.
      if (errorCode(err) === 'CHANGE_KIND_NEEDED') {
        onNotice(null);
        navigate(editorPath(course.id, true));
        return;
      }
      onNotice({ tone: 'error', text: `Couldn’t publish “${t}”. ${problemText(err)}`, ...(errorCode(err) === 'PUBLISH_PROBLEMS' ? { editId: course.id } : {}) });
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (busy) return;
    setBusy(true);
    onNotice({ tone: 'info', text: `Making a copy of “${t}”…` });
    try {
      const copy = await tc().duplicateCourse(course.id);
      qc.setQueryData(manageKeys.course(copy.id), copy);
      refreshList();
      onNotice(null);
      navigate(editorPath(copy.id));
    } catch (err) {
      onNotice({ tone: 'error', text: `Couldn’t duplicate “${t}”. ${problemText(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function act(what: CourseAsk) {
    setBusy(true);
    setAskProblem(null);
    try {
      if (what === 'delete') {
        await tc().deleteCourse(course.id);
        qc.removeQueries({ queryKey: manageKeys.course(course.id) });
      } else {
        const next = what === 'unpublish' ? await tc().unpublish(course.id) : await tc().archive(course.id);
        qc.setQueryData(manageKeys.course(course.id), next);
      }
      refreshList();
      setAsking(null);
      onNotice({ tone: 'ok', text: DONE[what](t) });
    } catch (err) {
      setAskProblem(`${FAILED[what]} ${problemText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const ask = (what: CourseAsk) => {
    setAskProblem(null);
    setAsking(what);
  };

  const items: ActionMenuItem[] = [
    { label: 'Edit', onSelect: () => navigate(editorPath(course.id)) },
    { label: 'Preview as learner', onSelect: () => navigate(`/training/courses/${encodeURIComponent(course.id)}`) },
  ];
  if (course.status === 'PUBLISHED') items.push({ label: 'Assign', onSelect: () => setAssigning(true) });
  if (publish) items.push({ label: publish.label, onSelect: () => (publish.direct ? void publishNow() : navigate(editorPath(course.id, true))) });
  items.push({ label: 'Duplicate', onSelect: () => void duplicate() });
  if (course.status === 'PUBLISHED') items.push({ label: 'Unpublish', onSelect: () => ask('unpublish') });
  if (course.status !== 'ARCHIVED') items.push({ label: 'Archive', onSelect: () => ask('archive') });
  if (course.status === 'DRAFT' && !course.everPublished) items.push({ label: 'Delete', danger: true, onSelect: () => ask('delete') });

  return (
    <>
      <ActionMenu
        label={`More for ${t}`}
        items={items}
        className="flex-none"
        buttonClassName={`grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${TOUCH_SQUARE}`}
      />
      {asking ? (
        <ConfirmDialog
          title={ASK_WORDS[asking].title(t)}
          confirmLabel={ASK_WORDS[asking].confirm}
          tone={ASK_WORDS[asking].tone}
          busy={busy}
          error={askProblem}
          onConfirm={() => void act(asking)}
          onClose={() => setAsking(null)}
        >
          {ASK_WORDS[asking].body}
        </ConfirmDialog>
      ) : null}
      {assigning ? (
        <AssignDialog
          initialCourseIds={[course.id]}
          onClose={() => setAssigning(false)}
          onAssigned={(reach, newStaff) =>
            onNotice({ tone: 'ok', text: newStaff ? `Done. People who join from now on get “${t}”.` : reach === null ? `Assigned “${t}”.` : `Assigned “${t}”. It reaches ${count(reach, 'person', 'people')}.` })
          }
        />
      ) : null}
    </>
  );
}
