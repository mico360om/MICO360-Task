import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOutboxTransport, chooseTransport } from './outbox-transport';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mico360-outbox-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('outbox transport (local test mailbox)', () => {
  it('saves each email as an HTML file and a plain-text file, and reports it as sent', async () => {
    const outbox = createOutboxTransport({ dir: join(dir, 'outbox'), now: () => new Date('2026-10-10T08:30:05.123Z') });
    expect(outbox.configured).toBe(true);
    const res = await outbox.send({ to: 'Ada@Example.com', subject: 'Your MICO360 Tasks login code', html: '<p>Code 123456</p>', text: 'Your code is 123456' });
    expect(res.ok).toBe(true);
    expect(res.messageId).toMatch(/^outbox-/);
    const files = readdirSync(join(dir, 'outbox')).sort();
    expect(files).toEqual(['20261010-083005123-ada-example.com.html', '20261010-083005123-ada-example.com.txt']);
    const txt = readFileSync(join(dir, 'outbox', files[1]!), 'utf8');
    expect(txt).toContain('To: Ada@Example.com');
    expect(txt).toContain('Subject: Your MICO360 Tasks login code');
    expect(txt).toContain('Your code is 123456');
    expect(readFileSync(join(dir, 'outbox', files[0]!), 'utf8')).toContain('<p>Code 123456</p>');
  });

  it('keeps two emails sent in the same millisecond apart', async () => {
    const outbox = createOutboxTransport({ dir, now: () => new Date('2026-10-10T08:30:05.123Z') });
    await outbox.send({ to: 'a@b.co', subject: 'One', html: '1' });
    await outbox.send({ to: 'a@b.co', subject: 'Two', html: '2' });
    expect(readdirSync(dir).filter((f) => f.endsWith('.html'))).toHaveLength(2);
  });

  it('lists attachments by name, and keeps calendar files to open (not PDFs)', async () => {
    const outbox = createOutboxTransport({ dir, now: () => new Date('2026-10-10T08:30:05.123Z') });
    await outbox.send({
      to: 'a@b.co',
      subject: 'Invite',
      html: 'x',
      attachments: [
        { filename: 'invite.ics', contentType: 'text/calendar; method=REQUEST', content: Buffer.from('BEGIN:VCALENDAR') },
        { filename: 'minutes.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF') },
      ],
    });
    const txt = readdirSync(dir).find((f) => f.endsWith('.txt'))!;
    expect(readFileSync(join(dir, txt), 'utf8')).toContain('Attachments: invite.ics (text/calendar; method=REQUEST, 15 bytes), minutes.pdf (application/pdf, 4 bytes)');
    expect(readFileSync(join(dir, '20261010-083005123-a-b.co.invite.ics'), 'utf8')).toBe('BEGIN:VCALENDAR');
    expect(readdirSync(dir).some((f) => f.endsWith('.pdf'))).toBe(false);
  });

  it('writes an email to several people with its real To and Cc lines (names beside the addresses)', async () => {
    const outbox = createOutboxTransport({ dir, now: () => new Date('2026-10-10T08:30:05.123Z') });
    const res = await outbox.send({
      to: 'ada@x.co',
      toAll: [{ email: 'ada@x.co', name: 'Ada Lovelace' }, { email: 'ben@x.co' }, { email: 'cy@x.co', name: 'Smith, Cy' }],
      cc: [{ email: 'dee@y.co', name: 'Dee\r\nBcc: evil@x.co' }],
      subject: 'Minutes',
      html: 'x',
    });
    expect(res.ok).toBe(true);
    const txt = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('ada-x.co.txt'))!), 'utf8');
    expect(txt.split('\n').slice(0, 3)).toEqual(['To: Ada Lovelace <ada@x.co>, ben@x.co, "Smith, Cy" <cy@x.co>', 'Cc: "Dee Bcc: evil@x.co" <dee@y.co>', 'Subject: Minutes']);
    // One email: one pair of files, named after the first address.
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('notes the sender name an email goes out with, when it isn’t the site’s (companies)', async () => {
    const outbox = createOutboxTransport({ dir, now: () => new Date('2026-10-10T08:30:05.123Z') });
    await outbox.send({ to: 'a@b.co', subject: 'Welcome', html: 'x', fromName: 'Beta Team' });
    await outbox.send({ to: 'c@b.co', subject: 'Welcome', html: 'x' });
    const read = (to: string) => readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith(`${to}.txt`))!), 'utf8');
    expect(read('a-b.co')).toContain('Subject: Welcome\nFrom: Beta Team\n');
    expect(read('c-b.co')).not.toContain('From:');
    const html = readFileSync(join(dir, readdirSync(dir).find((f) => f.endsWith('a-b.co.html'))!), 'utf8');
    expect(html.split('\n')[0]).toBe('<!-- To: a@b.co · Subject: Welcome · From: Beta Team -->');
  });
});

describe('chooseTransport', () => {
  const mailjet = { apiKey: '', secretKey: '', from: 'MICO360 Tasks <no-reply@x.co>' };

  it('uses Mailjet whenever its keys are set', () => {
    expect(chooseTransport({ nodeEnv: 'development', mailjet: { ...mailjet, apiKey: 'k', secretKey: 's' }, outboxDir: dir }).kind).toBe('mailjet');
    expect(chooseTransport({ nodeEnv: 'production', mailjet: { ...mailjet, apiKey: 'k', secretKey: 's' } }).kind).toBe('mailjet');
  });

  it('uses the outbox outside production when it is asked for and there are no Mailjet keys', () => {
    const chosen = chooseTransport({ nodeEnv: 'development', mailjet, outboxDir: dir });
    expect(chosen.kind).toBe('outbox');
    expect(chosen.transport.configured).toBe(true);
  });

  it('never uses the outbox in production: email stays off and the setting is reported as ignored', () => {
    const chosen = chooseTransport({ nodeEnv: 'production', mailjet, outboxDir: dir });
    expect(chosen.kind).toBe('none');
    expect(chosen.transport.configured).toBe(false);
    expect(chosen.outboxIgnored).toBe(true);
  });

  it('has no email at all without Mailjet keys or an outbox', () => {
    const chosen = chooseTransport({ nodeEnv: 'development', mailjet, outboxDir: '  ' });
    expect(chosen.kind).toBe('none');
    expect(chosen.transport.configured).toBe(false);
    expect(chosen.outboxIgnored).toBe(false);
  });
});
