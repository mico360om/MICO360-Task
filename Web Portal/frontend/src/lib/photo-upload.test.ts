import { describe, it, expect } from 'vitest';
import { ApiError } from './api-client';
import { photoUploadProblem } from './photo-upload';

describe('photoUploadProblem — why a profile photo was not accepted', () => {
  it('says the picture is too large (the server answers 413 with a technical phrase)', () => {
    expect(photoUploadProblem(new ApiError(413, 'ERROR', 'request file too large'))).toBe('That picture is too large. Choose a smaller one.');
  });

  it('passes on the server’s own explanation for a file that is not a picture', () => {
    expect(photoUploadProblem(new ApiError(400, 'VALIDATION', 'Only PNG, JPEG, WebP or GIF images are allowed.'))).toBe('Only PNG, JPEG, WebP or GIF images are allowed.');
    expect(photoUploadProblem(new ApiError(400, 'VALIDATION', 'Image content does not match its declared type.'))).toBe('That file isn’t a real picture — it may be damaged or renamed. Choose a PNG, JPEG, WebP or GIF image.');
  });

  it('names what was uploaded when it is not a profile photo (a project image)', () => {
    expect(photoUploadProblem(new ApiError(413, 'ERROR', 'request file too large'), 'image')).toBe('That image is too large. Choose a smaller one.');
    expect(photoUploadProblem(new ApiError(500, 'INTERNAL', 'boom'), 'image')).toBe('Couldn’t upload the image. Please try again.');
    expect(photoUploadProblem(new TypeError('Failed to fetch'), 'image')).toBe('Couldn’t upload the image. Check your connection and try again.');
  });

  it('asks to try again when the server or the connection failed', () => {
    expect(photoUploadProblem(new ApiError(500, 'INTERNAL', 'boom'))).toBe('Couldn’t upload the photo. Please try again.');
    expect(photoUploadProblem(new TypeError('Failed to fetch'))).toBe('Couldn’t upload the photo. Check your connection and try again.');
  });
});
