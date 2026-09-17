import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiSummaryCard } from './AiSummaryCard';

describe('AiSummaryCard', () => {
  it('generates and shows an AI summary on demand', async () => {
    const onSummarize = vi.fn().mockResolvedValue('The project is 40% complete with two overdue tasks.');
    render(<AiSummaryCard onSummarize={onSummarize} />);
    await userEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    expect(onSummarize).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/40% complete with two overdue tasks/)).toBeInTheDocument();
    // once a summary exists the action becomes a regenerate
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
  });

  it('shows a friendly error when the AI is unavailable', async () => {
    const onSummarize = vi.fn().mockRejectedValue(new Error('AI is not configured yet'));
    render(<AiSummaryCard onSummarize={onSummarize} />);
    await userEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    expect(await screen.findByText(/AI is not configured yet/)).toBeInTheDocument();
  });
});
