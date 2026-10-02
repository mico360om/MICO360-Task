import { describe, it, expect } from 'vitest';
import { attachmentHref, formatFileSize, canRemoveAttachment, uploadMimeType, attachmentIcon, uploadPart, uploadErrorMessage } from './attachments';

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

  it('picks an icon by type', () => {
    expect(attachmentIcon('image/png')).toBe('🖼️');
    expect(attachmentIcon('application/pdf')).toBe('📕');
    expect(attachmentIcon('text/csv')).toBe('📊');
    expect(attachmentIcon('text/plain')).toBe('📄');
  });

  it('explains refused uploads', () => {
    expect(uploadErrorMessage(new Error('File type application/x-msdownload is not allowed.'))).toMatch(/can’t be attached/);
    expect(uploadErrorMessage(new Error('Attachment quota exceeds the per-task limit'))).toMatch(/too large/);
    expect(uploadErrorMessage(new TypeError('Network request failed'))).toMatch(/connection/);
  });
});
