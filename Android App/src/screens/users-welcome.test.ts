/** Stage 2 Task 15: User Management — sign-ins and welcome emails (source text: the screens need React Native). */
import { it, expect } from 'vitest';
import { appSource as src } from '../testing/web-source';

it('welcome emails go now, never kept for later, and over 100 are refused before sending', () => {
  expect(src('core/admin-queries.ts')).toMatch(/useWelcomeEmails[^]*UserChangeNotSent/);
  expect(src('core/admin-queries.ts')).not.toMatch(/sendInOrder|queueOnOffline|itemLanes/);
  expect(src('screens/UsersScreen.tsx')).toMatch(/> MAX_WELCOME_BATCH[^]*WELCOME_TEXT\.tooMany/);
});

it('welcome emails go as the administrator who sent them, and the list is read again after', () => {
  const q = src('core/admin-queries.ts');
  const hook = q.slice(q.indexOf('export function useWelcomeEmails'));
  expect(hook).toMatch(/owned\(services\)\.resources\.users/);
  expect(hook).toMatch(/invalidateQueries\(\{ queryKey: USERS_KEY \}\)/);
});

it('the cards show the last sign-in and the welcome button', () => {
  const s = src('screens/UsersScreen.tsx');
  expect(s).toMatch(/signInText\(/);
  expect(s).toMatch(/welcomeSentText\(/);
  expect(s).toMatch(/icon="kit\.mail"/);
  expect(s).toMatch(/label=\{`Send welcome email to \$\{u\.username\}`\}/);
  expect(s).toMatch(/accessibilityLabel=\{`Select \$\{u\.username\}`\}/);
});

it('the list is sorted by sign-in and filtered by "Never signed in", with the website’s empty words', () => {
  const s = src('screens/UsersScreen.tsx');
  expect(s).toMatch(/sortBySignIn\(/);
  expect(s).toMatch(/SIGN_IN_SORTS/);
  expect(s).toMatch(/NEVER_EMPTY/);
  expect(s).toMatch(/welcomeCandidates\(/);
  expect(s).toContain('USERS_SUBTITLE');
});

it('email not set up: the note, and no welcome buttons', () => {
  const s = src('screens/UsersScreen.tsx');
  expect(s).toMatch(/emailEnabled !== false/);
  expect(s).toMatch(/WELCOME_TEXT\.emailOff/);
});

it('the confirmations and the result are the WelcomeSheets', () => {
  const sheets = src('components/users/WelcomeSheets.tsx');
  for (const w of ['welcomeOneConfirmTitle(', 'welcomeConfirmTitle(', 'namesText(', 'SIGN_OUT_NOTE', 'leftOutText(', 'welcomeResultLines(', 'WELCOME_TEXT.body']) expect(sheets, w).toContain(w);
  expect(src('screens/UsersScreen.tsx')).toMatch(/from '\.\.\/components\/users\/WelcomeSheets'/);
});

it('New user: the welcome switch (off when email isn’t set up), the optional password, and the notice after', () => {
  const f = src('screens/UserFormScreen.tsx');
  expect(f).toMatch(/<Toggle[^>]*label=\{NEW_USER_TEXT\.welcome\}/);
  expect(f).toMatch(/sendWelcome: emailEnabled && form\.sendWelcome/);
  expect(f).toMatch(/NEW_USER_TEXT\.optional/);
  expect(f).toMatch(/NEW_USER_TEXT\.leaveEmpty/);
  expect(f).toMatch(/notice\(createdNotice\(created\)\)/);
});
