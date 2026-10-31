import React from 'react';
import { Sheet, SheetButtons, SheetMessage } from '../meeting/sheet-kit';
import { SIGN_OUT_NOTE, leftOutText, namesText, welcomeConfirmTitle, welcomeOneConfirmTitle } from '../../lib/user-sign-in';
import { WELCOME_TEXT, userFullName, welcomeResultLines, type ApiAdminUser, type WelcomeBatchResult } from '../../lib/users-admin';

/**
 * User Management's welcome-email sheets, as the website's ConfirmDialogs: one person's send asks
 * first (and says what using the link does); a send to several says to whom, what they get and who
 * was left out; and its answer says how it went, with each person not sent one and why.
 */

/** "Send a welcome email to Sara Ali (sara@mico360.com)?" — Send / Cancel. */
export function WelcomeOneSheet({
  user,
  busy,
  error,
  onSend,
  onClose,
}: {
  user: ApiAdminUser | null;
  busy?: boolean;
  error?: string | null;
  onSend(): void;
  onClose(): void;
}) {
  return (
    <Sheet
      visible={!!user}
      title={user ? welcomeOneConfirmTitle(userFullName(user), user.email) : WELCOME_TEXT.send}
      onClose={busy ? () => undefined : onClose}
      footer={<SheetButtons cancel="Cancel" onCancel={onClose} confirm="Send" onConfirm={onSend} busy={busy} />}
    >
      <SheetMessage tone="info" text={SIGN_OUT_NOTE} />
      <SheetMessage text={error} />
    </Sheet>
  );
}

/** "Send welcome emails to 12 people?" — to whom (filtered off the list too), what they get, who was left out. */
export function WelcomeManySheet({
  visible,
  names,
  leftOut,
  busy,
  error,
  onSend,
  onClose,
}: {
  visible: boolean;
  /** Everyone it goes to, in the list's own order. */
  names: string[];
  /** How many "everyone who has never signed in" left out (sent one in the last 7 days). */
  leftOut?: number | null;
  busy?: boolean;
  error?: string | null;
  onSend(): void;
  onClose(): void;
}) {
  return (
    <Sheet
      visible={visible}
      title={welcomeConfirmTitle(names.length)}
      onClose={busy ? () => undefined : onClose}
      footer={<SheetButtons cancel="Cancel" onCancel={onClose} confirm="Send" onConfirm={onSend} busy={busy} />}
    >
      <SheetMessage tone="info" text={`To: ${namesText(names)}.`} />
      <SheetMessage tone="info" text={WELCOME_TEXT.body} />
      <SheetMessage tone="info" text={SIGN_OUT_NOTE} />
      {leftOut ? <SheetMessage tone="info" text={leftOutText(leftOut)} /> : null}
      <SheetMessage text={error} />
    </Sheet>
  );
}

/** How a send to several went: "Sent 11. 1 not sent:" and "sara: <why>" for each; an error look when none went. */
export function WelcomeResultSheet({ result, onClose }: { result: WelcomeBatchResult | null; onClose(): void }) {
  const r = result ? welcomeResultLines(result) : null;
  return (
    <Sheet visible={!!r} title={r?.summary ?? ''} onClose={onClose} footer={<SheetButtons cancel="Close" onCancel={onClose} />}>
      {r?.lines.length ? <SheetMessage tone={r.error ? 'error' : 'info'} text={r.lines.map((l) => l.text).join('\n')} /> : null}
    </Sheet>
  );
}
