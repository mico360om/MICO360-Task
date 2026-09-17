import { createNavigationContainerRef } from '@react-navigation/native';
import type { AppStackParamList } from './types';

/** Shared navigation ref so imperative navigation (push taps, the drawer) can route from anywhere. */
export const navigationRef = createNavigationContainerRef<AppStackParamList>();
