/**
 * The task's discussion, in threads: each comment with its replies under it. Anyone who can see the
 * task can reply; its author can change a comment's text; its author or an admin can delete it, after
 * confirming (as on the server). @mentions are suggested while typing (the people the mention can
 * reach) and marked in comments. Every change is sent now or kept on this device; a comment still
 * waiting to sync can't be answered, changed or deleted until it has synced.
 */
import { el, mount, timeAgo } from '../dom.js';
import { isTempId, tempId } from '../../src/pending-overlay.js';
import { threadComments } from '../../src/comment-thread.js';
import { tokenizeMentions } from '../../src/mentions.js';
import { attachMentions, mentionPeople } from './mention-box.js';
import { confirmBox, labelled, redrawKeepingFocus, when } from './kit.js';

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

export function CommentsSection(d) {
  const list = el('ul', { class: 'td-threads', 'aria-label': 'Comments' });
  const empty = el('div', { class: 'muted td-small' });
  const people = () => mentionPeople(d.s.mentionable);

  // The box for a new comment stays on the page: a redraw of the list never touches what is typed.
  const box = el('textarea', { class: 'field', rows: '2', placeholder: 'Write a comment… use @name to mention', 'aria-label': 'New comment', 'aria-describedby': 'td-comment-hint' });
  const mentions = attachMentions(box, people);
  box.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    post();
  });
  const postBtn = el('button', { class: 'btn primary sm', type: 'button', onClick: () => post() }, 'Post');
  const node = el('section', { class: 'td-sec', 'aria-labelledby': 'td-comments-h' },
    el('h3', { class: 'section-title', id: 'td-comments-h' }, 'Comments'),
    list, empty,
    el('div', { class: 'composer td-composer' }, el('div', { class: 'td-box' }, box, mentions.node), postBtn),
    el('p', { class: 'muted td-small', id: 'td-comment-hint' }, `@ to mention · ${isMac() ? '⌘' : 'Ctrl'}+Enter to send`),
  );

  let replying = null;   // the comment being answered
  let replyDraft = '';
  let editing = null;    // the comment whose text is being changed
  let editDraft = '';
  let confirming = null; // the comment being asked about
  let ask = null;        // its question, to focus the safe answer once — when it is first asked

  const byId = (id) => d.s.comments.find((c) => c.id === id) || null;
  const mine = (c) => c.userId === d.ctx.me.id;
  const waiting = (c) => isTempId(c.id) || c.pending;

  function render() {
    redrawKeepingFocus(list, () => mount(list, threadComments(d.s.comments).map(drawThread)));
    empty.textContent = d.s.comments.length ? '' : 'No comments yet. Start the conversation.';
  }

  /** Ask "Delete this comment?" under it, with focus on the safe answer. */
  function askDelete(c) {
    confirming = c.id;
    render();
    if (ask) ask.focusSafe();
  }

  function drawThread({ comment, replies }) {
    const author = d.name(comment.userId);
    const replyHere = replying && (replying === comment.id || replies.some((r) => r.comment.id === replying));
    return el('li', { class: 'td-thread', dataset: { commentId: comment.id, row: `comment:${comment.id}` } },
      drawComment(comment, null),
      replies.length ? el('ul', { class: 'td-replies', 'aria-label': `Replies to ${author}` },
        replies.map((r) => el('li', { class: 'td-reply', dataset: { commentId: r.comment.id, row: `comment:${r.comment.id}` } }, drawComment(r.comment, r.replyTo)))) : null,
      replyHere ? replyBox(byId(replying)) : null,
    );
  }

  function drawComment(c, replyTo) {
    const author = d.name(c.userId);
    const parts = [
      el('div', { class: 'mh' },
        el('span', { class: 'author', dir: 'auto' }, author),
        when(c.createdAt, timeAgo(c.createdAt)),
        c.editedAt ? el('span', { class: 'time' }, '(edited)') : null,
        replyTo ? el('span', { class: 'time' }, `↳ replying to ${d.name(replyTo.userId)}`) : null,
        waiting(c) ? el('span', { class: 'time' }, '· waiting to sync') : null,
      ),
    ];
    if (editing === c.id) parts.push(editBox(c));
    else parts.push(el('div', { class: 'txt', dir: 'auto' }, bodyOf(c.body || '')));
    if (!waiting(c) && editing !== c.id) parts.push(actions(c, author));
    if (confirming === c.id) parts.push(question(c));
    return el('div', { class: 'msg td-comment' }, parts);
  }

  /** The text, with a real person's @name marked (who it is shows on hover). */
  function bodyOf(text) {
    const known = people();
    const byName = new Map(known.map((p) => [p.username.toLowerCase(), p]));
    return tokenizeMentions(text, known.map((p) => p.username)).map((t) => {
      if (t.type !== 'mention') return t.value;
      const p = byName.get(String(t.username).toLowerCase());
      return el('span', { class: 'mention', title: p ? p.name : null }, t.value);
    });
  }

  function actions(c, author) {
    const canDelete = mine(c) || d.isAdmin();
    return el('div', { class: 'td-comment-actions' },
      el('button', { class: 'linkbtn', type: 'button', 'aria-label': `Reply to ${author}`, onClick: () => startReply(c) }, 'Reply'),
      mine(c) ? el('button', { class: 'linkbtn', type: 'button', 'aria-label': 'Edit your comment', onClick: () => startEdit(c) }, 'Edit') : null,
      canDelete && confirming !== c.id
        ? el('button', { class: 'linkbtn danger', type: 'button', 'aria-label': mine(c) ? 'Delete your comment' : `Delete comment by ${author}`, onClick: () => askDelete(c) }, 'Delete')
        : null,
    );
  }

  function question(c) {
    const box2 = confirmBox('Delete this comment?', [{ text: 'Yes, delete', onClick: () => remove(c) }], () => {
      confirming = null;
      render();
      focusIn(c.id, mine(c) ? 'Delete your comment' : `Delete comment by ${d.name(c.userId)}`);
    });
    ask = box2;
    return box2.node;
  }

  /** Focus a control of one comment, found again after a redraw. */
  function focusIn(commentId, label) {
    const row = [...list.querySelectorAll('[data-comment-id]')].find((n) => n.dataset.commentId === commentId);
    const target = row && labelled(row, label);
    if (target) target.focus();
  }

  // ---- Replying ----------------------------------------------------------------------------

  function startReply(c) {
    replying = c.id;
    replyDraft = '';
    editing = null;
    render();
    const field = labelled(list, `Your reply to ${d.name(c.userId)}`);
    if (field) field.focus();
  }

  function stopReply(c) {
    replying = null;
    replyDraft = '';
    render();
    if (c) focusIn(c.id, `Reply to ${d.name(c.userId)}`);
  }

  function replyBox(c) {
    if (!c) return null;
    const author = d.name(c.userId);
    const area = el('textarea', { class: 'field', rows: '2', 'aria-label': `Your reply to ${author}`, placeholder: `Reply to ${author}…` });
    area.value = replyDraft;
    const m = attachMentions(area, people);
    area.addEventListener('input', () => { replyDraft = area.value; });
    area.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopReply(c);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendReply(c, area.value);
      }
    });
    return el('div', { class: 'td-reply-box' },
      el('div', { class: 'td-box' }, area, m.node),
      el('div', { class: 'td-row' },
        el('button', { class: 'btn primary sm', type: 'button', onClick: () => sendReply(c, area.value) }, 'Send reply'),
        el('button', { class: 'btn sm ghost', type: 'button', onClick: () => stopReply(c) }, 'Cancel')));
  }

  function sendReply(c, text) {
    const body = text.trim();
    if (!body) return;
    replying = null;
    replyDraft = '';
    add(body, c.id, () => { replying = c.id; replyDraft = body; });
  }

  // ---- Editing -----------------------------------------------------------------------------

  function startEdit(c) {
    editing = c.id;
    editDraft = c.body || '';
    replying = null;
    render();
    const field = labelled(list, 'Edit comment');
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  function stopEdit(c) {
    editing = null;
    render();
    focusIn(c.id, 'Edit your comment');
  }

  function editBox(c) {
    const area = el('textarea', { class: 'field', rows: '2', 'aria-label': 'Edit comment' });
    area.value = editDraft;
    const m = attachMentions(area, people);
    area.addEventListener('input', () => { editDraft = area.value; });
    area.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopEdit(c);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit(c, area.value);
      }
    });
    return el('div', { class: 'td-edit-box' },
      el('div', { class: 'td-box' }, area, m.node),
      el('div', { class: 'td-row' },
        el('button', { class: 'btn primary sm', type: 'button', 'aria-label': 'Save comment', onClick: () => saveEdit(c, area.value) }, 'Save'),
        el('button', { class: 'btn sm ghost', type: 'button', onClick: () => stopEdit(c) }, 'Cancel')));
  }

  async function saveEdit(c, text) {
    const body = text.trim();
    if (!body) return;
    editing = null;
    if (body === c.body) {
      stopEdit(c);
      return;
    }
    d.clearError();
    const before = { body: c.body, editedAt: c.editedAt };
    Object.assign(c, { body, editedAt: new Date().toISOString() });
    render();
    focusIn(c.id, 'Edit your comment');
    try {
      const r = await d.send('comment.update', { id: d.taskId, commentId: c.id, body });
      if (!r.queued && r.data && r.data.id === c.id) Object.assign(c, r.data);
      d.announce('Comment saved.');
    } catch (e) {
      Object.assign(c, before);
      editing = c.id;
      editDraft = body;
      d.fail(e, 'Couldn’t save the comment.');
    }
    render();
  }

  // ---- Posting and deleting -----------------------------------------------------------------

  function post() {
    const body = box.value.trim();
    if (!body) return;
    box.value = '';
    mentions.close();
    add(body, null, () => { if (!box.value.trim()) box.value = body; });
  }

  /** Show a new comment (or reply) at once, then send it; `undo()` gives the text back on failure. */
  async function add(body, parentId, undo) {
    d.clearError();
    const optimistic = { id: `tmp-${Date.now()}`, userId: d.ctx.me.id, body, parentId, createdAt: new Date().toISOString(), pending: true };
    d.s.comments = [...d.s.comments, optimistic];
    render();
    try {
      const r = await d.send('comment.add', { id: d.taskId, body, ...(parentId ? { parentId } : {}) });
      // Sent: the server's comment. Kept on this device: the temporary id it has when the drawer opens again.
      const kept = !r.queued && r.data && r.data.id ? r.data : { ...optimistic, id: r.item && r.item.id ? tempId(r.item) : optimistic.id };
      d.s.comments = d.s.comments.map((c) => (c === optimistic ? kept : c));
      d.announce(parentId ? 'Reply posted.' : 'Comment posted.');
    } catch (e) {
      d.s.comments = d.s.comments.filter((c) => c !== optimistic);
      undo();
      d.fail(e, parentId ? 'Couldn’t post the reply.' : 'Couldn’t post the comment.');
    }
    render();
  }

  async function remove(c) {
    confirming = null;
    d.clearError();
    d.s.comments = d.s.comments.filter((x) => x.id !== c.id);
    render();
    if (!node.contains(node.ownerDocument.activeElement)) box.focus();
    try {
      await d.send('comment.delete', { id: d.taskId, commentId: c.id });
      d.announce('Comment deleted.');
    } catch (e) {
      // Only this comment comes back (threads are shown in time order): changes made meanwhile stay.
      if (!d.s.comments.some((x) => x.id === c.id)) d.s.comments = [...d.s.comments, c];
      d.fail(e, 'Couldn’t delete the comment.');
      render();
    }
  }

  return { node, render };
}
