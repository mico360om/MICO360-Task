# Email — Deliverability & Testing (T20.5 / T20.6)

MICO360 Tasks sends email through **Mailjet** (Send API v3.1): login OTP codes, password-reset
links, task-assigned notifications, and welcome emails.

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

The endpoint records each event (delivered/open/click/bounce/spam/blocked) in `email_log`.
Any address that **hard-bounces, is marked spam, or is blocked** is thereafter **suppressed** —
`EmailService` checks suppression and silently skips sending to it, protecting the sender
reputation. Set `MAILJET_WEBHOOK_TOKEN` so only Mailjet can post events.

## Testing

- **Unit/route tests** cover the transport payload (`mailer.test.ts`), the high-level senders +
  suppression (`email-service.test.ts`), the webhook event mapping + recording
  (`email-webhook-service.test.ts`), and the webhook route incl. token check
  (`email-webhook-routes.test.ts`).
- **Manual send-test**: with real Mailjet keys in `Web Portal/backend/.env`, trigger an OTP for a real
  inbox (`POST /api/v1/auth/otp/request`) and confirm delivery, DKIM pass, and that it lands in
  the inbox (not spam). Use Mailjet's live dashboard + a tool like mail-tester.com to check the
  SPF/DKIM/DMARC score.
- In development the Mailjet keys are blank; the transport call returns a non-OK result instead
  of throwing, so flows keep working without delivering mail.
