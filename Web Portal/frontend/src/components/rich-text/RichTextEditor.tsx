import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { TextSelection } from '@tiptap/pm/state';
import { safeHref } from '../../lib/rich-note';

/** Put the cursor at the end of what is selected (a chain step). */
const caretAfter = ({ tr }: { tr: import('@tiptap/pm/state').Transaction }) => {
  tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
  return true;
};

const ICON = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const Icons = {
  bold: <svg {...ICON}><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" /></svg>,
  italic: <svg {...ICON}><path d="M14 5h-4M14 19h-4M14 5l-4 14" /></svg>,
  underline: <svg {...ICON}><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" /></svg>,
  heading: <svg {...ICON}><path d="M6 5v14M16 5v14M6 12h10M19 19v-6l-2 1" /></svg>,
  bullets: <svg {...ICON}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" /><circle cx="4.5" cy="12" r="1" fill="currentColor" /><circle cx="4.5" cy="18" r="1" fill="currentColor" /></svg>,
  numbers: <svg {...ICON}><path d="M10 6h10M10 12h10M10 18h10M4 4.5l1.5-.5V9M3.5 9h3M3.5 14.5a1.5 1.5 0 0 1 3 .5c0 1-3 2-3 3.5h3" /></svg>,
  highlight: <svg {...ICON}><path d="m9 11 6-6 4 4-6 6M9 11l-3 3 4 4 3-3M6 14l-3 6h6" /></svg>,
  link: <svg {...ICON}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** What the person typed as a link address, made whole: https:// added to a bare address, mailto: to an email. */
export function linkAddress(typed: string): string | null {
  const t = typed.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return safeHref(t);
  return safeHref(/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(t) ? `mailto:${t}` : `https://${t}`);
}

/**
 * The words selected in the editor. Read from the page's own selection when it is inside the
 * editor: the editor takes a moment to see a selection made with the keyboard, and Ctrl+K pressed
 * straight after Shift+Arrow would otherwise find nothing selected.
 */
function selectedRange(editor: Editor): { from: number; to: number } {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const dom = editor.view.dom;
  if (sel && sel.rangeCount > 0 && sel.anchorNode && sel.focusNode && dom.contains(sel.anchorNode) && dom.contains(sel.focusNode)) {
    try {
      const a = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset);
      const b = editor.view.posAtDOM(sel.focusNode, sel.focusOffset);
      return { from: Math.min(a, b), to: Math.max(a, b) };
    } catch {
      // A position the editor can't place: use its own.
    }
  }
  return { from: editor.state.selection.from, to: editor.state.selection.to };
}

function ToolButton({ label, keys, active, onClick, children }: { label: string; keys?: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={keys ? `${label} (${keys})` : label}
      // Keep the words selected: the editor keeps its focus while a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${active ? 'bg-brand/15 text-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

/**
 * A box for formatted text: bold, italic, underline, a heading, bulleted and numbered lists,
 * highlight and links — from the toolbar, the usual shortcuts (Ctrl+B / I / U, Ctrl+K for a link)
 * or by typing "- " or "1. " at the start of a line. Pasted text keeps only that formatting. Each
 * paragraph takes its own direction (Arabic and English side by side). It reports its content as
 * HTML ('' when empty); Ctrl+Enter calls `onSubmit`.
 */
export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  placeholder,
  onSubmit,
  autoFocus = false,
  invalid = false,
  minHeight = '3.25rem',
}: {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
  invalid?: boolean;
  minHeight?: string;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const openLinkRef = useRef<() => void>(() => {});
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  /** What the box reported that the page hasn't shown back yet, oldest first. */
  const reportedRef = useRef<string[]>([]);

  const editor = useEditor({
    // The toolbar shows what is on at the cursor, so it is drawn again after each change.
    shouldRerenderOnTransaction: true,
    extensions: [
      // Underline comes with the kit. Its link is replaced by ours below, and no empty paragraph
      // is added after a list (notes are saved as written).
      StarterKit.configure({ heading: { levels: [3] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false, link: false, trailingNode: false }),
      Highlight,
      // Words typed straight after a link are not part of it (with autolink on, Tiptap would make
      // the link "inclusive" and stretch it over them).
      Link.extend({ inclusive: () => false }).configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['mailto'],
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
        // Only web and email addresses, whether typed, pasted or found while writing.
        isAllowedUri: (href) => safeHref(href) !== null,
        shouldAutoLink: (href) => safeHref(href) !== null,
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current ?? '' }),
    ],
    content: value || '',
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': ariaLabel, 'aria-multiline': 'true', dir: 'auto', class: 'rich-text rich-editor-input' },
      handleKeyDown: (_view, event) => {
        const modKey = event.metaKey || event.ctrlKey;
        if (modKey && event.key === 'Enter') {
          event.preventDefault();
          onSubmitRef.current?.();
          return true;
        }
        if (modKey && (event.key === 'k' || event.key === 'K')) {
          event.preventDefault();
          openLinkRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.isEmpty ? '' : e.getHTML();
      const sent = reportedRef.current;
      sent.push(html);
      if (sent.length > 50) sent.splice(0, sent.length - 50);
      onChangeRef.current(html);
    },
  });

  // The page sets the content too (clearing it after a note is added, or another note to edit).
  // What the box reported comes back from the page a moment later; when it does, it is the box's
  // own words, perhaps an older copy (the next key was already pressed), and must not undo what
  // was typed since. Anything else is the page's own change.
  useEffect(() => {
    if (!editor) return;
    const sent = reportedRef.current;
    const own = sent.lastIndexOf(value);
    if (own !== -1) {
      sent.splice(0, own + 1);
      return;
    }
    sent.length = 0;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (value !== current) editor.commands.setContent(value || '', { emitUpdate: false });
  }, [value, editor]);

  // The link being written: its address, and the words it is for — remembered when the field
  // opens, because moving into the field can lose the editor's selection.
  const [link, setLink] = useState<{ text: string; error: string | null; from: number; to: number; inLink: boolean } | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  openLinkRef.current = () => {
    if (!editor) return;
    const { from, to } = selectedRange(editor);
    const inLink = from === to ? editor.isActive('link') : editor.state.doc.rangeHasMark(from, to, editor.schema.marks.link!);
    setLink({ text: (editor.getAttributes('link').href as string | undefined) ?? '', error: null, from, to, inLink });
  };
  const linkOpen = link !== null;
  useEffect(() => {
    if (linkOpen) linkRef.current?.focus();
  }, [linkOpen]);

  /** Close the link field and carry on writing after the link: the cursor there, the box focused at once. */
  const backToText = (e: Editor) => {
    setLink(null);
    e.view.focus();
  };
  const removeLink = (e: Editor) => {
    if (!link) return;
    e.chain().setTextSelection({ from: link.from, to: link.to }).extendMarkRange('link').unsetLink().command(caretAfter).run();
    backToText(e);
  };
  const applyLink = (e: Editor) => {
    if (!link) return;
    if (!link.text.trim()) return removeLink(e);
    const href = linkAddress(link.text);
    if (!href) {
      setLink({ ...link, error: 'Use a web or email address, such as https://example.com or name@example.com.' });
      return;
    }
    const words = e.chain().setTextSelection({ from: link.from, to: link.to });
    if (link.from === link.to && !link.inLink) {
      // Nothing selected: the address itself becomes the linked words.
      words.insertContent({ type: 'text', text: link.text.trim(), marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      words.extendMarkRange('link').setLink({ href }).command(caretAfter).run();
    }
    backToText(e);
  };

  if (!editor) return null;
  const on = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs);
  return (
    <div
      className={`rich-editor rounded-xl border bg-surface transition-colors focus-within:ring-2 ${invalid ? 'border-danger focus-within:ring-danger/20' : 'border-line focus-within:border-brand focus-within:ring-brand/20'}`}
    >
      <div role="toolbar" aria-label={`Formatting for ${ariaLabel.toLowerCase()}`} className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        <ToolButton label="Bold" keys={`${mod}B`} active={on('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>{Icons.bold}</ToolButton>
        <ToolButton label="Italic" keys={`${mod}I`} active={on('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>{Icons.italic}</ToolButton>
        <ToolButton label="Underline" keys={`${mod}U`} active={on('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>{Icons.underline}</ToolButton>
        <ToolButton label="Highlight" active={on('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}>{Icons.highlight}</ToolButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <ToolButton label="Heading" active={on('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>{Icons.heading}</ToolButton>
        <ToolButton label="Bulleted list" keys="- " active={on('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>{Icons.bullets}</ToolButton>
        <ToolButton label="Numbered list" keys="1. " active={on('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>{Icons.numbers}</ToolButton>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <ToolButton label="Link" keys={`${mod}K`} active={on('link') || link !== null} onClick={() => (link ? setLink(null) : openLinkRef.current())}>{Icons.link}</ToolButton>
      </div>
      {link ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-ground/50 px-2 py-1.5">
          <input
            ref={linkRef}
            type="text"
            inputMode="url"
            aria-label="Link address"
            placeholder="https://… or name@example.com"
            value={link.text}
            onChange={(e) => setLink({ ...link, text: e.target.value, error: null })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink(editor);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setLink(null);
                editor.commands.focus();
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-brand"
          />
          <button type="button" onClick={() => applyLink(editor)} className="h-8 rounded-md bg-brand px-3 text-xs font-semibold text-white">Apply</button>
          {link.inLink ? (
            <button type="button" onClick={() => removeLink(editor)} className="h-8 rounded-md px-2 text-xs font-medium text-ink-2 hover:text-danger">
              Remove link
            </button>
          ) : null}
          {link.error ? <p role="alert" className="basis-full text-xs text-danger">{link.error}</p> : null}
        </div>
      ) : null}
      <EditorContent editor={editor} className="px-3 py-2 text-sm text-ink" style={{ minHeight }} />
    </div>
  );
}
