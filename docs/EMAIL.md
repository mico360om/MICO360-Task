# Email — Deliverability & Testing (T20.5 / T20.6)

MICO360 Tasks sends email through **Mailjet** (Send API v3.1): login OTP codes, password-reset
links, task-assigned notifications, and welcome emails.

## Sign-in with an emailed code

The sign-in page (web and Android) offers **Password** and **Email code**. "Email code" — and
"Forgot password?" — appear only when the server can send email, i.e. when `MAILJET_API_KEY` and
`MAILJET_SECRET_KEY` are set; without them the page says to ask an administrator instead.

How it works: the person enters their email or username and gets a one-time code (6 digits by
default, `OTP_LENGTH`), valid for 10 minutes (`OTP_TTL_SECONDS`; the email states the real time).
A code works once; three wrong guesses end it, and ten wrong guesses in an hour block codes for that
account for an hour. At most one code a minute (five an hour) is sent per account, and the page's
"Resend code" counts down that minute. The answer never reveals whether an account exists. A
correct code also clears a password lockout.

**To turn it on in production:** set the two Mailjet keys (rotated — see below) and a verified
`MAIL_FROM` in the server's environment, restart the server, then sign out and check that the
sign-in page shows "Email code".

**On a development computer** without Mailjet keys, set `EMAIL_OUTBOX_DIR` to a folder: every email
(codes, reset links, invitations) is then saved there as an `.html` file (open it in a browser) and
a `.txt` file instead of being sent, and the sign-in page offers "Email code". This setting is
ignored in production.

## Deliverability setup (do this before go-live)

In your DNS, for the domain in `MAIL_FROM`:

1. **SPF** — add Mailjet to your SPF record, e.g. `v=spf1 include:spf.mailjet.com ~all`.
2. **DKIM** — enable DKIM in the Mailjet account and add the TXT record Mailjet gives you.
3. **DMARC** — publish a policy, e.g. `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain`.
4. Verify the sender domain/address in Mailjet (an unverified `MAIL_FROM` will be rejected).

Rotate the **Mailjet secret** that was shared in plaintext during planning before production.

## Event webhook + suppression

Point a Mailjet **Event API** trigger at:

```
POST https://<your-api>/api/v1/webhooks/mailjet?token=<MAILJET_WEBHOOK_TOKEN>
```

The token can also be sent as the HTTP Basic password. It is compared in constant time, and in
production the webhook refuses every event (503) until `MAILJET_WEBHOOK_TOKEN` is set.

The endpoint records each event in `email_log`. Only a **hard bounce** (Mailjet's
`hard_bounce: true`) or a **spam complaint** suppresses an address; soft bounces are recorded as
failures and unsubscribes are ignored. Suppression lasts **90 days**, then sending resumes.
Suppressed addresses are skipped for ordinary notifications, but sign-in codes, password-reset
links and account-activation emails are always attempted (with a warning in the log), so a
suppression can never lock someone out.

Every send attempt is recorded as SENT or FAILED. A provider error is no longer swallowed: the
API reports it (e.g. meeting invitations return how many were sent and how many failed), and with
no Mailjet keys configured, email-dependent actions answer 503 `EMAIL_NOT_CONFIGURED`.

## Testing

- **Unit/route tests** cover the transport payload (`mailer.test.ts`), the high-level senders +
  suppression (`email-service.test.ts`), the webhook event mapping + recording
  (`email-webhook-service.test.ts`), and the webhook route incl. token check
  (`email-webhook-routes.test.ts`).
- **Manual send-test**: with real Mailjet keys in `Web Portal/backend/.env`, trigger an OTP for a real
  inbox (`POST /api/v1/auth/otp/request`) and confirm delivery, DKIM pass, and that it lands in
  the inbox (not spam). Use Mailjet's live dashboard + a tool like mail-tester.com to check the
  SPF/DKIM/DMARC score.
- In development the Mailjet keys are blank, so email features are off (503
  `EMAIL_NOT_CONFIGURED`) unless `EMAIL_OUTBOX_DIR` is set — then every email is saved to that folder
  (see "Sign-in with an emailed code" above), which is how the email-code sign-in is tested end to
  end on a local server.
