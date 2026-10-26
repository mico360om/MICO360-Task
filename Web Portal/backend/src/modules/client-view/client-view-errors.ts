import { HttpError } from '../../lib/http-errors';

/**
 * The client page's refusals. Each says one plain thing and never whether an address is on the
 * list: a wrong address, a wrong, expired or used-up code all read exactly the same.
 */

/** The link is unknown, replaced by a newer one, removed, or its project is archived or deleted. */
export class ClientLinkEndedError extends HttpError {
  constructor() {
    super('This link no longer works. If you still need access, ask the person who shared the project with you to send a new one.', 'CLIENT_LINK_ENDED', 404);
  }
}

/** The link is fine, but this device isn't signed in to it (no session, or it expired). */
export class ClientSignInRequiredError extends HttpError {
  constructor() {
    super('Enter the code we email you to open this page.', 'CLIENT_SIGN_IN', 401);
  }
}

export class ClientCodeInvalidError extends HttpError {
  constructor() {
    super(
      'That code didn’t work. Use the email address this page was shared with and the newest code we sent: codes last 10 minutes and allow 5 tries. You can ask for a new code.',
      'CLIENT_CODE_INVALID',
      401,
    );
  }
}

export class ClientEmailUnavailableError extends HttpError {
  constructor(message = 'Codes can’t be emailed right now. Please try again later.') {
    super(message, 'EMAIL_NOT_CONFIGURED', 503);
  }
}
