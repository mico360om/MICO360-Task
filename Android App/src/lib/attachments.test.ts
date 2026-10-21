import { describe, it, expect } from 'vitest';
import { attachmentHref, formatFileSize, canRemoveAttachment, uploadMimeType, attachmentIcon, uploadPart, uploadErrorMessage } from './attachments';
import { ApiError, NetworkError } from './api-client';

describe('attachments', () => {
  it('builds the address to open a file from the API base', () => {
    expect(attachmentHref('https://task.mico360.com/api/v1', '/uploads/a1b2.pdf')).toBe('https://task.mico360.com/uploads/a1b2.pdf');
    expect(attachmentHref('http://192.168.1.20:4000/api/v1/', '/uploads/x.png')).toBe('http://192.168.1.20:4000/uploads/x.png');
    expect(attachmentHref('http://10.0.2.2:4000/api/v1', 'uploads/x.png')).toBe('http://10.0.2.2:4000/uploads/x.png');
    expect(attachmentHref('https://task.mico360.com/api/v1', 'https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png');
  });

  it('formats sizes', () => {
    expect(formatFileSize(532)).toBe('532 B');
    expect(formatFileSize(12_700)).toBe('12.4 KB');
    expect(formatFileSize(3_250_000)).toBe('3.1 MB');
    expect(formatFileSize(-1)).toBe('');
  });

  it('lets the uploader or an administrator remove a file', () => {
    expect(canRemoveAttachment({ uploadedById: 'u1' }, 'u1', ['EMPLOYEE'])).toBe(true);
    expect(canRemoveAttachment({ uploadedById: 'u1' }, 'u2', ['EMPLOYEE'])).toBe(false);
    expect(canRemoveAttachment({ uploadedById: 'u1' }, 'u2', ['ADMIN'])).toBe(true);
    expect(canRemoveAttachment({ uploadedById: 'u1' }, null, ['ADMIN'])).toBe(false);
  });

  it('declares a sensible type for picked files', () => {
    expect(uploadMimeType('Scan.PDF', null)).toBe('application/pdf');
    expect(uploadMimeType('photo.jpg', 'application/octet-stream')).toBe('image/jpeg');
    expect(uploadMimeType('report.bin', undefined)).toBe('application/octet-stream');
    expect(uploadMimeType('notes.txt', 'Text/Plain')).toBe('text/plain');
    expect(uploadPart({ uri: 'file:///x/تقرير.pdf', name: 'تقرير.pdf', mimeType: null })).toEqual({ uri: 'file:///x/تقرير.pdf', name: 'تقرير.pdf', type: 'application/pdf' });
  });

  it('declares the standard type when Android names a CSV, ZIP or JPEG by another one the server refuses (3b review fix 11)', () => {
    expect(uploadMimeType('data.csv', 'text/comma-separated-values')).toBe('text/csv');
    expect(uploadMimeType('data.csv', 'text/x-csv')).toBe('text/csv');
    expect(uploadMimeType('data.csv', 'application/csv')).toBe('text/csv');
    expect(uploadMimeType('files.zip', 'application/x-zip-compressed')).toBe('application/zip');
    expect(uploadMimeType('files.zip', 'application/x-zip')).toBe('application/zip');
    expect(uploadMimeType('photo.jpg', 'image/jpg')).toBe('image/jpeg');
    // An alias on a file whose name says something else is left as it is (the server decides).
    expect(uploadMimeType('data.bin', 'text/comma-separated-values')).toBe('text/comma-separated-values');
  });

  it('picks an icon by type', () => {
    expect(attachmentIcon('image/png')).toBe('🖼️');
    expect(attachmentIcon('application/pdf')).toBe('📕');
    expect(attachmentIcon('text/csv')).toBe('📊');
    expect(attachmentIcon('text/plain')).toBe('📄');
  });

  it('no longer labels the old Office formats the server refuses (.doc, .xls, .ppt)', () => {
    expect(uploadMimeType('Letter.doc', null)).toBe('application/octet-stream');
    expect(uploadMimeType('Budget.xls', 'application/octet-stream')).toBe('application/octet-stream');
    expect(uploadMimeType('Deck.ppt', undefined)).toBe('application/octet-stream');
    // Their modern formats are still labelled.
    expect(uploadMimeType('Letter.docx', null)).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(uploadMimeType('Budget.xlsx', null)).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(uploadMimeType('Deck.pptx', null)).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('shows the server’s own reason for a refused file (it is already plain)', () => {
    // Today's wording (lib/upload-safety.ts, attachment-service.ts), none of which the old patterns matched.
    const refusals = [
      '“.exe” files can’t be attached. Try a document, image, PDF or zip instead.',
      '“photo.jpg” isn’t really a .jpg file — it may be damaged or renamed.',
      'This task has reached its attachment storage limit.',
      'File is empty.',
      'That file is too large — the limit is 10 MB.',
      'You do not have access to this task.',
    ];
    for (const message of refusals) {
      expect(uploadErrorMessage(new ApiError(message.startsWith('You') ? 403 : 400, 'VALIDATION', message))).toBe(message);
    }
  });

  it('says a file is too large when the upload limit stopped it before the server could explain', () => {
    // The multipart limit (and a proxy in front of the server) answer 413 without our wording.
    expect(uploadErrorMessage(new ApiError(413, 'REQUEST_ERROR', 'request file too large'))).toBe('That file is too large to attach.');
    expect(uploadErrorMessage(new ApiError(413, 'ERROR', 'Request failed (413)'))).toBe('That file is too large to attach.');
  });

  it('blames the connection only when there was no answer from the server', () => {
    expect(uploadErrorMessage(new NetworkError('Network request failed.'))).toBe('You’re offline — files can be attached when you’re connected.');
    expect(uploadErrorMessage(new NetworkError('The server took too long to respond.', { timedOut: true }))).toBe(
      'The upload took too long. Check your connection and try again.',
    );
    // A server error, or a refusal with no reason of its own, is not a connection problem.
    expect(uploadErrorMessage(new ApiError(500, 'INTERNAL', 'Something went wrong.'))).toBe('The server couldn’t save the file. Please try again in a moment.');
    expect(uploadErrorMessage(new ApiError(400, 'ERROR', 'Request failed (400)'))).toBe('The server couldn’t accept this file.');
    expect(uploadErrorMessage(new TypeError('Something broke'))).toBe('Couldn’t attach the file. Please try again.');
  });
});
