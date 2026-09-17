import type { DeviceTokenRecord, DeviceTokenRepository, RegisterDeviceTokenData } from './device-token-repository';

export interface DeviceTokenServiceDeps {
  deviceTokens: DeviceTokenRepository;
}

/**
 * Manages the push-notification device tokens a user's devices register (A6.2).
 * Registration is idempotent and reassigns a token to the latest user (shared
 * device / re-login); the push sender reads `listForUser` to fan a notification
 * out to a user's devices.
 */
export function createDeviceTokenService({ deviceTokens }: DeviceTokenServiceDeps) {
  async function register(data: RegisterDeviceTokenData): Promise<DeviceTokenRecord> {
    return deviceTokens.upsert(data);
  }

  async function unregister(token: string, userId: string): Promise<void> {
    const existing = await deviceTokens.findByToken(token);
    if (existing && existing.userId === userId) {
      await deviceTokens.deleteByToken(token);
    }
  }

  async function listForUser(userId: string): Promise<DeviceTokenRecord[]> {
    return deviceTokens.listForUser(userId);
  }

  return { register, unregister, listForUser };
}

export type DeviceTokenService = ReturnType<typeof createDeviceTokenService>;
