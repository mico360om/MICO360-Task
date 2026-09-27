import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    render(<LoginForm onSubmit={vi.fn()} onRequestCode={vi.fn()} onVerifyCode={onVerifyCode} codeSent />);
    await userEvent.click(screen.getByRole('button', { name: /email code/i }));
    await userEvent.type(screen.getByLabelText(/email or username/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/one-time code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    expect(onVerifyCode).toHaveBeenCalledWith('ada@example.com', '123456', true);
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
