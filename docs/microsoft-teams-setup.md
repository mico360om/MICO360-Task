# Automatic Teams links — one-time setup (Microsoft 365 administrator)

From version 1.23.0, MICO360 Tasks can make a **Microsoft Teams link** for a meeting by itself. Each
person connects their own Microsoft account once (Settings → Microsoft Teams); after that, the meeting
form has a **Create a Teams link** tick. When the meeting is saved, the organizer's own Microsoft account
makes the Teams meeting and its join link goes into the meeting's Online link, the invitation email and
the calendar file. A new time or title updates the Teams meeting; cancelling or deleting the meeting
deletes it.

Nothing is synced with Outlook calendars — invitations keep going out by email with the calendar file,
as today.

Until the four settings in step 5 are on the server, the feature is **hidden everywhere** and nothing
else changes.

This is done once, by your Microsoft 365 administrator, in about 15 minutes. You need:

- a Microsoft 365 account that is a **Global Administrator**, **Application Administrator** or
  **Cloud Application Administrator** (to register the app and give consent), and
- access to **hPanel** for task.mico360.com (to add the settings and restart the site).

---

## 1. Register the app "MICO360 Tasks" in Microsoft Entra

1. Open **https://entra.microsoft.com** and sign in as the administrator.
2. Go to **Identity → Applications → App registrations → New registration**.
3. **Name:** `MICO360 Tasks`
4. **Supported account types** — choose one:
   - **Accounts in this organizational directory only (single tenant)** — when everyone who will make
     Teams links is in your own company's Microsoft 365. This is the usual choice.
   - **Accounts in any organizational directory (multitenant)** — only when people from *several
     companies' own* Microsoft 365 tenants will connect (see "Several companies' tenants" below).
5. **Redirect URI:** platform **Web**, address exactly:

   ```
   https://task.mico360.com/api/v1/integrations/microsoft/callback
   ```

6. Press **Register**.
7. On the app's **Overview** page, copy two values somewhere safe for step 5:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## 2. Make a client secret

1. In the app, open **Certificates & secrets → Client secrets → New client secret**.
2. **Description:** `MICO360 Tasks server`. **Expires:** 24 months (the longest offered).
3. Press **Add**, then copy the **Value** at once (not the "Secret ID") — Microsoft shows it only now.
4. Put the expiry date in your calendar: before it, make a new secret and replace `MS_CLIENT_SECRET`
   (step 5). People do **not** need to connect again when the secret is replaced.

## 3. Give the app its permissions, and consent

1. In the app, open **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.
2. Tick these three (use the search box):
   - **OnlineMeetings.ReadWrite** — make, change and delete the person's own Teams meetings
   - **User.Read** — read who signed in ("Connected as …"); often already listed
   - **offline_access** — stay connected without signing in again each time
3. Press **Add permissions**.
4. Press **Grant admin consent for <your company>** and confirm. Each of the three now shows a green
   tick under "Status".

The app acts only **as the person who connected** (delegated), never as an administrator, and can only
reach that person's own Teams meetings. It asks for nothing else (no mail, no files, no calendar).

People also need to be allowed to create Teams meetings (a Teams licence, and a meeting policy that
allows meetings — the default). Your Teams admin center decides this, as for any Teams meeting.

## 4. Make the server's token key (`MS_TOKEN_KEY`)

Each person's Microsoft connection is kept locked (encrypted) on the server with this key.

On the Hostinger SSH terminal (or any computer with Node.js) run:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

or, on Windows PowerShell:

```
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

It prints one line of 44 characters, ending in `=`. Save it in a password manager.
If this key is ever changed or lost, nothing breaks: everyone simply presses **Connect** again in
Settings (Teams links already made keep working).

## 5. Add the settings in hPanel and restart

In **hPanel → Websites → task.mico360.com → Node.js → Environment variables**, add:

| Name | Value |
| --- | --- |
| `MS_CLIENT_ID` | the **Application (client) ID** from step 1 |
| `MS_CLIENT_SECRET` | the secret **Value** from step 2 |
| `MS_TENANT_ID` | the **Directory (tenant) ID** from step 1 — or `organizations` for several companies' tenants (below) |
| `MS_TOKEN_KEY` | the key from step 4 |

Optional:

| Name | Value |
| --- | --- |
| `MS_ALLOWED_TENANTS` | several tenants only: the Directory (tenant) IDs allowed, separated by commas |
| `MS_REDIRECT_URI` | only if the site's address is not task.mico360.com; must equal the redirect URI in step 1 |

Do **not** set `MS_LOGIN_BASE_URL` or `MS_GRAPH_BASE_URL` — they exist only for tests.

Then press **Restart** (or Redeploy). Paste values exactly, with no spaces around them.

## 6. Check that it works

1. Open **https://task.mico360.com/api/v1/config** — it shows `"microsoftTeams":true`. If it shows
   `false`, the server log has a line beginning "Teams links are off:" saying which setting is missing
   or wrong.
2. Sign in to MICO360 Tasks, open **Settings → Microsoft Teams** and press **Connect Microsoft
   account**. Your browser goes to Microsoft's own sign-in page — check the address starts with
   `https://login.microsoftonline.com/` — sign in and accept. You come back to Settings with
   "Microsoft Teams is connected" and **Connected as** your Microsoft address.
3. Press **New meeting**, fill in a title and a time, tick **Create a Teams link** and save. The
   meeting's page shows **Join on Teams**; it opens the Teams meeting.
4. Change the meeting's time and save — the Teams meeting follows within a minute. Delete the meeting —
   its Teams link stops working.
5. **System → Audit** shows "microsoft.connect" (module "integrations") for your connection.

If Microsoft can't be reached when a meeting is saved, the meeting is saved anyway with the notice
"The Teams link couldn't be made — try again" and a **Make Teams link** button.

## Several companies' tenants

Use this only when people from other companies, each with **their own** Microsoft 365, will connect:

1. In step 1 choose **multitenant**.
2. In step 5 set `MS_TENANT_ID` to `organizations`, and `MS_ALLOWED_TENANTS` to the Directory
   (tenant) IDs of the companies allowed, separated by commas (your own included). Left blank, any work
   or school tenant may connect; personal Microsoft accounts never can.
3. Each other company's own Microsoft 365 administrator consents once for their people: after the first
   person of that company presses Connect (Microsoft says "Need admin approval"), their administrator
   opens **Microsoft Entra → Identity → Applications → Enterprise applications → MICO360 Tasks →
   Permissions → Grant admin consent**.

Every connection's tenant is checked against these settings, each time its token is renewed too.

## What is stored, and how to take it back

- For each person who connects: their Microsoft account's name, address, tenant and user id, and a
  **refresh token locked with `MS_TOKEN_KEY`** (AES-256-GCM). Access tokens stay only in the server's
  memory. Tokens are never sent to the browser or written to the log.
- On each Teams meeting made: the meeting's id in Microsoft and whose account made it.
- **Disconnect** (Settings) deletes the person's stored connection. So does making their MICO360
  account inactive, suspended or deleted. Teams links already made keep working.
- A person can also remove the app on Microsoft's side at **https://myapps.microsoft.com** (Manage your
  apps); an administrator can in **Enterprise applications → MICO360 Tasks** (Users and groups, or
  delete the app). MICO360 Tasks then asks them to connect again.
- Only the organizer's own account is ever used: an administrator scheduling for someone else can't make
  a Teams link for them, and after a meeting is handed to another organizer its Teams link is left as
  it is.

## Turning it off

Remove the four settings in hPanel and restart. Settings → Microsoft Teams and the tick disappear;
meetings keep the links they have.

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Microsoft says **AADSTS50011** (redirect URI mismatch) | The redirect URI in step 1 must be exactly the address shown there (https, no slash at the end). |
| Microsoft says **Need admin approval** / **AADSTS65001** | Step 3's "Grant admin consent" (or, for another company's tenant, their administrator — see above). |
| Back in Settings with "couldn't be connected" | Try again; if it repeats, check the server log for "Microsoft Teams:" lines (they name the reason, never a token). A tenant not allowed by `MS_TENANT_ID` / `MS_ALLOWED_TENANTS` is refused. |
| Settings says "Microsoft no longer accepts this connection" | The person removed the app, their password policy ended the session, or the app's consent was taken back: press **Connect again**. |
| Every Teams link fails, and the server log says "Microsoft refused this server's app settings" | The client secret expired (**AADSTS7000222**, after up to two years) or was mistyped: make a new one (step 2), replace `MS_CLIENT_SECRET`, restart. Everyone's connection is kept — nobody connects again. |
