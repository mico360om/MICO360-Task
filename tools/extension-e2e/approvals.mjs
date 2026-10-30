// Task approvals in the extension (owner, 30 Oct), in Chrome against a local server. In a throwaway
// project Omar runs (Sara on its team), Sara finishes two tasks that need approval, so they wait:
// - Omar (the project's manager): My Tasks shows "Waiting for approval" with Approve and Send back;
//   Approve makes it done on the server. The board card has the badge and, under it, Approve and
//   Send back; Send back asks why (required — "Write a reason first."), and the reason reaches the
//   server (in progress again, the reason as his comment).
// - Sara (on the team, doesn't run it): the badge, and no Approve / Send back.
//   MICO_E2E_SERVER=http://localhost:4421 node tools/extension-e2e/approvals.mjs   (see lib.mjs for the settings)
import { launch, openApp, signIn, signedIn, apiSession, credentials, checks, outDir, todayIn, sleep } from './lib.mjs';

const shots = outDir('approvals');
const { ck, error, done } = checks();
const admin = await apiSession(credentials('admin@mico360.test'));
const omarWho = credentials('omar@mico360.test');
const saraWho = credentials('sara@mico360.test');
const omar = await apiSession(omarWho);
const sara = await apiSession(saraWho);
const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const today = todayIn();

// A throwaway project Omar runs (its owner); Sara on its team; the admin who made it taken off it.
const P = (await admin.call('POST', '/projects', { name: `Ext approvals ${stamp}`, code: `EA${stamp}`, color: '#8B1E1E', status: 'ACTIVE', ownerId: omar.user.id, memberIds: [sara.user.id] })).data;
if (!P) throw new Error('could not make the project');
await admin.call('DELETE', `/projects/${P.id}/members/${admin.user.id}`);
const cols = (await admin.call('GET', `/projects/${P.id}/columns`)).data;
const col = (category) => cols.filter((c) => c.category === category && c.enabled !== false).sort((a, b) => a.position - b.position)[0];
/** A task Sara finishes (it needs approval, so it waits); on Omar's and Sara's lists. */
async function waitingTask(title) {
  const t = (await sara.call('POST', '/tasks', { title, projectId: P.id, columnId: col('IN_PROGRESS').id, assigneeIds: [sara.user.id, omar.user.id], needsApproval: true, boardDate: today })).data;
  await sara.call('PATCH', `/tasks/${t.id}/move`, { columnId: col('DONE').id });
  return t;
}
const A = await waitingTask(`Approve me ${stamp}`);
const B = await waitingTask(`Send me back ${stamp}`);
const REASON = `Add the gauge readings ${stamp}`;
const task = async (id) => (await admin.call('GET', `/tasks/${id}`)).data;
const click = (label) => `(() => { const b = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!b) return false; b.focus(); b.click(); return true; })()`;

try {
  ck('both tasks wait for approval on the server', !!(await task(A.id)).approvalRequestedAt && !!(await task(B.id)).approvalRequestedAt);

  // ── Omar ──
  const browser = await launch({ name: 'approvals-omar' });
  try {
    const page = await openApp(browser, { shotsDir: shots });
    const { evaluate, shot, press, insertText } = page;
    ck('signs in as the project’s manager (Omar)', signedIn((await signIn(page, omarWho)).after));

    await evaluate(`location.hash = '#/my-tasks'; true`);
    await sleep(3500);
    const row = await evaluate(`(() => { const r = [...document.querySelectorAll('.task-row')].find((x) => x.dataset.taskId === ${JSON.stringify(A.id)}); const w = r && (r.closest('.task-row-wrap') || r);
      return w ? { label: w.querySelector('.waiting-approval')?.textContent, approve: !!w.querySelector(${JSON.stringify(`[aria-label="Approve ${A.key}"]`)}), sendBack: !!w.querySelector(${JSON.stringify(`[aria-label="Send ${A.key} back"]`)}), mark: !!w.querySelector('.mark-done') } : null; })()`);
    ck('My Tasks: the waiting task says “Waiting for approval”, with Approve and Send back (no Mark done)', !!row && row.label === 'Waiting for approval' && row.approve && row.sendBack && !row.mark, JSON.stringify(row));
    await shot('01-my-tasks-approver.png');
    ck('…Approve is pressed', await evaluate(click(`Approve ${A.key}`)));
    await sleep(3000);
    const a = await task(A.id);
    ck('…the server has it done, approved by Omar', !!a.completedAt && a.columnCategory === 'DONE' && a.approvedById === omar.user.id && !a.approvalRequestedAt, JSON.stringify({ completedAt: a.completedAt, columnCategory: a.columnCategory, approvedById: a.approvedById }));
    const said = await evaluate(`({ said: document.querySelector('.sr-only[role="status"]')?.textContent, completed: (() => { const s = [...document.querySelectorAll('.mt-section')].find((x) => x.querySelector('.section-title').textContent.startsWith('Completed')); return !!s && s.textContent.includes(${JSON.stringify(A.title)}); })() })`);
    ck('…it is said (“Approved KEY.”) and listed under Completed', said.said === `Approved ${A.key}.` && said.completed, JSON.stringify(said));

    await evaluate(`location.hash = '#/board/${P.id}'; true`);
    await sleep(3500);
    const card = await evaluate(`(() => { const c = [...document.querySelectorAll('.tcard')].find((x) => x.dataset.taskId === ${JSON.stringify(B.id)}); if (!c) return null; const w = c.closest('.tcard-wrap');
      return { badge: c.querySelector('.twaiting')?.textContent, name: c.getAttribute('aria-label'), column: c.closest('.column')?.getAttribute('aria-label'),
        approve: !!w.querySelector(${JSON.stringify(`[aria-label="Approve ${B.key}"]`)}), sendBack: !!w.querySelector(${JSON.stringify(`[aria-label="Send ${B.key} back"]`)}), inside: !!c.querySelector('button') }; })()`);
    ck('Board: the card has the “Waiting for approval” badge, and says it in its name', !!card && card.badge === 'Waiting for approval' && /waiting for approval/.test(card.name), JSON.stringify(card));
    ck('…Approve and Send back beside the card (not inside it)', !!card && card.approve && card.sendBack && !card.inside, JSON.stringify(card));
    await shot('02-board-approver.png');
    ck('…Send back is pressed', await evaluate(click(`Send ${B.key} back`)));
    await sleep(800);
    const dlg = await evaluate(`(() => { const d = document.querySelector('[role="dialog"][aria-modal="true"]'); if (!d) return null;
      return { title: document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, focus: document.activeElement?.tagName, label: document.querySelector('label[for="' + document.activeElement?.id + '"]')?.textContent }; })()`);
    ck('…a dialog asks why, focus in the reason box', !!dlg && dlg.title === `Send ${B.key} back?` && dlg.focus === 'TEXTAREA' && dlg.label === 'Why are you sending it back?', JSON.stringify(dlg));
    await press('Enter', { ctrl: true });
    await sleep(500);
    const empty = await evaluate(`(() => { const d = document.querySelector('[role="dialog"][aria-modal="true"]'); return { open: !!d, need: d && d.textContent.includes('Write a reason first.'), focus: document.activeElement?.tagName }; })()`);
    ck('…sending with no reason: “Write a reason first.”, still open, back in the box', empty.open && empty.need && empty.focus === 'TEXTAREA', JSON.stringify(empty));
    ck('…and nothing reached the server', !!(await task(B.id)).approvalRequestedAt);
    await shot('03-send-back-dialog.png');
    await insertText(REASON);
    await press('Enter', { ctrl: true });
    await sleep(3000);
    const b = await task(B.id);
    ck('…with a reason (Ctrl+Enter): the server has it in progress again, not waiting', !b.approvalRequestedAt && !b.completedAt && b.columnId === col('IN_PROGRESS').id, JSON.stringify({ columnCategory: b.columnCategory, approvalRequestedAt: b.approvalRequestedAt }));
    const comments = (await admin.call('GET', `/tasks/${B.id}/comments`)).data ?? [];
    ck('…the reason is Omar’s comment on it', comments.some((c) => c.body === REASON && (c.userId === omar.user.id || c.author?.id === omar.user.id)), JSON.stringify(comments.at(-1) ?? null).slice(0, 160));
    const after = await evaluate(`(() => { const c = [...document.querySelectorAll('.tcard')].find((x) => x.dataset.taskId === ${JSON.stringify(B.id)});
      return { dialog: !!document.querySelector('[role="dialog"][aria-modal="true"]'), column: c?.closest('.column')?.getAttribute('aria-label'), badge: !!c?.querySelector('.twaiting'), said: document.querySelector('.sr-only[role="status"]')?.textContent }; })()`);
    ck('…the dialog closes, the card is drawn in In progress without the badge, and it is said', !after.dialog && after.column === col('IN_PROGRESS').name && !after.badge && after.said === `Sent ${B.key} back.`, JSON.stringify(after));
    await shot('04-board-after.png');
    ck('no script errors in the extension page (Omar)', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
  } finally {
    await browser.close();
  }

  // ── Sara: B again waits; she sees the badge, no buttons ──
  await sara.call('PATCH', `/tasks/${B.id}/move`, { columnId: col('DONE').id });
  const browser2 = await launch({ name: 'approvals-sara' });
  try {
    const page = await openApp(browser2, { shotsDir: shots });
    const { evaluate, shot } = page;
    ck('signs in as Sara (on the team, doesn’t run it)', signedIn((await signIn(page, saraWho)).after));
    await evaluate(`location.hash = '#/my-tasks'; true`);
    await sleep(3500);
    const row = await evaluate(`(() => { const r = [...document.querySelectorAll('.task-row')].find((x) => x.dataset.taskId === ${JSON.stringify(B.id)}); const w = r && (r.closest('.task-row-wrap') || r);
      return w ? { label: w.querySelector('.waiting-approval')?.textContent, buttons: w.querySelectorAll('.approval-actions button, .mark-done').length } : null; })()`);
    ck('Sara’s My Tasks: “Waiting for approval”, and no Approve / Send back (nor Mark done)', !!row && row.label === 'Waiting for approval' && row.buttons === 0, JSON.stringify(row));
    await evaluate(`location.hash = '#/board/${P.id}'; true`);
    await sleep(3500);
    const card = await evaluate(`(() => { const c = [...document.querySelectorAll('.tcard')].find((x) => x.dataset.taskId === ${JSON.stringify(B.id)}); const w = c && c.closest('.tcard-wrap');
      return c ? { badge: c.querySelector('.twaiting')?.textContent, buttons: w.querySelectorAll('.tcard-approval button').length } : null; })()`);
    ck('Sara’s board: the badge, and no Approve / Send back', !!card && card.badge === 'Waiting for approval' && card.buttons === 0, JSON.stringify(card));
    await shot('05-board-sara.png');
    ck('no script errors in the extension page (Sara)', page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
  } finally {
    await browser2.close();
  }
} catch (e) {
  error(e);
} finally {
  for (const id of [A.id, B.id]) await admin.call('DELETE', `/tasks/${id}`).catch(() => {});
  await admin.call('DELETE', `/projects/${P.id}`).catch(() => {});
}
console.log(`  (screenshots: ${shots})`);
process.exit(done());
