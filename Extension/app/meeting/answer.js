import { el, mount } from '../dom.js';
import { writeErrorMessage, SAVED_ON_DEVICE } from '../components.js';
import { ANSWERS, answerAfterTap, myAnswerText } from '../../src/meetings.js';
import { createWriteLane } from '../../src/task-writes.js';

/**
 * "Going?" — your answer to a meeting's invitation, as on the web: Accept, Maybe or Decline
 * (pressing the answer you gave takes it back). It shows at once and is sent now, or kept on this
 * device until the connection is back (the queue's `meeting.respond`, in order); one the server
 * refuses goes back, with its reason. The buttons stay put, so focus stays on the one pressed.
 * `attendee`: your row on the meeting (its `pending` set when an answer of yours waits to sync).
 */
export function AnswerControl(ctx, { meeting, attendee, onAnswered }) {
  let current = attendee.response || 'PENDING';
  let kept = !!attendee.pending; // an answer of yours is waiting on this device
  let problem = '';
  const lane = createWriteLane();

  const buttons = ANSWERS.map((a) => el('button', {
    class: 'chip mt-answer', type: 'button', 'aria-pressed': 'false', dataset: { answer: a.value }, onClick: () => press(a.value),
  }, a.label));
  const status = el('p', { class: 'muted mt-answer-status', role: 'status', 'aria-live': 'polite' });
  const alert = el('div', { class: 'mt-answer-problem' });
  const node = el('div', { class: 'mt-answer-box' },
    el('div', { class: 'mt-answers', role: 'group', 'aria-label': 'Your answer' },
      el('span', { class: 'mt-going' }, 'Going?'), buttons),
    status, alert);
  paint();
  return node;

  function paint() {
    for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.answer === current ? 'true' : 'false');
    for (const b of buttons) b.classList.toggle('on', b.dataset.answer === current);
    status.textContent = kept ? `${myAnswerText(current)} ${SAVED_ON_DEVICE}` : myAnswerText(current);
    mount(alert, problem ? el('div', { class: 'errbar', role: 'alert' }, el('span', {}, problem)) : null);
  }

  function press(value) {
    const before = current;
    const next = answerAfterTap(current, value);
    current = next;
    problem = '';
    paint();
    return lane.run(async () => {
      try {
        const r = await ctx.write('meeting.respond', { meetingId: meeting.id, attendeeId: attendee.id, response: next, title: meeting.title });
        kept = !!(r && r.queued);
        if (r && !r.queued && r.data && typeof r.data.response === 'string' && current === next) current = r.data.response;
        if (onAnswered) onAnswered(current);
      } catch (e) {
        if (current === next) current = before;
        problem = writeErrorMessage(e, 'Couldn’t save your answer. Please try again.');
      }
      paint();
    });
  }
}
