/**
 * Chrome opens a file dropped where nothing takes it in the tab itself (or in the popup), and
 * whatever was typed but not sent is lost. On the app page and in the popup, a file dropped anywhere
 * else is only kept from opening, and the pointer says it can't be dropped there; a place that takes
 * files (a task's files, the new-task form) has answered first and keeps its own answer. Text and
 * cards being dragged are left alone. Returns a function that takes the guard off again.
 */
export const hasFiles = (e) => Array.from((e && e.dataTransfer && e.dataTransfer.types) || []).includes('Files');

export function guardFileDrops(doc = document) {
  const onDragOver = (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (e) => {
    if (hasFiles(e)) e.preventDefault();
  };
  doc.addEventListener('dragover', onDragOver);
  doc.addEventListener('drop', onDrop);
  return () => {
    doc.removeEventListener('dragover', onDragOver);
    doc.removeEventListener('drop', onDrop);
  };
}
