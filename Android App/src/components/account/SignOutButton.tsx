import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useMyQueuedChanges, useServices, useUserId } from '../../core/providers';
import { Button } from '../ui';
import { signOutQuestion } from '../../lib/sign-out';

/**
 * "Sign out", in Settings and on Profile (as the website has it there — 6a review): it asks first,
 * warning when changes made offline haven't reached the server yet (signing out deletes them) —
 * inspection changes included.
 */
export function SignOutButton() {
  const { signOut, inspections } = useServices();
  const queued = useMyQueuedChanges();
  const userId = useUserId();
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
    // Inspection answers, follow-up requests and a finish not sent yet count too (Stage 4).
    const q = signOutQuestion(queued.pending.length + queued.failed.length + inspections.unsentCount(userId));
    Alert.alert(q.title, q.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void doSignOut() },
    ]);
  }

  return <Button title="Sign out" variant="secondary" onPress={confirm} loading={busy} />;
}
