import { describe, it, expect } from 'vitest';
import { fieldScrollDelta } from './field-scroll';

// Spans are in the same coordinates as `visible` (px from the top of the scroll area or window).
// A positive answer scrolls the content up (the view moves down); 0 means leave it where it is.
const visible = { top: 0, bottom: 300 };

describe('fieldScrollDelta — keeping the field being typed in above the on-screen keyboard', () => {
  it('leaves a field alone when it already sits inside the visible area with room around it', () => {
    expect(fieldScrollDelta({ visible, field: { top: 100, bottom: 140 } })).toBe(0);
  });

  it('brings a field hidden under the keyboard up, with room below it — not flush against the keyboard', () => {
    expect(fieldScrollDelta({ visible, field: { top: 400, bottom: 440 }, margin: 16 })).toBe(156);
  });

  it('moves a field that only just touches the keyboard so it gets its breathing room', () => {
    expect(fieldScrollDelta({ visible, field: { top: 250, bottom: 298 }, margin: 16 })).toBe(14);
  });

  it('brings a field above the visible area down, with room above it', () => {
    expect(fieldScrollDelta({ visible: { top: 200, bottom: 500 }, field: { top: 120, bottom: 160 }, margin: 16 })).toBe(-96);
  });

  it('shows the form’s buttons with the field when both fit', () => {
    // Field 380–420, buttons 460–500: both fit in 300 px, so scroll until the buttons clear the bottom.
    expect(fieldScrollDelta({ visible, field: { top: 380, bottom: 420 }, actions: { top: 460, bottom: 500 }, margin: 16 })).toBe(216);
  });

  it('also scrolls when the field is visible but its buttons are hidden under the keyboard', () => {
    expect(fieldScrollDelta({ visible, field: { top: 150, bottom: 190 }, actions: { top: 330, bottom: 370 }, margin: 16 })).toBe(86);
  });

  it('gives up some of the room around them before leaving the buttons out', () => {
    // Field 300–340, buttons 400–476: 176 px, plus 2 × 16 px room = 208 > 200 — but with 4 px
    // room it fits (184), so the buttons still come along.
    expect(fieldScrollDelta({ visible: { top: 0, bottom: 200 }, field: { top: 300, bottom: 340 }, actions: { top: 400, bottom: 476 }, margin: 16 })).toBe(280);
  });

  it('keeps just the field in view when it and the buttons can’t both fit', () => {
    // Field at the top of a long form, buttons far below: showing the buttons would hide the field.
    expect(fieldScrollDelta({ visible, field: { top: 20, bottom: 60 }, actions: { top: 900, bottom: 940 }, margin: 16 })).toBe(0);
    expect(fieldScrollDelta({ visible, field: { top: 400, bottom: 440 }, actions: { top: 900, bottom: 940 }, margin: 16 })).toBe(156);
  });

  it('works with buttons above the field (a toolbar), too', () => {
    expect(fieldScrollDelta({ visible: { top: 100, bottom: 400 }, field: { top: 200, bottom: 240 }, actions: { top: 60, bottom: 90 }, margin: 16 })).toBe(-56);
  });

  it('gives up some of the room around a field before cutting it off', () => {
    // 57 px box in 84 px: with 16 px room it would not fit (89), with 4 px it does (65).
    expect(fieldScrollDelta({ visible: { top: 0, bottom: 84 }, field: { top: 33, bottom: 90 }, margin: 16 })).toBe(10);
  });

  it('shows as much of a field taller than the visible area as it can, starting from its label', () => {
    // A 500 px text box in a 300 px area: its top comes to the top of the area, never past it.
    expect(fieldScrollDelta({ visible, field: { top: 120, bottom: 620 }, margin: 16 })).toBe(104);
    // Its top is already at the top of the area: nothing to gain by moving.
    expect(fieldScrollDelta({ visible, field: { top: 16, bottom: 516 }, margin: 16 })).toBe(0);
    // Scrolled past its top: bring the top back.
    expect(fieldScrollDelta({ visible, field: { top: -80, bottom: 420 }, margin: 16 })).toBe(-96);
  });

  it('does nothing when there is no room at all (keyboard covering everything)', () => {
    expect(fieldScrollDelta({ visible: { top: 100, bottom: 100 }, field: { top: 400, bottom: 440 } })).toBe(0);
  });

  it('rounds to whole pixels', () => {
    expect(Number.isInteger(fieldScrollDelta({ visible: { top: 0.4, bottom: 300.6 }, field: { top: 400.3, bottom: 440.7 }, margin: 12 }))).toBe(true);
  });
});
