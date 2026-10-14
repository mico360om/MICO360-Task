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

  it('lists attachments by name (their content is not written)', async () => {
    const outbox = createOutboxTransport({ dir });
    await outbox.send({ to: 'a@b.co', subject: 'Invite', html: 'x', attachments: [{ filename: 'invite.ics', contentType: 'text/calendar', content: Buffer.from('BEGIN') }] });
    const txt = readdirSync(dir).find((f) => f.endsWith('.txt'))!;
    expect(readFileSync(join(dir, txt), 'utf8')).toContain('Attachments: invite.ics (text/calendar, 5 bytes)');
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
