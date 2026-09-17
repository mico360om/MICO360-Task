import * as LocalAuthentication from 'expo-local-authentication';

/** True when the device has biometric hardware AND an enrolled biometric. */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

/** Present the OS biometric prompt; resolves true only on a successful match. */
export async function authenticateBiometric(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock MICO360 Tasks',
      cancelLabel: 'Use password',
    });
    return result.success;
  } catch {
    return false;
  }
}
