# Daily Task Planner

Task planner with a Node/Express API, SQLite storage, and a static vanilla-JS
frontend. Account verification and password reset use Gmail SMTP; email task
reminders are optional for each user. A free-tier account supports low-volume
use.

```text
daily-task-planner/
├── backend/
│   ├── src/
│   │   ├── server.js       # Express app, serves API + static frontend
│   │   ├── db.js           # SQLite schema/setup
│   │   ├── recurring.js    # generates today's instances from recurring rules
│   │   └── routes/
│   │       ├── tasks.js
│   │       ├── recurring.js
│   │       └── stats.js
│   ├── data/                # SQLite file lives here (gitignored)
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   └── public/               # plain HTML/CSS/JS, served by Express
├── docker-compose.yml
└── .env.example
```

## Option A — run it as-is (no Docker)

Requires Node.js 20+ on your Ubuntu machine.

```bash
cd daily-task-planner/backend
npm install
npm run dev
```

Then open **http://localhost:3000**. The SQLite file is created automatically
at `backend/data/tasks.db` the first time you run it.

To change the port: `PORT=4000 npm run dev`.

## Option B — Docker

From the project root (the folder with `docker-compose.yml`):

```bash
cd daily-task-planner
docker compose up --build
```

Then open **http://localhost:3000**.

- The container installs dependencies and compiles `better-sqlite3` at build
  time (needs `python3`/`make`/`g++`, already included in the image).
- Task data is stored in a named Docker volume (`task-data`) mounted at
  `/app/backend/data`, so `docker compose down` and `docker compose up`
  again won't lose your tasks. Only `docker compose down -v` wipes it.
- To run in the background: `docker compose up -d --build`.
- To stop: `docker compose down`.
- To view logs: `docker compose logs -f`.

If you'd rather use plain `docker` without compose:

```bash
docker build -t daily-task-planner -f backend/Dockerfile .
docker run -p 3000:3000 -v task-data:/app/backend/data daily-task-planner
```

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tasks?date=YYYY-MM-DD` | Tasks for a day (also generates due recurring tasks) |
| GET | `/api/tasks?from=&to=` | Tasks in a date range (used by the calendar) |
| POST | `/api/tasks` | Create a task |
| PUT | `/api/tasks/:id` | Update a task (status, fields, etc.) |
| DELETE | `/api/tasks/:id` | Delete a task |
| GET/POST/PUT/DELETE | `/api/recurring[...]` | Manage recurring task rules |
| GET | `/api/stats` | Completion stats, by category/priority |
| GET | `/api/health` | App health response |

## Accounts and public access

The app supports self-service registration, email verification, sign-in, and
password reset. Passwords are stored as individual salted Argon2id hashes (a
one-way password hash, not reversible encryption). Reset links are random,
single-use, expire after 30 minutes, and invalidate all existing sessions.
Verification links expire after 24 hours. Sessions use random, HttpOnly,
SameSite cookies; production cookies are marked Secure. Tasks and recurring
rules are scoped to the signed-in user. The first account created after
upgrading receives any previously unassigned single-user tasks and recurring
rules; existing accounts are marked verified during the one-time migration.

Task content remains in the SQLite database without application-level
encryption at rest. Protect the Pi and its database backups accordingly.

For the Pi deployment, Jenkins maps container port 3000 to host port 3001. This
Pi already uses Tailscale Funnel to expose that app publicly at
`https://rpi.tail92d0d8.ts.net:8443`; visitors do not need Tailscale installed.
Funnel is available on Tailscale's free plan and provides HTTPS without router
port forwarding. The Funnel configuration must continue proxying port 8443 to
`http://127.0.0.1:3001`.

Use `https://rpi.tail92d0d8.ts.net:8443` for `APP_BASE_URL` and for the Jenkins
Secret text credential `planner-public-url`. For Android builds, add a
`PLANNER_PUBLIC_URL` repository variable under **Settings → Secrets and
variables → Actions → Variables** with the same URL. The APK then calls the
public app URL, so people who install it do not need Tailscale. After setting
the variable and pushing any Android build changes, run **Build and publish
Android APK** manually from the Actions tab to publish a fresh APK release.
The base address without `:8443` routes to a different service and must not be
used for the app.

The Funnel status currently also shows the default HTTPS address forwarding
`/github-webhook/` to Jenkins. Keep the Jenkins UI protected; only the webhook
endpoint needs public access for GitHub delivery.

### Gmail SMTP email setup

For a low-volume personal project, the app sends account verification,
password-reset, and reminder emails through Gmail SMTP. Enable 2-Step
Verification on the Gmail account, then create an App Password in Google
Account security settings. Google requires 2-Step Verification for App
Passwords; keep the generated password private and revoke it when no longer
needed.

```bash
SMTP_USER=your-gmail-address@gmail.com
SMTP_APP_PASSWORD=your-app-password
EMAIL_FROM="Daily Task Planner <your-gmail-address@gmail.com>"
APP_BASE_URL=https://rpi.tail92d0d8.ts.net:8443
```

For Jenkins, make sure the Docker Hub credential ID used by the Jenkinsfile is
`dockerhub-creds`. Add **Secret text** credentials with these exact IDs:
`gmail-smtp-user` (your full Gmail address), `gmail-app-password` (the
generated App Password), `planner-email-from` (for example, `Daily Task Planner
<your-gmail-address@gmail.com>`), and `planner-public-url`. The pipeline
injects these into the deployed container at runtime. Never commit the App
Password to Git or put it in the Android app. The app container binds to
loopback so only the local tunnel can reach it. Email verification is required
for new accounts. Password reset responds with the same message whether an
account exists or not.

Signed-in, verified users can opt in to email task reminders from the sidebar.
Reminders are sent once per scheduled time and use the account's time zone.
The app connects to Gmail over TLS SMTP on port 465. Use a dedicated Gmail
account for the app if possible; Google may impose sending limits or block
unusual activity, so this is suitable for low-volume learning and personal use,
not bulk mail.

## Android app download

The Android app is a small WebView wrapper around the responsive planner. It
requires internet access and uses the same HTTPS backend and account as the
website. GitHub Actions builds a debug-signed APK when the Android project or
frontend changes, then publishes it as the `android-public-latest` GitHub release. The
website's **Download Android app** button links directly to that APK. The
repository must be public for anyone to download the release without signing
in to GitHub.

The debug APK is suitable for practice installs. For wider distribution, sign
a release APK with a private release key and consider publishing through
Google Play; never commit signing keys or passwords to this repository.
