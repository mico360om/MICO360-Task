import * as LocalAuthentication from 'expo-local-authentication';

/**
 * True when the device has biometric hardware AND a STRONG (Android Class 3) biometric enrolled —
 * e.g. a fingerprint. Camera-only face unlock (Class 2 / weak) does not qualify (MOB-01).
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const [hasHardware, isEnrolled, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    return hasHardware && isEnrolled && level >= LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG;
  } catch {
    return false;
  }
}

/**
 * Present the OS biometric prompt; resolves true only on a successful match (MOB-01):
 * strong biometrics only, and NO fallback to the device PIN/pattern — otherwise anyone who knows
 * a shared phone's PIN could pass the check.
 */
export async function authenticateBiometric(promptMessage = 'Unlock MICO360 Tasks'): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
      biometricsSecurityLevel: 'strong',
      requireConfirmation: true,
    });
    return result.success;
  } catch {
    return false;
  }
}
