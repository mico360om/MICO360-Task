/**
 * A task's comments as threads (the server keeps a reply's `parentId`). Pure, so it is unit-tested.
 *
 * `threadComments(comments)` → `[{ comment, replies: [{ comment, replyTo }] }]`: top-level comments
 * oldest first, each with every reply under it oldest first. A reply to a reply stays in the same
 * thread; its `replyTo` is the comment it answers (null when that is the thread's first comment). A
 * reply whose comment was deleted starts a thread of its own, so it is never lost.
 */
export function threadComments(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const time = (x) => {
    const t = new Date(x.createdAt).getTime();
    return Number.isNaN(t) ? Infinity : t;
  };
  const ordered = list.map((comment, i) => ({ comment, i })).sort((a, b) => time(a.comment) - time(b.comment) || a.i - b.i).map((x) => x.comment);
  const byId = new Map(ordered.map((x) => [x.id, x]));
  const place = new Map(ordered.map((x, i) => [x, i]));

  /**
   * The thread a comment belongs to: follow its parents while they are there. Parents that go round
   * in a circle (bad data) make the earliest comment of the circle the thread's first.
   */
  function rootOf(comment) {
    const chain = [comment];
    let at = comment;
    while (at.parentId && byId.has(at.parentId)) {
      const parent = byId.get(at.parentId);
      if (chain.includes(parent)) {
        const circle = chain.slice(chain.indexOf(parent));
        return circle.reduce((a, b) => (place.get(b) < place.get(a) ? b : a));
      }
      chain.push(parent);
      at = parent;
    }
    return at;
  }

  const threads = new Map(); // root id → thread, in the order the roots come
  const roots = [];
  for (const comment of ordered) {
    const root = rootOf(comment);
    if (root === comment) {
      const thread = { comment, replies: [] };
      threads.set(comment.id, thread);
      roots.push(thread);
    }
  }
  for (const comment of ordered) {
    const root = rootOf(comment);
    if (root === comment) continue;
    const parent = byId.get(comment.parentId);
    threads.get(root.id).replies.push({ comment, replyTo: parent && parent !== root ? parent : null });
  }
  return roots;
}
