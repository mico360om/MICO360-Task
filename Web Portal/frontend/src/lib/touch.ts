/**
 * Touch screens (a coarse pointer): a control is at least 44px tall, as Apple and WCAG 2.5.5 ask, so
 * it can be hit with a gloved finger. With a mouse the dense layout stays.
 *
 * `!` because index.css gives every button `min-height: 2rem` on a coarse pointer with the selector
 * `button:not([role='switch'])` (specificity 0,1,1), which outranks a plain utility class (0,1,0): a
 * button's own `min-h-11` would otherwise lose and stay 32px.
 */
export const TOUCH_TALL = '[@media(pointer:coarse)]:!min-h-11';

/** The same for a small square icon button: 44 × 44 on a touch screen. */
export const TOUCH_SQUARE = '[@media(pointer:coarse)]:!min-h-11 [@media(pointer:coarse)]:!min-w-11';
