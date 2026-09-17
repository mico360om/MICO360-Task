import '@testing-library/jest-dom/vitest';

// jsdom has no 2D canvas: calling getContext throws AND logs a "Not implemented"
// line to the virtual console. Our decorative <HeroField> canvas already degrades
// gracefully to null, so stub getContext to return null — this keeps test output
// pristine (jsdom's internal logger never runs) without pulling in the canvas pkg.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
