import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DIFFICULTIES, LIMITS, MODULE_LABELS, TRAINING_MODULES, type Audience, type Difficulty, type TrainingModule } from '../../../api/training';
import { fieldClass } from '../../ui/Field';
import { stayOnEnter } from '../../../lib/enter-key';
import { ChoiceGroup, FormRow, ManageDialog } from './ManageDialog';
import { DIFFICULTY_LABELS, Notice, problemText } from './manage-ui';
import { MANAGE_KEY, tc } from './manage-queries';

/** The Client portal's module is for clients only (the server refuses Staff). */
export const forcesClients = (m: TrainingModule): boolean => m === 'portal';

/** "New course": what it is called, its module, who it is for and how hard — saved as a draft, then its editor opens. */
export function NewCourseDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = { title: useId(), titleErr: useId(), module: useId(), difficulty: useId() };
  const [title, setTitle] = useState('');
  const [moduleKey, setModule] = useState<TrainingModule>('tasks');
  const [audience, setAudience] = useState<Audience>('STAFF');
  const [difficulty, setDifficulty] = useState<Difficulty>('BEGINNER');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAudience: Audience = forcesClients(moduleKey) ? 'CLIENTS' : audience;

  async function create() {
    const t = title.trim();
    if (!t) return setTitleError('Give the course a title.');
    if (t.length > LIMITS.courseTitle) return setTitleError(`Use at most ${LIMITS.courseTitle} characters.`);
    setBusy(true);
    setError(null);
    try {
      const course = await tc().createCourse({ title: t, moduleKey, audience: shownAudience, difficulty });
      void qc.invalidateQueries({ queryKey: MANAGE_KEY });
      onClose();
      navigate(`/training/manage/courses/${encodeURIComponent(course.id)}`);
    } catch (err) {
      setError(`Couldn’t create the course. ${problemText(err)}`);
      setBusy(false);
    }
  }

  return (
    <ManageDialog title="New course" onClose={onClose} onSubmit={() => void create()} submitLabel="Create draft" busy={busy}>
      {error ? <Notice>{error}</Notice> : null}
      <FormRow label="Title" htmlFor={ids.title} error={titleError} errorId={ids.titleErr} hint="Learners see it in My learning and All courses.">
        <input
          id={ids.title}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(null);
          }}
          onKeyDown={stayOnEnter}
          maxLength={LIMITS.courseTitle}
          dir="auto"
          aria-required="true"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? ids.titleErr : undefined}
          placeholder="e.g. Tasks basics"
          className={fieldClass(!!titleError, 'w-full')}
        />
      </FormRow>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Module" htmlFor={ids.module} hint="The part of the site it teaches.">
          <select id={ids.module} value={moduleKey} onChange={(e) => setModule(e.target.value as TrainingModule)} className={fieldClass(false, 'w-full')}>
            {TRAINING_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
          </select>
        </FormRow>
        <FormRow label="Difficulty" htmlFor={ids.difficulty}>
          <select id={ids.difficulty} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)} className={fieldClass(false, 'w-full')}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>)}
          </select>
        </FormRow>
      </div>
      <ChoiceGroup<Audience>
        legend="For"
        name="new-course-audience"
        value={shownAudience}
        onChange={setAudience}
        options={[
          { value: 'STAFF', label: 'Staff', hint: 'People who sign in to the site.', disabled: forcesClients(moduleKey) },
          { value: 'CLIENTS', label: 'Clients', hint: 'Client accounts, in the Client portal’s Learning Hub.' },
        ]}
      />
      {forcesClients(moduleKey) ? <p className="text-xs text-ink-2">Client portal courses are for clients.</p> : null}
    </ManageDialog>
  );
}
