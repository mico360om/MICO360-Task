import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useMyQueuedChanges, useServices } from '../../core/providers';
import { Button } from '../ui';
import { signOutQuestion } from '../../lib/sign-out';

/**
 * "Sign out", in Settings and on Profile (as the website has it there — 6a review): it asks first,
 * warning when changes made offline haven't reached the server yet (signing out deletes them).
 */
export function SignOutButton() {
  const { signOut } = useServices();
  const queued = useMyQueuedChanges();
  const [busy, setBusy] = useState(false);

  async function doSignOut() {
    setBusy(true);
    try {
      await signOut('user');
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    const q = signOutQuestion(queued.pending.length + queued.failed.length);
    Alert.alert(q.title, q.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void doSignOut() },
    ]);
  }

  return <Button title="Sign out" variant="secondary" onPress={confirm} loading={busy} />;
}
