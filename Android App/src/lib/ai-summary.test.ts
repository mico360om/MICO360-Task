import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { aiSummaryQuery, runAiSummary, summaryButton } from './ai-summary';

describe('the project’s AI status summary (5b review #7)', () => {
  it('a double tap asks once; the answer is kept for the project when you switch tabs and come back', async () => {
    const qc = new QueryClient();
    let answer!: (text: string) => void;
    const ask = vi.fn(() => new Promise<string>((r) => (answer = r)));
    const first = new QueryObserver(qc, aiSummaryQuery('p1', ask));
    const off = first.subscribe(() => {});
    const a = runAiSummary(first);
    const b = runAiSummary(first);
    expect(ask).toHaveBeenCalledTimes(1);
    off(); // the tab is switched while the AI thinks
    answer('On track.');
    await Promise.all([a, b]);
    const again = new QueryObserver(qc, aiSummaryQuery('p1', ask));
    expect(again.getCurrentResult().data).toBe('On track.');
    expect(new QueryObserver(qc, aiSummaryQuery('p2', ask)).getCurrentResult().data).toBeUndefined();
    qc.clear();
  });

  it('can’t be asked before the project’s tasks have loaded (it would sum up zeros)', () => {
    expect(summaryButton({ ready: false, busy: false, hasSummary: false })).toEqual({ title: 'Generate summary', disabled: true, hint: 'Waiting for the project’s tasks…' });
    expect(summaryButton({ ready: true, busy: false, hasSummary: false })).toEqual({ title: 'Generate summary', disabled: false, hint: null });
    expect(summaryButton({ ready: true, busy: true, hasSummary: false })).toEqual({ title: 'Thinking…', disabled: true, hint: null });
    expect(summaryButton({ ready: true, busy: false, hasSummary: true })).toEqual({ title: 'Regenerate', disabled: false, hint: null });
  });
});
