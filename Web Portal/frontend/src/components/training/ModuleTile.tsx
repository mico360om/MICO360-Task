import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LessonOutline, ModuleOutline } from '../../api/training';
import { STATUS_CLASS } from '../../lib/colour-classes';
import { ModuleIcon } from './ModuleIcon';
import { shortInstantDay } from './dashboard-rules';
import { LessonKindIcon, LockIcon, NewForRoleChip, TickIcon } from './training-ui';
import { LESSON_KIND_WORDS, lessonsText, minutesText } from './training-words';

/**
 * A module as a tile (13 Nov new look, My learning's grid): its number, icon, name and state — Done with the day (a green
 * tick), "1 of 3 lessons" with a small bar, or Not started with its minutes — and "New for your role". The WHOLE tile is
 * one link (to the module on the course page); nothing inside it is a control. On a phone the tiles are a stacked list
 * (a row each); from 768 px a tile. The current module (Up next) stands out in the brand colour.
 */

const DONE_TONE = STATUS_CLASS.DONE.chip;
const tileClass = (current: boolean) =>
  `card flex h-full min-h-11 min-w-0 items-center gap-3 p-3 text-start outline-none transition-colors md:flex-col md:items-stretch md:gap-2 md:p-4 ${
    current ? 'border-brand bg-brand/5 ring-1 ring-brand/30' : ''
  }`;
const linkClass = 'hover:border-brand/40 hover:bg-ground/60 focus-visible:ring-2 focus-visible:ring-brand/40';

function Tile({
  to,
  name,
  number,
  icon,
  tone,
  title,
  state,
  below,
  current = false,
  dataState,
}: {
  /** null: not a link (a locked lesson). */
  to: string | null;
  name: string;
  number: number;
  icon: ReactNode;
  tone: string;
  title: string;
  state: ReactNode;
  below?: ReactNode;
  current?: boolean;
  dataState: string;
}) {
  const inner = (
    <>
      <span className="flex flex-none items-center gap-2 md:justify-between">
        <span aria-hidden="true" className="w-4 flex-none text-center text-xs font-semibold tabular-nums text-ink-2 md:order-last md:w-auto">
          {number}
        </span>
        <span aria-hidden="true" className={`grid h-10 w-10 flex-none place-items-center rounded-xl ${tone}`}>
          {icon}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="break-words text-sm font-semibold leading-snug text-ink">
          <bdi>{title}</bdi>
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">{state}</span>
        {below}
      </span>
    </>
  );
  const common = { 'data-state': dataState, 'data-current': current ? 'true' : undefined };
  return to === null ? (
    <div {...common} className={`${tileClass(current)} border-dashed`}>
      {inner}
    </div>
  ) : (
    <Link to={to} aria-label={name} {...common} className={`${tileClass(current)} ${linkClass}`}>
      {inner}
    </Link>
  );
}

const Tick = () => (
  <span data-tile-tick className="inline-flex">
    <TickIcon size={13} />
  </span>
);

/** A module's state in words (also its tile's name): "Done · 3 Nov", "1 of 3 lessons", "Not started · 8 min". */
function moduleState(m: ModuleOutline): string {
  if (m.status === 'DONE') return m.doneAt ? `Done · ${shortInstantDay(m.doneAt)}` : 'Done';
  if (m.status === 'IN_PROGRESS') return `${m.lessonsDone} of ${lessonsText(m.lessonCount)}`;
  const time = minutesText(m.minutes);
  return time ? `Not started · ${time}` : 'Not started';
}

/** A module of the person's (`index` from 0: the tile shows index + 1), as one link to `to`. */
export function ModuleTile({ module: m, index, moduleKey, to, current = false }: { module: ModuleOutline; index: number; moduleKey: string | null; to: string; current?: boolean }) {
  const words = moduleState(m);
  const name = [`Module ${index + 1}: ${m.title}`, words, ...(m.newForRole ? ['New for your role'] : []), ...(current ? ['up next'] : [])].join(', ');
  const pct = m.lessonCount > 0 ? Math.round((m.lessonsDone / m.lessonCount) * 100) : 0;
  return (
    <Tile
      to={to}
      name={name}
      number={index + 1}
      current={current}
      dataState={m.status}
      icon={<ModuleIcon moduleKey={moduleKey} size={20} />}
      tone={m.status === 'DONE' ? DONE_TONE : current ? 'bg-brand/10 text-brand' : 'bg-ground text-ink-2'}
      title={m.title}
      state={
        m.status === 'DONE' ? (
          <span className={`inline-flex items-center gap-1 font-semibold ${STATUS_CLASS.DONE.text}`}>
            <Tick />
            {words}
          </span>
        ) : (
          <span className={m.status === 'IN_PROGRESS' ? 'font-semibold text-ink' : undefined}>{words}</span>
        )
      }
      below={
        <>
          {m.status === 'IN_PROGRESS' ? (
            <span data-tile-bar aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </span>
          ) : null}
          {m.newForRole ? (
            <span>
              <NewForRoleChip />
            </span>
          ) : null}
        </>
      }
    />
  );
}

/**
 * A plain course's lesson as a tile (a course without modules shows its lessons in the grid): its kind and minutes, or
 * Done, and "Review" for a changed one. A locked lesson (in order) is not a link: it says so, as the course page does.
 */
export function LessonTile({ lesson: l, index, to, current = false }: { lesson: LessonOutline; index: number; to: string; current?: boolean }) {
  const words = l.done ? 'Done' : [LESSON_KIND_WORDS[l.kind], minutesText(l.minutes)].filter(Boolean).join(' · ');
  const name = [`Lesson ${index + 1}: ${l.title}`, words, ...(l.review ? ['Review'] : []), ...(current ? ['up next'] : [])].join(', ');
  return (
    <Tile
      to={l.locked ? null : to}
      name={name}
      number={index + 1}
      current={current && !l.locked}
      dataState={l.done ? 'DONE' : l.locked ? 'LOCKED' : 'NOT_STARTED'}
      icon={<LessonKindIcon kind={l.kind} size={20} />}
      tone={l.done ? DONE_TONE : current ? 'bg-brand/10 text-brand' : 'bg-ground text-ink-2'}
      title={l.title}
      state={
        l.locked ? (
          <>
            <span className="inline-flex items-center gap-1 font-semibold">
              <LockIcon size={13} />
              Locked
            </span>
            <span className="sr-only">Finish the lessons before it first.</span>
          </>
        ) : l.done ? (
          <span className={`inline-flex items-center gap-1 font-semibold ${STATUS_CLASS.DONE.text}`}>
            <Tick />
            {words}
          </span>
        ) : (
          <span>{words}</span>
        )
      }
      below={
        l.review ? (
          <span>
            <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">Review</span>
          </span>
        ) : null
      }
    />
  );
}
