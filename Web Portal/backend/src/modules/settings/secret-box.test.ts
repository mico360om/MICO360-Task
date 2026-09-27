import { describe, it, expect } from 'vitest';
import { createSecretBox, secretBoxFromEnv } from './secret-box';

describe('secret box (AES-256-GCM)', () => {
  const box = createSecretBox([{ material: 'unit-test-key-material', info: 'test' }]);

  it('round-trips a secret, including non-ASCII text', () => {
    for (const plain of ['sk-live-abc123', 'مفتاح-سري-١٢٣', '']) {
      const enc = box.encrypt(plain);
      expect(enc.startsWith('enc:v1:')).toBe(true);
      if (plain) expect(enc).not.toContain(plain);
      expect(box.decrypt(enc)).toBe(plain);
    }
  });

  it('uses a fresh IV every time', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('passes legacy plaintext through unchanged', () => {
    expect(box.isEncrypted('sk-plain')).toBe(false);
    expect(box.decrypt('sk-plain')).toBe('sk-plain');
  });

  it('refuses tampered ciphertext and the wrong key', () => {
    const enc = box.encrypt('sk-secret');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
    expect(() => box.decrypt(tampered)).toThrow();
    const other = createSecretBox([{ material: 'another-key', info: 'test' }]);
    expect(() => other.decrypt(enc)).toThrow();
  });

  it('keeps reading JWT-derived ciphertext after SECRETS_ENCRYPTION_KEY is set', () => {
    const before = secretBoxFromEnv({ JWT_ACCESS_SECRET: 'jwt-access-secret-value' });
    const enc = before.encrypt('sk-migrate');
    const after = secretBoxFromEnv({ JWT_ACCESS_SECRET: 'jwt-access-secret-value', SECRETS_ENCRYPTION_KEY: 'a-dedicated-32-byte-random-key!!' });
    expect(after.decrypt(enc)).toBe('sk-migrate');
    // New values use the dedicated key: the JWT-only box can no longer read them.
    expect(() => before.decrypt(after.encrypt('sk-new'))).toThrow();
  });
});
