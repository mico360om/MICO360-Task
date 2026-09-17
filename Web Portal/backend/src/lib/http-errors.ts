/** Base class for errors that map cleanly to an HTTP response. */
export class HttpError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict.', code = 'CONFLICT') {
    super(message, code, 409);
  }
}

export class ValidationError extends HttpError {
  constructor(message = 'Invalid input.', details?: unknown) {
    super(message, 'VALIDATION', 400, details);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 'FORBIDDEN', 403);
  }
}
