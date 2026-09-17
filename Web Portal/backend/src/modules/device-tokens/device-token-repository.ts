export type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';

export interface DeviceTokenRecord {
  id: string;
  userId: string;
  token: string;
  platform: DevicePlatform;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface RegisterDeviceTokenData {
  userId: string;
  token: string;
  platform: DevicePlatform;
}

export interface DeviceTokenRepository {
  findByToken(token: string): Promise<DeviceTokenRecord | null>;
  /** Create the token, or (if it already exists) reassign it to this user and bump lastSeenAt. */
  upsert(data: RegisterDeviceTokenData): Promise<DeviceTokenRecord>;
  deleteByToken(token: string): Promise<void>;
  listForUser(userId: string): Promise<DeviceTokenRecord[]>;
}
