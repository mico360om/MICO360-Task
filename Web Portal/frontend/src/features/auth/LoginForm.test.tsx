import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';

describe('LoginForm', () => {
  it('submits the identifier and password', async () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada');
    await userEvent.type(screen.getByLabelText(/password/i), 'CorrectHorse1');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(onSubmit).toHaveBeenCalledWith('ada', 'CorrectHorse1', true);
  });

  it('passes "Keep me signed in" = false when the box is unticked', async () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada');
    await userEvent.type(screen.getByLabelText(/password/i), 'CorrectHorse1');
    await userEvent.click(screen.getByRole('checkbox', { name: /keep me signed in/i }));
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(onSubmit).toHaveBeenCalledWith('ada', 'CorrectHorse1', false);
  });

  it('renders an error message when provided', () => {
    render(<LoginForm onSubmit={vi.fn()} error="Invalid email/username or password." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/invalid/i);
  });

  it('disables the submit button while loading', () => {
    render(<LoginForm onSubmit={vi.fn()} loading />);
    expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
  });

  it('requests an email code in email-code mode', async () => {
    const onRequestCode = vi.fn();
    render(<LoginForm onSubmit={vi.fn()} onRequestCode={onRequestCode} onVerifyCode={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /email code/i }));
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    expect(onRequestCode).toHaveBeenCalledWith('ada@example.com');
  });

  it('verifies the code once it has been sent', async () => {
    const onVerifyCode = vi.fn();
    const form = (codeSent: boolean) => <LoginForm onSubmit={vi.fn()} onRequestCode={vi.fn()} onVerifyCode={onVerifyCode} codeSent={codeSent} />;
    const view = render(form(false));
    await userEvent.click(screen.getByRole('tab', { name: /email code/i }));
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    view.rerender(form(true));
    await userEvent.type(screen.getByLabelText(/one-time code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(onVerifyCode).toHaveBeenCalledWith('ada@example.com', '123456', true);
  });

  describe('the code step', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function toCodeStep(props: Partial<React.ComponentProps<typeof LoginForm>> = {}) {
      const onRequestCode = vi.fn();
      const form = (codeSent: boolean) => <LoginForm onSubmit={vi.fn()} onRequestCode={onRequestCode} onVerifyCode={vi.fn()} codeSent={codeSent} {...props} />;
      const view = render(form(false));
      await userEvent.click(screen.getByRole('tab', { name: /email code/i }));
      await userEvent.type(screen.getByLabelText(/email or username/i), 'ada@example.com');
      await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
      view.rerender(form(true));
      return { onRequestCode, view, form };
    }

    it('moves the cursor to the code box when the code has been sent', async () => {
      await toCodeStep();
      expect(screen.getByLabelText(/one-time code/i)).toHaveFocus();
    });

    it('keeps the address the code was sent to (it cannot be edited under a sent code)', async () => {
      await toCodeStep();
      const address = screen.getByLabelText(/email or username/i);
      expect(address).toHaveAttribute('readonly');
      expect(address).toHaveValue('ada@example.com');
      expect(screen.getByRole('button', { name: /use a different email/i })).toBeInTheDocument();
    });

    it('"Use a different email" goes back to asking for a code', async () => {
      const onModeChange = vi.fn();
      await toCodeStep({ onModeChange });
      await userEvent.click(screen.getByRole('button', { name: /use a different email/i }));
      expect(onModeChange).toHaveBeenCalled();
    });

    it('offers "Resend code" after a minute, as the server allows, counting down until then', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { onRequestCode } = await toCodeStep();
      const resend = () => screen.getByRole('button', { name: /resend code/i });
      expect(resend()).toBeDisabled();
      expect(resend()).toHaveTextContent('Resend code in 1:00');
      act(() => { vi.advanceTimersByTime(18_000); });
      expect(resend()).toHaveTextContent('Resend code in 0:42');
      act(() => { vi.advanceTimersByTime(42_000); });
      expect(resend()).toBeEnabled();
      expect(resend()).toHaveTextContent(/^Resend code$/);
      fireEvent.click(resend());
      expect(onRequestCode).toHaveBeenLastCalledWith('ada@example.com');
      expect(resend()).toBeDisabled();
      expect(resend()).toHaveTextContent('Resend code in 1:00');
    });

    it('spaces out the digits typed, not the placeholder (it would read "6 - d i g i t")', async () => {
      await toCodeStep();
      expect(screen.getByLabelText(/one-time code/i)).toHaveClass('tracking-[0.4em]', 'placeholder:tracking-normal');
    });

    it('marks the code box when the server refuses the code, and selects it for retyping', async () => {
      const { view } = await toCodeStep();
      await userEvent.type(screen.getByLabelText(/one-time code/i), '000000');
      const props = { error: 'Invalid or unknown code.', errorCode: 'INVALID_OTP' };
      view.rerender(<LoginForm onSubmit={vi.fn()} onRequestCode={vi.fn()} onVerifyCode={vi.fn()} codeSent {...props} />);
      const box = screen.getByLabelText(/one-time code/i) as HTMLInputElement;
      expect(box).toHaveAttribute('aria-invalid', 'true');
      expect(box).toHaveAccessibleDescription('Invalid or unknown code.');
      expect(box).toHaveFocus();
      expect([box.selectionStart, box.selectionEnd]).toEqual([0, 6]);
    });

    it('takes a code of up to 10 digits, ignoring spaces and dashes', async () => {
      await toCodeStep();
      await userEvent.type(screen.getByLabelText(/one-time code/i), '123-456 7890123');
      expect(screen.getByLabelText(/one-time code/i)).toHaveValue('1234567890');
    });
  });

  it('shows a distinct locked-account callout for ACCOUNT_LOCKED', () => {
    render(
      <LoginForm
        onSubmit={vi.fn()}
        error="Account locked after too many failed attempts. Reset your password to unlock."
        errorCode="ACCOUNT_LOCKED"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/locked/i);
    expect(alert).toHaveTextContent(/reset your password/i);
  });

  it('tells a locked-out user when they can try again', () => {
    render(<LoginForm onSubmit={vi.fn()} error="Account locked." errorCode="ACCOUNT_LOCKED" lockedForSeconds={600} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts. Try again in 10 minutes.');
  });

  it('hides the email-code option when email sign-in is unavailable', () => {
    render(<LoginForm onSubmit={vi.fn()} />);
    expect(screen.queryByRole('tab', { name: /email code/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/one-time email code/i)).not.toBeInTheDocument();
  });
});
