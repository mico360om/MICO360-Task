/**
 * The task's files: listed with a picture's thumbnail or a badge of its kind, opened from the server
 * (pictures open in a preview here), attached by choosing, dropping or pasting (a screenshot pasted
 * anywhere in the drawer), and removed after asking. Uploads need a connection, as on the web — a
 * file is never kept on this device; removing one is sent now or kept for later like other changes.
 */
import { el, mount } from '../dom.js';
import { fileKind, attachmentUrl, KIND_LABEL } from '../../src/file-kind.js';
import { pastedFiles, isTypingTarget } from '../../src/clipboard-files.js';
import { fileFailure, formatSize } from '../../src/quick-add.js';
import { confirmBox, labelled, redrawKeepingFocus, section } from './kit.js';

/** The server's upload limit, said up front (as on the web). */
const MAX_UPLOAD_MB = 10;
const OFFLINE = 'Files can’t be attached offline. Attach them when you’re connected.';
const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

export function AttachmentsSection(d) {
  const node = el('div');
  let uploads = [];     // { key, name, error? } — files going up, or that couldn't
  let seq = 0;
  let confirming = null; // the file being asked about
  let ask = null;        // its question, to focus the safe answer once — when it is first asked

  node.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    node.classList.add('dragging');
  });
  node.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !node.contains(e.relatedTarget)) node.classList.remove('dragging');
  });
  node.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    node.classList.remove('dragging');
    uploadAll(Array.from(e.dataTransfer.files || []));
  });

  const files = () => d.s.attachments;
  const url = (a) => attachmentUrl(d.ctx.apiBase, a.url);
  const canDelete = (a) => a.uploadedById === d.ctx.me.id || d.isAdmin();

  function render() {
    redrawKeepingFocus(node, () => mount(node, draw()), () => node.querySelector('input[type="file"]'));
  }

  /** Ask "Delete this file?" under it, with focus on the safe answer. */
  function askDelete(a) {
    confirming = a.id;
    render();
    if (ask) ask.focusSafe();
  }

  function draw() {
    const list = files();
    const count = Array.isArray(list) ? list.length : 0;
    const input = el('input', { type: 'file', multiple: 'multiple', class: 'sr-only', 'aria-label': 'Attach files' });
    input.addEventListener('change', () => {
      const chosen = Array.from(input.files || []);
      input.value = '';
      uploadAll(chosen);
    });
    return section('files', count ? `Attachments (${count})` : 'Attachments',
      list === undefined ? el('div', { class: 'muted td-small' }, 'Loading the files…')
        : list === null ? el('div', { class: 'muted td-small' }, 'The files show when you’re online.')
          : null,
      el('ul', { class: 'td-files', 'aria-label': 'Attachments' }, (list || []).map(row), uploads.map(uploadRow)),
      Array.isArray(list) && !list.length && !uploads.length ? el('div', { class: 'muted td-small' }, 'No files yet.') : null,
      el('label', { class: 'td-drop' },
        el('span', { class: 'td-drop-main' }, el('span', { class: 'td-link' }, 'Choose files'), ', drop them here or paste a picture'),
        el('span', { class: 'muted td-small' }, `${isMac() ? '⌘V' : 'Ctrl+V'} pastes a screenshot · up to ${MAX_UPLOAD_MB} MB each · pictures are made smaller to save space`),
        input),
    );
  }

  function row(a) {
    const kind = fileKind(a.mimeType, a.filename);
    const href = url(a);
    const thumb = kind === 'image' && href
      ? el('img', { class: 'td-thumb', src: href, alt: '', loading: 'lazy' })
      : el('span', { class: `td-thumb kind-${kind}`, 'aria-hidden': 'true' }, KIND_LABEL[kind]);
    return el('li', { class: 'td-file', dataset: { row: `file:${a.id}` } },
      el('div', { class: 'td-file-row' },
        thumb,
        el('div', { class: 'td-file-body' },
          href
            ? el('a', { class: 'td-file-name', href, target: '_blank', rel: 'noopener noreferrer', title: `Open ${a.filename}`, dir: 'auto' }, a.filename)
            : el('span', { class: 'td-file-name', dir: 'auto' }, a.filename),
          el('span', { class: 'muted td-small' }, `${KIND_LABEL[kind]} · ${formatSize(a.sizeBytes || 0)}`)),
        kind === 'image' && href
          ? el('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Preview ${a.filename}`, title: 'Preview', onClick: () => preview(a) }, el('span', { 'aria-hidden': 'true' }, '👁'))
          : null,
        canDelete(a) && confirming !== a.id
          ? el('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Delete ${a.filename}`, title: 'Delete', onClick: () => askDelete(a) }, el('span', { 'aria-hidden': 'true' }, '🗑'))
          : null,
      ),
      confirming === a.id ? questionFor(a) : null,
    );
  }

  function questionFor(a) {
    const box = confirmBox('Delete this file?', [{ text: 'Yes, delete', aria: `Yes, delete ${a.filename}`, onClick: () => remove(a) }], () => {
      confirming = null;
      render();
      const again = labelled(node, `Delete ${a.filename}`);
      if (again) again.focus();
    });
    ask = box;
    return box.node;
  }

  function uploadRow(u) {
    if (!u.error) {
      return el('li', { class: 'td-file uploading' },
        el('div', { class: 'td-file-row' },
          el('span', { class: 'td-thumb', 'aria-hidden': 'true' }, '…'),
          el('div', { class: 'td-file-body' }, el('span', { class: 'td-file-name', dir: 'auto' }, u.name), el('span', { class: 'muted td-small' }, 'Uploading…')),
          el('progress', { class: 'td-progress', 'aria-label': `Uploading ${u.name}` })));
    }
    return el('li', { class: 'td-file failed' },
      el('div', { class: 'td-file-row' },
        el('p', { class: 'td-upload-err', role: 'alert' }, `${u.name}: ${u.error}`),
        el('button', { class: 'btn sm ghost', type: 'button', 'aria-label': `Dismiss the message about ${u.name}`, onClick: () => { uploads = uploads.filter((x) => x !== u); render(); } }, 'Dismiss')));
  }

  /** Upload files one after another; each that couldn't go up says why. */
  async function uploadAll(chosen) {
    if (!chosen.length) return;
    if (!d.online()) {
      d.fail(null, OFFLINE);
      return;
    }
    d.clearError();
    const queue = chosen.map((file) => ({ file, u: { key: `u${(seq += 1)}`, name: file.name } }));
    uploads = [...uploads, ...queue.map((q) => q.u)];
    render();
    let attached = 0;
    for (const { file, u } of queue) {
      try {
        const rec = await d.ctx.api.attachments.upload(d.taskId, file);
        uploads = uploads.filter((x) => x !== u);
        if (rec && rec.id) d.s.attachments = [...(Array.isArray(d.s.attachments) ? d.s.attachments : []), rec];
        attached += 1;
        d.announce(`Attached ${file.name}.`);
      } catch (e) {
        u.error = fileFailure(e);
      }
      render();
    }
    if (attached) d.changed();
  }

  async function remove(a) {
    confirming = null;
    d.clearError();
    const at = (d.s.attachments || []).findIndex((x) => x.id === a.id);
    d.s.attachments = (d.s.attachments || []).filter((x) => x.id !== a.id);
    render();
    focusSection();
    try {
      await d.send('attachment.delete', { id: d.taskId, attachmentId: a.id, filename: a.filename });
      d.announce(`Deleted ${a.filename}.`);
    } catch (e) {
      // Only this file comes back, where it was: files added or deleted meanwhile stay as they are.
      const now = Array.isArray(d.s.attachments) ? d.s.attachments : [];
      if (!now.some((x) => x.id === a.id)) d.s.attachments = [...now.slice(0, Math.max(0, at)), a, ...now.slice(Math.max(0, at))];
      d.fail(e, 'Couldn’t delete the file.');
      render();
    }
  }

  /** After a row is gone, focus stays in the section (on the file picker), not on the page. */
  function focusSection() {
    const doc = node.ownerDocument;
    if (doc.activeElement && doc.activeElement !== doc.body && doc.activeElement.isConnected) return;
    const target = node.querySelector('input[type="file"]');
    if (target) target.focus();
  }

  /** A picture shown large, over the drawer, until closed (Escape closes only it). */
  function preview(a) {
    const href = url(a);
    const opener = `Preview ${a.filename}`;
    const close = el('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close preview', title: 'Close preview (Esc)' }, el('span', { 'aria-hidden': 'true' }, '✕'));
    const box = el('div', { class: 'td-preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Preview of ${a.filename}`, tabindex: '-1' },
      el('div', { class: 'td-preview-head' },
        el('span', { class: 'td-preview-name', dir: 'auto', title: a.filename }, a.filename),
        el('span', { class: 'muted td-small' }, formatSize(a.sizeBytes || 0)),
        el('a', { class: 'btn sm', href, target: '_blank', rel: 'noopener noreferrer' }, 'Open in a new tab'),
        close),
      el('div', { class: 'td-preview-body' }, el('img', { src: href, alt: a.filename })));
    const release = d.layer(box);
    const done = () => {
      release();
      const again = labelled(node, opener);
      if (again) again.focus();
    };
    close.addEventListener('click', done);
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      done();
    });
    close.focus();
  }

  /** A paste anywhere in the drawer: pictures and files are attached; text typed into a box stays text. */
  function onPaste(e) {
    const got = pastedFiles(e.clipboardData, { typing: isTypingTarget(e.target) });
    if (!got.length) return;
    e.preventDefault();
    uploadAll(got);
  }

  return { node, render, onPaste };
}

function hasFiles(e) {
  return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
}
