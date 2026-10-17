import '@testing-library/jest-dom/vitest';

// jsdom has no 2D canvas: calling getContext throws AND logs a "Not implemented"
// line to the virtual console. Our decorative <HeroField> canvas already degrades
// gracefully to null, so stub getContext to return null — this keeps test output
// pristine (jsdom's internal logger never runs) without pulling in the canvas pkg.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;


// jsdom does no layout, so the rich-text editor (ProseMirror) finds no element at a point and no
// boxes for a range. Stand-ins: no element there, and empty boxes.
if (!document.elementFromPoint) document.elementFromPoint = () => null;
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
