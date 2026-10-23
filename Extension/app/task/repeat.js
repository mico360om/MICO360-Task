/**
 * The task drawer's repeat editor. Each change is saved (or kept on this device) like any other edit
 * of the task, through `setRule`. A repeat rule lives on a series' newest copy and is never sent "for
 * the whole series" (as on the web).
 */
import { el } from '../dom.js';
import {
  FREQS, FREQ_LABEL, UNIT_LABEL, DAY_NAMES, WEEKDAY_NAMES, WEEK_OF_MONTH, recurrenceSummary, withFreq, withInterval,
  toggleWeekday, withMonthlyMode, withNth, withDayOfMonth, withEnds, endsMode, withCreateNext, togglePaused, isEarlierCopy,
} from '../../src/recurrence.js';
import { row, select } from './kit.js';

/** `dueKey`: the due day ('YYYY-MM-DD', or today), from which monthly choices are suggested. */
export function repeatEditor(task, dueKey, setRule) {
  const rule = task.recurrenceRule || null;
  if (isEarlierCopy(task)) {
    // Repeating an earlier copy would start a second, parallel series.
    return el('div', { class: 'muted td-note' }, '🔁 An earlier copy of a repeating series — change the repeat on its newest copy.');
  }
  const rows = [row(select('Repeat', [['NONE', 'Does not repeat'], ...FREQS.map((f) => [f, FREQ_LABEL[f]])], rule ? rule.freq : 'NONE', (v) => setRule(withFreq(rule, v))))];
  if (!rule) return el('div', {}, rows);

  rows.unshift(el('div', { class: 'td-repeat-summary' }, `🔁 ${recurrenceSummary(rule)}`));
  const every = el('input', { class: 'field td-num', type: 'number', min: '1', value: String(rule.interval), 'aria-label': 'Repeat every' });
  every.addEventListener('change', () => setRule(withInterval(rule, every.value)));
  rows.push(row(el('span', { class: 'muted' }, 'Every'), every, el('span', { class: 'muted' }, UNIT_LABEL[rule.freq])));

  if (rule.freq === 'WEEKLY') {
    rows.push(row(DAY_NAMES.map((name, day) => {
      const on = (rule.weekdays || []).includes(day);
      return el('button', { class: `chip${on ? ' on' : ''}`, type: 'button', 'aria-label': name, 'aria-pressed': String(on), onClick: () => setRule(toggleWeekday(rule, day)) }, name);
    })));
  }
  if (rule.freq === 'MONTHLY' || rule.freq === 'QUARTERLY') {
    const mode = rule.nthWeekday ? 'WEEKDAY' : 'DATE';
    const parts = [
      el('span', { class: 'muted' }, 'On'),
      select(rule.freq === 'MONTHLY' ? 'Monthly on' : 'Quarterly on', [['DATE', 'a day of the month'], ['WEEKDAY', 'a weekday of the month']], mode, (v) => setRule(withMonthlyMode(rule, v, dueKey))),
    ];
    if (mode === 'DATE') {
      const day = el('input', { class: 'field td-num', type: 'number', min: '1', max: '31', value: rule.dayOfMonth ? String(rule.dayOfMonth) : '', placeholder: 'due day', title: '31 means the last day of every month', 'aria-label': 'Day of month' });
      day.addEventListener('change', () => setRule(withDayOfMonth(rule, day.value)));
      parts.push(day);
    } else {
      parts.push(
        el('span', { class: 'muted' }, 'the'),
        select('Week of the month', WEEK_OF_MONTH.map((w) => [String(w.week), w.label]), String(rule.nthWeekday.week), (v) => setRule(withNth(rule, { week: Number(v) }))),
        select('Weekday', WEEKDAY_NAMES.map((n, d) => [String(d), n]), String(rule.nthWeekday.day), (v) => setRule(withNth(rule, { day: Number(v) }))),
      );
    }
    rows.push(row(parts));
  }

  const ends = endsMode(rule);
  const endParts = [el('span', { class: 'muted' }, 'Ends'), select('Ends', [['NEVER', 'Never'], ['COUNT', 'After a number of copies'], ['UNTIL', 'On a date']], ends, (v) => setRule(withEnds(rule, v, dueKey)))];
  if (ends === 'COUNT') {
    const count = el('input', { class: 'field td-num', type: 'number', min: '1', value: String(rule.count), 'aria-label': 'Number of occurrences' });
    count.addEventListener('change', () => { const n = Number(count.value); setRule({ ...rule, count: Number.isInteger(n) && n >= 1 ? n : 1, until: null }); });
    endParts.push(count);
  } else if (ends === 'UNTIL') {
    const until = el('input', { class: 'field td-date', type: 'date', value: String(rule.until).slice(0, 10), 'aria-label': 'End date' });
    until.addEventListener('change', () => { if (until.value) setRule({ ...rule, until: until.value, count: null }); });
    endParts.push(until);
  }
  rows.push(row(endParts));
  rows.push(row(
    el('span', { class: 'muted' }, 'Create the next copy'),
    select('Create the next copy', [['ON_COMPLETE', 'when this one is done'], ['ON_SCHEDULE', 'on each date, even if not done']], rule.createNext || 'ON_COMPLETE', (v) => setRule(withCreateNext(rule, v))),
  ));
  rows.push(row(el('button', { class: 'btn sm', type: 'button', onClick: () => setRule(togglePaused(rule)) }, rule.paused ? '▶ Resume series' : '⏸ Pause series')));
  return el('div', {}, rows);
}
