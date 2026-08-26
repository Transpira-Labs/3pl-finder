# Live Google Sheet sync — setup

Every finished call auto-appends a row to a Google Sheet. The app talks to Google
server-side using a **service account**, so end users never touch Apps Script or
OAuth — they just paste a normal Sheet link.

There are two parts: a **one-time server setup** (done once by whoever runs the
app) and the **per-user connect** (paste a link).

---

## Part A — one-time server setup (~5 min, done once)

You create a service account — a robot Google identity the server uses to write
to Sheets — and put its credentials in the app's environment.

1. **Create a Google Cloud project** (or reuse one) at
   https://console.cloud.google.com/projectcreate.

2. **Enable the Google Sheets API**:
   https://console.cloud.google.com/apis/library/sheets.googleapis.com → **Enable**.

3. **Create a service account**: APIs & Services → **Credentials** →
   **Create credentials → Service account**. Give it any name → **Done**.

4. **Create a key**: click the new service account → **Keys** tab →
   **Add key → Create new key → JSON**. A `.json` file downloads. It contains a
   `client_email` and a `private_key`.

5. **Put the credentials in the environment.** Copy `.env.example` to `.env.local`
   and fill in:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` = the JSON's `client_email`
     (looks like `something@your-project.iam.gserviceaccount.com`).
   - `GOOGLE_PRIVATE_KEY` = the JSON's `private_key`, on one line, in double
     quotes, keeping the `\n` escapes:
     ```
     GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"
     ```

6. **Restart** `npm run dev` (or redeploy) so the env is picked up.

That's it — you never do this again. The same service account works for every
Sheet and every user.

---

## Part B — connect a Sheet (per user, ~15 seconds)

1. Open (or create) the Google Sheet you want calls logged to.

2. **Share it with the service-account email** (the
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` from Part A) as an **Editor**. This is what lets
   the app write to *your* Sheet. If you forget, the **Test** button tells you the
   exact address to share with.

3. In the tracker, open **Google Sheet sync** (header), **paste the Sheet's link**
   (straight from your browser's address bar), click **Test** → **Save**.

From now on, ending a call appends a row to that Sheet's **Calls** tab
automatically. The tab and its header row are created on first write.

---

## Columns written

`id, started, ended, ringing, waiting, right, wrong, voicemail, noanswer, total, disposition, note`
(the duration columns are written as real elapsed-time values, auto-formatted as
`0:01:23.456` — readable at a glance and still summable with `=SUM(...)`. `started`
and `ended` are `YYYY-MM-DD HH:MM:SS` in UTC.)

---

## Leads do not come from a Sheet

This Sheet is only a *log of finished calls*. Leads are pulled from **Saleshandy**
(Settings → Connections); the older "import leads from a Sheet" path has been
removed. Nothing here writes back to a lead row.

## Good to know

- **Retries are safe.** Each call has a stable `id` and the server skips ids
  already in the Sheet, so re-syncing never duplicates rows.
- **Offline?** Calls stay saved locally and are pushed on the next sync (the
  status line shows how many are pending; **Sync now** forces it).
- **"Share the Sheet with …" error on Test/Sync:** the Sheet isn't shared with the
  service account yet — do Part B step 2.
- **"…isn't configured on the server":** Part A env vars are missing/blank.
- CSV export still works as a manual backup.

## Legacy Apps Script option

The old zero-server-config path (paste an Apps Script web-app URL per Sheet) is
still in `google-apps-script.gs` if you'd rather not run a service account. The
built-in sync panel now expects a **Sheet link**, so the Apps Script route would
need its own field wired back in.
