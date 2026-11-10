import type { ZodError } from 'zod';

/**
 * The API's answer to a request whose body, query or address doesn't pass its checks (400).
 * The website, the Android app and the Chrome extension all read this shape:
 *   { error: { code: 'VALIDATION', message: 'Invalid input.', details: { formErrors, fieldErrors } } }
 * `fieldErrors` is keyed by the top-level field (the first part of the problem's path); problems
 * with the whole body go in `formErrors`. Each entry is the problem's words.
 */
export interface ValidationDetails {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
}

/** Every problem in a failed check, grouped as `details` carries them. */
export function validationDetails(err: ZodError): ValidationDetails {
  return err.flatten() as ValidationDetails;
}

/** The whole 400 body for a failed check. */
export function validationErrorBody(err: ZodError): { error: { code: 'VALIDATION'; message: string; details: ValidationDetails } } {
  return { error: { code: 'VALIDATION', message: 'Invalid input.', details: validationDetails(err) } };
}
