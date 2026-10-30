import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../components/ui/BrandLogo';

/**
 * Public privacy notice and terms of use, linked from the sign-in page and the phone app (the
 * Play Store requires a privacy policy address). Written for MICO360's own staff system; the
 * company should review the wording before publishing to the store.
 */

const UPDATED = '29 September 2026';
const CLIENT_UPDATED = '30 October 2026';
const CONTACT = 'info@mico360.com';

/** Back to where the reader came from (the shared project page), when they came from a page of this site. */
function BackButton() {
  const navigate = useNavigate();
  // The first page of the visit has the key "default": nothing to go back to here.
  if (useLocation().key === 'default') return null;
  return (
    <button type="button" onClick={() => navigate(-1)} className="tap text-sm font-semibold text-brand hover:underline">
      Back
    </button>
  );
}

function LegalLayout({ title, updated = UPDATED, back = 'login', children }: { title: string; updated?: string; back?: 'login' | 'previous'; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-ground px-3 py-6 sm:px-8 sm:py-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <span className="flex">
            <BrandLogo className="h-10" />
          </span>
          {back === 'login' ? (
            <Link to="/login" className="tap text-sm font-semibold text-brand hover:underline">
              Back to sign in
            </Link>
          ) : (
            <BackButton />
          )}
        </div>
        <h1 className="font-display text-3xl font-bold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-3">Last updated {updated}</p>
        <div className="mt-8 space-y-7 text-[15px] leading-relaxed text-ink-2">{children}</div>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-semibold text-ink">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
);

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy policy">
      <p>
        MICO360 Tasks is the task, project, chat and meeting system that MICO360 (Muscat, Sultanate of Oman) runs for its
        staff: the web app, the Android app and the Chrome extension. This notice explains what information the system
        keeps about you, why, and what you can do about it.
      </p>

      <Section title="What we keep">
        <List
          items={[
            <><strong>Your account:</strong> name, email address, username, role, department, profile picture and your settings (theme, time zone, notification choices). Your password is stored only as a secure one-way hash.</>,
            <><strong>Your work:</strong> the projects, tasks, subtasks, comments, attachments, chat messages, meeting notes and action items that you and your colleagues create.</>,
            <><strong>Security and activity records:</strong> sign-in times, failed sign-in attempts (to lock an account under attack), when you were last active, and an audit log of important changes such as account and permission changes.</>,
            <><strong>Phone app:</strong> a push-notification token for your device, so the app can alert you. Your fingerprint or face never leaves your phone; the phone checks it and only tells the app “yes” or “no”.</>,
            <><strong>Email:</strong> a delivery log of the messages the system sends you (for example sign-in codes and reminders).</>,
          ]}
        />
      </Section>

      <Section title="Why we use it">
        <p>
          Only to run the system for MICO360: to let you sign in, share and track work with your colleagues, send the
          notifications and emails you rely on, keep accounts secure, and produce the work reports managers use. We do
          not sell your information or use it for advertising.
        </p>
      </Section>

      <Section title="Who can see it">
        <List
          items={[
            'Colleagues who work with you: project members see the project’s tasks, comments, files and chat; meeting participants see the meeting’s notes.',
            'Administrators, who manage accounts and can see reports and the audit log.',
            'Service providers that deliver parts of the system for us: the hosting provider, Mailjet (email delivery) and Google Firebase Cloud Messaging (phone notifications). If an administrator turns on the AI features, the text you ask the AI to work on is sent to the AI provider MICO360 has chosen.',
          ]}
        />
      </Section>

      <Section title="How long we keep it">
        <List
          items={[
            'Your account and work stay for as long as you work with MICO360 and the work is needed.',
            'Deleted items are kept for up to 90 days so mistakes can be undone, then they can be removed for good.',
            'Sign-in codes and password-reset links expire within an hour.',
            'Audit records are kept for about a year and email delivery logs for about 90 days.',
          ]}
        />
      </Section>

      <Section title="Your choices">
        <List
          items={[
            'You can update your profile and choose which notifications you receive, in the app’s Settings.',
            <>You can download a copy of your information at any time: <strong>Profile → Download my data</strong> in the web app.</>,
            'You can ask an administrator to correct your details or to close your account. When an account is closed, your name and contact details are removed from it while the shared work history stays intact for your colleagues.',
          ]}
        />
      </Section>

      <Section title="How we protect it">
        <p>
          The public site (task.mico360.com) is reached over encrypted HTTPS connections; an office server is reached
          only inside the office network. Passwords are stored only as hashes, sessions can be ended from the server,
          and accounts lock after repeated failed sign-ins. On the phone, your session is kept in the device’s secure
          storage and the app’s saved data is cleared when you sign out.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about this notice or your information: <a className="font-semibold text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          If this notice changes, the date at the top changes too.
        </p>
      </Section>
    </LegalLayout>
  );
}

/**
 * The privacy notice for clients: someone outside the company following one shared project on its
 * client page (ClientViewPage), linked from that page's footer and open without signing in. Every
 * line is what the client view does (client-view-payload, client-access-service, the Share with
 * client panel): keep it true when they change. The owner approves the wording before it goes live.
 */
export function ClientPrivacyPage() {
  return (
    <LegalLayout title="Privacy notice for clients" updated={CLIENT_UPDATED} back="previous">
      <p>
        A company that uses MICO360 Tasks has shared one of its projects with you on a private, read-only page. This
        notice explains what that page shows you, what it never shows, how signing in works, and how your email address
        is used.
      </p>

      <Section title="What you can see">
        <p>Only what the company chose to share with you:</p>
        <List
          items={[
            'the project’s name and details, how much of its work is done, and its timeline;',
            'the tasks and milestones it marked for you: each one’s title, status and due date, and “Late” when one is past its due date and not done;',
            'the meeting minutes it approved and marked for you;',
            'the inspection reports it marked for you, with the inspector’s notes on each item and the names of the people who signed them.',
          ]}
        />
      </Section>

      <Section title="What the page never shows">
        <p>
          The project’s team or who is assigned to what, people’s contact details, comments, files, task descriptions, and
          the company’s internal notes, including the notes taken during meetings.
        </p>
      </Section>

      <Section title="Signing in">
        <List
          items={[
            'The link in your invitation opens the page only after you enter a one-time code, which we email to the address the project was shared with. A code lasts 10 minutes, and only the newest one works.',
            'Your device then stays signed in to this one page for 30 days, with a cookie used only for that. Choose “Sign out” on the page to end it sooner.',
            'If the company sends you a new link or removes your access, the old link stops working and every device signed in with it is signed out. The page also closes if the project is archived or deleted.',
          ]}
        />
      </Section>

      <Section title="Your email address">
        <p>
          It is used only to send you the invitation, any new link, and your sign-in codes. The company can see your name,
          your email address and when you last opened the page, and it keeps a record of the emails sent to you and of
          each sign-in, with its time and your internet (IP) address.
        </p>
      </Section>

      <Section title="Questions">
        <p>Please contact the company that shared the project with you — the person named in your invitation email — about this page or your information.</p>
      </Section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of use">
      <p>
        MICO360 Tasks is provided by MICO360 to its staff and invited collaborators for company work. By signing in you
        agree to these terms.
      </p>

      <Section title="Your account">
        <List
          items={[
            'Accounts are created by an administrator. Use only your own account and keep your password and devices secure.',
            'Tell an administrator straight away if you think someone else has used your account.',
          ]}
        />
      </Section>

      <Section title="Acceptable use">
        <List
          items={[
            'Use the system for MICO360 work and treat what you see in it as company-confidential.',
            'Don’t upload anything unlawful, harmful (such as malware) or that you don’t have the right to share.',
            'Don’t try to get around access controls, overload the system or reach information you aren’t meant to see.',
          ]}
        />
      </Section>

      <Section title="Content">
        <p>
          Work you create in the system belongs to MICO360. Administrators may review, keep or remove content to run the
          system, meet legal obligations or investigate misuse.
        </p>
      </Section>

      <Section title="Availability and changes">
        <p>
          We aim to keep the system available and your work safe, but it may occasionally be unavailable for maintenance
          or reasons outside our control. We may update the system and these terms; the date at the top shows the latest
          version.
        </p>
      </Section>

      <Section title="Ending access">
        <p>
          Access ends when your work with MICO360 ends, or earlier if these terms are broken. How your information is
          handled is described in the <Link to="/privacy" className="font-semibold text-brand hover:underline">privacy policy</Link>.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          <a className="tap font-semibold text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>
      </Section>
    </LegalLayout>
  );
}
