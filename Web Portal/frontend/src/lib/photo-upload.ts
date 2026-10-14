import { ApiError } from './api-client';

/**
 * Why a picture was not accepted, in words for the person who chose it. `what` names it the way the
 * page does: "the photo" of a profile (the default) or "the image" of a project.
 */
export function photoUploadProblem(error: unknown, what: 'photo' | 'image' = 'photo'): string {
  const noun = what === 'photo' ? 'picture' : 'image';
  if (error instanceof ApiError) {
    if (error.status === 413) return `That ${noun} is too large. Choose a smaller one.`;
    if (error.status === 400 && /does not match/i.test(error.message)) {
      return 'That file isn’t a real picture — it may be damaged or renamed. Choose a PNG, JPEG, WebP or GIF image.';
    }
    if (error.status >= 400 && error.status < 500 && error.message && !/^Request failed/.test(error.message)) return error.message;
    return `Couldn’t upload the ${what}. Please try again.`;
  }
  return `Couldn’t upload the ${what}. Check your connection and try again.`;
}
