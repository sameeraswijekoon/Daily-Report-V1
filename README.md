# Daily Report — Web App

A simple web app for field staff to submit daily visit reports, backed by a
**Google Sheet as the online database** (one tab for users, one tab for reports).
Includes login, an admin panel for managing users/passwords, and one-click
Excel (.xlsx) export for a month or any custom date range.

## How it works

```
Phone / browser  ──HTTPS──▶  GitHub Pages (this repo: index.html, app.js, …)
        │
        │  JSON over HTTPS (Google Apps Script Web App)
        ▼
Google Sheet  ◀──▶  backend/Code.gs
   ├─ Users    (username, password hash, full name, role, active)
   └─ Reports  (date, customer, contact, city, reason, remark, time start/end, …)
```

* Hosting is free (GitHub Pages). The database is free (Google Sheets).
* Passwords are hashed with SHA-256 **in the browser** — the sheet only ever
  stores hashes, never plain-text passwords.
* Excel export runs in the browser (SheetJS) — no server needed.

## Setup (one time, ~10 minutes)

### 1. Create the Google Sheet (database)

1. Go to [sheets.new](https://sheets.new) and create a blank spreadsheet.
2. Name it e.g. `Daily Report DB`. The tabs are created automatically later.

### 2. Add the backend script

1. In the sheet, open **Extensions → Apps Script**.
2. Delete any default code in the editor.
3. Open `backend/Code.gs` from this repo, copy the **entire** file, paste it in.
4. Click **Save** (floppy-disk icon / Ctrl+S). Name the project `DailyReport`.

### 3. Deploy as a Web App

1. In Apps Script, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Set:
   * **Description:** `Daily Report API`
   * **Execute as:** `Me`
   * **Who has access:** `Anyone`
4. Click **Deploy**, authorize when asked (choose your Google account →
   Advanced → Go to DailyReport → Allow).
5. **Copy the Web app URL** — it looks like
   `https://script.google.com/macros/s/AKfyc…/exec`.

> If you edit `Code.gs` later, publish the change via
> **Deploy → Manage deployments → Edit → New version**, otherwise the old
> code keeps running.

### 4. Point the web app at your backend

1. Open `config.js` in this repo and paste your Web app URL:
   ```js
   window.DR_API_URL = "https://script.google.com/macros/s/AKfyc…/exec";
   ```
2. Commit and push the change (or edit the file directly on GitHub).

### 5. Create the first admin account

1. Open the published site (see "Hosting" below).
2. Because no users exist yet, you'll see a **Create admin account** screen.
3. Fill it in — this becomes the admin login. Done.

## Hosting

This repo is a static site — enable **GitHub Pages**:

* GitHub → repo **Settings → Pages** → Source: **Deploy from a branch** →
  Branch: **main**, folder **/** → Save.
* The site appears at `https://sameeraswijekoon.github.io/Daily-Report-V1/`.

## Using the app

**Everyone (after logging in):**

* **New Report** — fill Customer name, Contact number, City, Date
  (auto-set to today, changeable), Reason to visit, Remark, Time start/end → Save.
* **My Reports** — view/filter your submitted reports by date.
* **Export Excel** — pick a whole month (e.g. at month end) or a custom date
  range → **Download Excel (.xlsx)**.

**Admins** additionally get a **Users** tab:

* Add users (username, full name, password, role: User/Admin).
* Change any user's password (type a new one in their row → Update).
* Activate/deactivate users via the checkbox.
* In My Reports / Export, admins can switch between *My reports* and *All users*,
  and can delete reports.

## Sheet structure (reference)

`Users` tab:

| Username | PasswordHash | FullName | Role | Active | CreatedAt |
|---|---|---|---|---|---|

`Reports` tab:

| Timestamp | Username | Date | CustomerName | ContactNumber | City | ReasonToVisit | Remark | TimeStart | TimeEnd |
|---|---|---|---|---|---|---|---|---|---|

You can read (and even edit) the data directly in the sheet — the app picks it up.

## Security notes

* The Web app URL is effectively a key: anyone with the link can call the API,
  but every action still requires a valid login, and user management requires an
  admin login. Don't post the URL publicly.
* Passwords are SHA-256 hashed client-side before they ever leave the browser.
* A deactivated user cannot log in.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Cannot reach the server" | Check the URL in `config.js` is the **Web app** URL (ends in `/exec`), committed & pushed. |
| Login works but data won't save | You edited `Code.gs` — deploy a **New version** (step 3 note). |
| Excel button does nothing | The SheetJS CDN needs internet; check connection and reload. |
| `crypto.subtle` / hashing error | The page must be served over HTTPS (GitHub Pages is) or localhost. |

## Files

| File | Purpose |
|---|---|
| `index.html` | App pages (login, setup, report form, history, export, admin) |
| `styles.css` | Mobile-first styling |
| `app.js` | All frontend logic |
| `config.js` | Your Web app URL (the only file you must edit) |
| `backend/Code.gs` | Google Apps Script backend (paste into Apps Script) |
