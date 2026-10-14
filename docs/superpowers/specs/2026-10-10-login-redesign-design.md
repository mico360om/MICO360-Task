# Sign-in redesign — web portal, Android app, Chrome extension

Date: 2026-10-10 · Status: design for approval · Preview: `login-redesign-preview.html` (shared in the session)

## Goal

One cohesive, modern sign-in experience on all three platforms: the MICO360 logo up front, a subtle
animated "task scene" behind the form, the same brand colours, type, inputs and buttons, and the
same ways to sign in — without changing how authentication works.

## Decisions (agreed)

- **Icons — option B.** The full MICO360 logo wherever it can be read (Android launcher and adaptive
  icon, extension 48/128 px, Apple touch icon); the "360°" arc mark from the same logo at 16–32 px
  (favicon, extension 16 px). Replaces the old tick icon (which also has a drawing defect).
- **Extension gets the same sign-in options** as web and Android: Password and Email code tabs, a
  "Forgot password?" link to the reset page of the chosen server, a show/hide password control.
  Email code and Forgot password appear only when that server says email works (`/config`
  `emailEnabled`), the same rule as web and Android.

## 1. The task scene (background animation)

A decorative layer of task-themed line drawings — checklist, calendar, reminder bell, progress
ring, completion tick, task card — that float slowly (each bobs ±10–12 px and tilts a few degrees
over 11–17 s, out of step with the others). Every 6–8 s a tick draws itself in, a progress ring
fills, or a reminder dot pulses.

- **Same drawings everywhere.** One set of six 48×48 line glyphs, stroke `currentColor`.
  - Web: `src/components/TaskScene.tsx`, data in `src/lib/task-scene.ts`.
  - Extension: `app/task-scene.js`, a copy of the same data; a web test fails if the two copies differ.
  - Android: PNGs rendered from the same glyphs (white and brand-tinted, @1x–@3x) in
    `assets/scene/`, drawn with `Image` in `src/components/TaskScene.tsx`.
- **Placement.** Hand-placed per layout so nothing crosses the logo, headings or form.
  - Desktop web hero: the right side and bottom of the dark panel. Light background around the
    form card: margins only.
  - Phones and narrow windows: fewer items (CSS media queries / a smaller set on Android), all
    behind the card.
- **Cost.**
  - Web and extension: only `transform` and `opacity` animate (compositor work), apart from at
    most three short stroke-draw/fill effects that run about 1 s out of every 6–8 s. No canvas,
    no `requestAnimationFrame` loop, no JavaScript per frame.
  - Android: `Animated` with `useNativeDriver: true` (transform/opacity only; the tick "pops" in
    rather than drawing).
  - Everything pauses when the page or app is hidden (`visibilitychange` / `AppState`).
- **Reduced motion.** `prefers-reduced-motion: reduce` (web, extension) and Android's "Remove
  animations" (`AccessibilityInfo.isReduceMotionEnabled`, live) show a still scene with every
  tick drawn and every ring filled.
- **Never in the way.** `aria-hidden`, `pointer-events: none` (`pointerEvents="none"` on
  Android), stacked below the content; the form stays fully readable on top (contrast unchanged).
- **Web hero.** The current canvas physics field (`HeroField.tsx`, a per-frame
  `requestAnimationFrame` loop drawing emoji that look different on every OS) is removed in favour
  of the task scene.

## 2. Shared brand system

- **Colours.** Brand `#8B1E1E` / `#A83326` / `#C7513F`, dark hero `#160B0B`, the existing ink,
  line and ground tokens (light and dark themes) — already shared by web and extension.
- **Type.** Archivo 800 for the "Welcome back" heading, IBM Plex Sans for everything else, on all
  three. The web already bundles both. The extension bundles the same woff2 files it needs (about
  60 KB). The Android app loads the TTF versions with `expo-font` (OFL; copied into
  `assets/fonts`, no new npm dependency) and applies them to the sign-in, forgot-password and
  reset screens.
- **Controls.**
  - Inputs: 44 px tall on touch, 12 px radius, 1 px line border, brand focus ring, a leading icon
    on web.
  - Primary button: the brand gradient, white text, a spinner plus text while busy ("Signing in…").
  - Tabs: a segmented "Password / Email code" control.
  - Links: brand text.

## 3. Platform layouts

- **Web portal** (`LoginPage.tsx`, `LoginForm.tsx`).
  - Desktop (≥ 1024 px): keeps the two-column layout. The dark hero carries the white logo, pitch,
    feature list and board preview, with the task scene in its free areas. The form side gets a
    faint light task scene around the card.
  - Below 1024 px: one column, the colour logo above the card, the light scene behind it (today
    the phone layout has no background at all).
  - The form is unchanged in behaviour.
- **Android** (`LoginScreen.tsx`).
  - The company colour logo replaces the tick icon at the top, with the form in a card.
  - Light task scene behind, and a show/hide password control (it has none today).
  - Inline validation messages ("Enter your email or username.") instead of a silently disabled
    button.
  - The keyboard pushes the form up (existing `KeyboardAvoidingView` + scroll); the scene stays
    fixed behind.
  - Splash screen: the white logo on brand red.
- **Chrome extension** (`app/screens/login.js`, `app/app.css`).
  - The colour logo on the card, the light task scene filling the tab, and the new sign-in options
    above.
  - Clear errors for wrong details, a locked account, too many attempts, a server problem, and
    being offline.
  - "Advanced: change server" stays.
  - Works from 320 px wide up. It opens as a tab, not a popup; the layout also holds in a
    popup-sized window.

## 4. What does not change

Sign-in requests, tokens and sessions, "Keep me signed in", lockout handling, the server choice
(Android, extension), email codes and their limits, password reset — all as today.

## 5. Testing

- **Unit tests.**
  - Web and extension task scene: decorative, pointer-transparent, static with reduced motion,
    pauses when hidden; plus the glyph copy check.
  - Extension: sign-in form behaviour (tabs only with email on, show/hide password, validation,
    error wording).
  - Android: the scene's motion and pause rules (pure helpers).
  - All existing suites stay green.
- **Browser (web and extension).**
  - Sign-in success, wrong password, network failure (requests blocked), forgot password (reset
    email from the local test mailbox, then sign in with the new password), and email code.
  - Show/hide password, keyboard-only use, and screen-reader names.
  - Widths 320–2560 and a 480 px-tall screen, light and dark.
  - With reduced motion, no running animations. The scene never intercepts a click (hit-test on
    every control). Only transform/opacity animate.
- **Android, on an emulator with a test build.**
  - The same five cases: success, wrong password, server unreachable, forgot password, email code.
  - The keyboard open over the form on a small (360×640) screen.
  - "Remove animations" switched on.
  - The new launcher icon and splash.
- **Icons.** Rendered at every size, checked visually. The web favicon/touch icon is served by the
  API's web server; the extension manifest points at the new files.

## Out of scope

- Brand fonts in the rest of the Android app (only the sign-in screens).
- The Windows installer's own window icon.
- Rebuilding the release packages in `Installer/`.
