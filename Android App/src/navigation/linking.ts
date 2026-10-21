/**
 * URL deep links (A0.3, MOB-09). Pure data so it can be unit-tested with React Navigation's
 * `getStateFromPath`; RootNavigator passes it to `NavigationContainer`.
 *
 * - `mico360://task/<id>`, `mico360://project/<id>`, `mico360://notifications`, `mico360://home`
 * - `mico360://meeting/<id>`, `mico360://meetings`, `mico360://my-action-items` (2a)
 * - `https://task.mico360.com/reset?token=…` — the password-reset e-mail link. Android App Links
 *   (intent filter with autoVerify in app.json + /.well-known/assetlinks.json on the web host)
 *   open it in the app, straight on the Reset screen with the token filled in. The Reset screen
 *   exists only while signed out (auth stack), the app screens only while signed in; both are
 *   listed here and React Navigation resolves whichever stack is mounted.
 */
export const LINKING_PREFIXES = ['mico360://', 'https://task.mico360.com'];

export const linkingConfig = {
  screens: {
    // Signed-out (auth stack)
    Login: 'login',
    Forgot: 'forgot',
    Reset: 'reset',
    // Signed-in (app stack)
    Tabs: { screens: { Notifications: 'notifications', Dashboard: 'home', Meetings: 'meetings' } },
    Board: 'project/:projectId',
    TaskDetail: 'task/:taskId',
    MeetingDetail: 'meeting/:meetingId',
    MyActionItems: 'my-action-items',
  },
} as const;
