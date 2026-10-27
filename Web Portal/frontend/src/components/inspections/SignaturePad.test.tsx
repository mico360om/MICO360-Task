import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignaturePad, type SignatureValue } from './SignaturePad';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

// jsdom has no PointerEvent: a MouseEvent with the pointer's id and type stands in.
if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent = TestPointerEvent;
}

/** A 2D context that records what is drawn (jsdom has no canvas). */
function fakeContext() {
  const calls: string[] = [];
  const ctx = {
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '',
    fillStyle: '',
    setTransform: vi.fn(),
    beginPath: () => void calls.push('beginPath'),
    moveTo: () => void calls.push('moveTo'),
    quadraticCurveTo: () => void calls.push('quad'),
    stroke: () => void calls.push('stroke'),
    arc: () => void calls.push('arc'),
    fill: () => void calls.push('fill'),
    fillRect: () => void calls.push('fillRect'),
    clearRect: () => void calls.push('clearRect'),
  };
  return { ctx, calls };
}

let drawn: ReturnType<typeof fakeContext>;
let capture: ReturnType<typeof vi.fn>;
const original = {
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
  rect: HTMLCanvasElement.prototype.getBoundingClientRect,
  setPointerCapture: HTMLCanvasElement.prototype.setPointerCapture,
};

beforeEach(() => {
  drawn = fakeContext();
  capture = vi.fn();
  HTMLCanvasElement.prototype.getContext = (() => drawn.ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = () => PNG;
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  HTMLCanvasElement.prototype.setPointerCapture = capture as unknown as typeof HTMLCanvasElement.prototype.setPointerCapture;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = original.getContext;
  HTMLCanvasElement.prototype.toDataURL = original.toDataURL;
  HTMLCanvasElement.prototype.getBoundingClientRect = original.rect;
  HTMLCanvasElement.prototype.setPointerCapture = original.setPointerCapture;
});

function Harness(props: { onChange: (v: SignatureValue | null) => void; disabled?: boolean; required?: boolean; error?: string | null; reset?: boolean }) {
  const [value, setValue] = useState<SignatureValue | null>(null);
  return (
    <>
      <SignaturePad
        label="Inspector signature"
        defaultName="Ivan Inspector"
        required={props.required}
        disabled={props.disabled}
        error={props.error}
        value={value}
        onChange={(v) => {
          props.onChange(v);
          setValue(v);
        }}
      />
      <button type="button" onClick={() => setValue(null)}>
        Reset from outside
      </button>
    </>
  );
}

const pad = () => screen.getByRole('img', { name: 'Inspector signature: drawing area' });
const down = (id: number, x: number, y: number, pointerType = 'mouse') => fireEvent.pointerDown(pad(), { pointerId: id, clientX: x, clientY: y, pointerType, isPrimary: id === 1, button: 0, buttons: 1 });
const move = (id: number, x: number, y: number, pointerType = 'mouse') => fireEvent.pointerMove(pad(), { pointerId: id, clientX: x, clientY: y, pointerType, buttons: 1 });
const up = (id: number, x: number, y: number, pointerType = 'mouse') => fireEvent.pointerUp(pad(), { pointerId: id, clientX: x, clientY: y, pointerType });
function stroke(id = 1, pointerType = 'mouse', from = 20) {
  down(id, from, 40, pointerType);
  move(id, from + 40, 60, pointerType);
  move(id, from + 80, 50, pointerType);
  up(id, from + 80, 50, pointerType);
}
const status = () => screen.getByRole('status');

describe('SignaturePad', () => {
  it('has a labelled drawing area with a hint, and a required, labelled name field filled in', () => {
    render(<Harness onChange={() => {}} required />);
    expect(screen.getByText('Inspector signature')).toBeInTheDocument();
    expect(pad()).toHaveAccessibleDescription('Draw with your finger or mouse. Or type your name instead.');
    const name = screen.getByRole('textbox', { name: /Signer’s name/ });
    expect(name).toBeRequired();
    expect(name).toHaveValue('Ivan Inspector');
    // The page doesn't scroll under a finger that is signing (touch-action: none).
    expect(pad()).toHaveClass('touch-none');
  });

  it('a stroke with a mouse gives a drawn signature: the name and a PNG', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    stroke(1, 'mouse');
    expect(capture).toHaveBeenCalledWith(1);
    expect(onChange).toHaveBeenLastCalledWith({ method: 'DRAWN', name: 'Ivan Inspector', image: PNG });
    expect(drawn.calls).toContain('quad');
    expect(status()).toHaveTextContent('Signature drawn');
  });

  it('a finger (touch) draws too', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    stroke(7, 'touch');
    expect(onChange).toHaveBeenLastCalledWith({ method: 'DRAWN', name: 'Ivan Inspector', image: PNG });
  });

  it('a tap leaves a dot', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    down(1, 100, 100, 'pen');
    up(1, 100, 100, 'pen');
    expect(drawn.calls).toContain('arc');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'DRAWN' }));
  });

  it('ignores a second finger while the first is drawing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    down(1, 20, 40, 'touch');
    down(2, 200, 100, 'touch');
    move(2, 250, 120, 'touch');
    up(2, 250, 120, 'touch');
    expect(onChange).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    move(1, 80, 60, 'touch');
    up(1, 80, 60, 'touch');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps what was drawn when the browser cancels the pointer', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    down(1, 20, 40, 'touch');
    move(1, 90, 60, 'touch');
    fireEvent.pointerCancel(pad(), { pointerId: 1, pointerType: 'touch' });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'DRAWN', image: PNG }));
  });

  it('Clear empties it and says so', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    stroke();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(status()).toHaveTextContent('Signature cleared');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('Undo last stroke takes strokes off one at a time, and is empty after the last', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    stroke(1, 'mouse', 20);
    stroke(1, 'mouse', 150);
    await user.click(screen.getByRole('button', { name: 'Undo last stroke' }));
    expect(onChange).toHaveBeenLastCalledWith({ method: 'DRAWN', name: 'Ivan Inspector', image: PNG });
    expect(status()).toHaveTextContent('Last stroke undone');
    await user.click(screen.getByRole('button', { name: 'Undo last stroke' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(status()).toHaveTextContent('Signature cleared');
    expect(screen.getByRole('button', { name: 'Undo last stroke' })).toBeDisabled();
  });

  it('can be signed by keyboard: type the name instead (Space on the tick box)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const typed = screen.getByRole('checkbox', { name: 'Type my name instead' });
    typed.focus();
    await user.keyboard(' ');
    expect(typed).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith({ method: 'TYPED', name: 'Ivan Inspector', image: null });
    expect(screen.getByRole('img', { name: 'Inspector signature: typed name, Ivan Inspector' })).toBeInTheDocument();
    expect(status()).toHaveTextContent('Signing with the typed name');
    // A new name is the new signature.
    const name = screen.getByRole('textbox', { name: /Signer’s name/ });
    await user.clear(name);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.type(name, 'سارة الهنائي');
    expect(onChange).toHaveBeenLastCalledWith({ method: 'TYPED', name: 'سارة الهنائي', image: null });
  });

  it('switching back to drawing brings the drawing back', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    stroke();
    const typed = screen.getByRole('checkbox', { name: 'Type my name instead' });
    await user.click(typed);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'TYPED' }));
    await user.click(typed);
    expect(onChange).toHaveBeenLastCalledWith({ method: 'DRAWN', name: 'Ivan Inspector', image: PNG });
  });

  it('a changed name goes with the drawing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    stroke();
    const name = screen.getByRole('textbox', { name: /Signer’s name/ });
    await user.clear(name);
    await user.type(name, 'Fatma');
    expect(onChange).toHaveBeenLastCalledWith({ method: 'DRAWN', name: 'Fatma', image: PNG });
  });

  it('takes nothing while disabled', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} disabled />);
    stroke();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Signer’s name/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Type my name instead' })).toBeDisabled();
  });

  it('is emptied when the page clears its value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    stroke();
    await user.click(screen.getByRole('button', { name: 'Reset from outside' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('shows an error, tied to the drawing area', () => {
    render(<Harness onChange={() => {}} error="Sign here, or tick “Type my name instead”." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign here');
    expect(pad()).toHaveAccessibleDescription(/Sign here/);
  });

  it('redraws the strokes when the pad changes size (a phone turned on its side)', () => {
    render(<Harness onChange={() => {}} />);
    stroke();
    const before = drawn.calls.filter((c) => c === 'stroke').length;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(drawn.calls.filter((c) => c === 'stroke').length).toBeGreaterThan(before);
  });
});
