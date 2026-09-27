import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption for secrets kept in the database (AI provider API keys): AES-256-GCM with a key
 * derived by HKDF-SHA256. Encrypted values look like `enc:v1:<iv>.<tag>.<ciphertext>`; anything
 * without that prefix is legacy plaintext and is returned as-is, so it keeps working until the
 * next save encrypts it.
 */
export interface SecretBox {
  encrypt(plain: string): string;
  /** Decrypt an `enc:v1:` value (or pass legacy plaintext through). Throws if no key fits. */
  decrypt(value: string): string;
  isEncrypted(value: string): boolean;
}

const PREFIX = 'enc:v1:';
const SALT = 'mico360-secrets';

function deriveKey(material: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', material, SALT, info, 32));
}

export interface SecretKeySource {
  material: string;
  /** Domain-separation label, so the same material can't produce the same key for two uses. */
  info: string;
}

/** The first key encrypts; every key is tried when decrypting (key rotation / migration). */
export function createSecretBox(keys: SecretKeySource[]): SecretBox {
  if (keys.length === 0 || keys.some((k) => !k.material)) throw new Error('createSecretBox needs at least one non-empty key.');
  const derived = keys.map((k) => deriveKey(k.material, k.info));

  function encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', derived[0]!, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
  }

  function isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }

  function decrypt(value: string): string {
    if (!isEncrypted(value)) return value;
    const [iv, tag, ct] = value.slice(PREFIX.length).split('.');
    if (!iv || !tag || ct === undefined) throw new Error('Malformed encrypted secret.');
    for (const key of derived) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
      } catch {
        // wrong key — try the next one
      }
    }
    throw new Error('Encrypted secret could not be decrypted with the configured key.');
  }

  return { encrypt, decrypt, isEncrypted };
}

/**
 * The app's secret box: SECRETS_ENCRYPTION_KEY when set, otherwise a key derived from
 * JWT_ACCESS_SECRET. The JWT-derived key is always accepted for decryption, so setting
 * SECRETS_ENCRYPTION_KEY later migrates existing values on their next save.
 */
export function secretBoxFromEnv(env: { SECRETS_ENCRYPTION_KEY?: string; JWT_ACCESS_SECRET: string }): SecretBox {
  const fromJwt: SecretKeySource = { material: env.JWT_ACCESS_SECRET, info: 'mico360/secrets/v1/jwt-derived' };
  const explicit = env.SECRETS_ENCRYPTION_KEY?.trim();
  return createSecretBox(explicit ? [{ material: explicit, info: 'mico360/secrets/v1' }, fromJwt] : [fromJwt]);
}
