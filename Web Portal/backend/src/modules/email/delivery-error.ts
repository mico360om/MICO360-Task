/**
 * Email delivery failures. The email service throws these instead of silently dropping mail, so
 * callers can report real outcomes (e.g. "sent to 6 of 8") rather than claiming success.
 */

/** The provider rejected or failed to deliver a message (non-2xx response or network error). */
export class EmailDeliveryError extends Error {
  constructor(
    public readonly recipient: string,
    public readonly status?: number,
    message = 'Email could not be delivered.',
  ) {
    super(message);
    this.name = 'EmailDeliveryError';
  }
}

/** Email sending is not configured (no provider credentials), so nothing can be sent at all. */
export class EmailNotConfiguredError extends EmailDeliveryError {
  constructor(recipient: string) {
    super(recipient, undefined, 'Email sending is not configured.');
    this.name = 'EmailNotConfiguredError';
  }
}
