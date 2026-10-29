/** The hourglass of a task waiting for approval. */
export function WaitingIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12M6 21h12M7 3v3a5 5 0 0 0 10 0V3M7 21v-3a5 5 0 0 1 10 0v3" />
    </svg>
  );
}

/**
 * "Waiting for approval": the task is finished, but the person who runs its project hasn't approved
 * it yet, so it doesn't count as done. Shown wherever the task appears (card, list row, panel).
 */
export function ApprovalChip({ size = 'xs', className = '' }: { size?: 'xs' | 'sm'; className?: string }) {
  return (
    <span
      data-testid="approval-chip"
      title="Finished, waiting for a project manager to approve it"
      className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-md bg-warning-soft font-semibold text-warning ${size === 'xs' ? 'px-1 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-xs'} ${className}`}
    >
      <WaitingIcon size={size === 'xs' ? 11 : 12} />
      Waiting for approval
    </span>
  );
}
