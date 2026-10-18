# Daily Task Planner

Task planner with a Node/Express API, SQLite storage, and a static vanilla-JS
frontend. Account verification and password reset use Resend; email task
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

For the Pi deployment, Jenkins maps container port 3000 to host port 3001. To
make the planner public without requiring visitors to install Tailscale, use a
Cloudflare Tunnel with a domain managed by Cloudflare. Map a hostname such as
`planner.example.com` to `http://127.0.0.1:3001`; the tunnel requires no inbound
router port-forwarding. A temporary Quick Tunnel URL is useful for a demo but
is not a stable production address. See the
[Cloudflare Tunnel setup guide](https://developers.cloudflare.com/tunnel/get-started/).

Set `APP_BASE_URL` to that public HTTPS URL. For Android builds, add a
`PLANNER_PUBLIC_URL` repository variable under **Settings → Secrets and
variables → Actions → Variables** with the public HTTPS origin (for example,
`https://planner.example.com`). The workflow rejects a missing, non-HTTPS, or
Tailscale URL, so it cannot publish a tailnet-only APK. After setting the
variable and pushing these changes, you can run **Build and publish Android
APK** manually from the Actions tab to publish a fresh APK release.

### Resend email setup

Create a Resend API key and verify a sender domain in Resend. Set these
environment values for local Docker Compose in an untracked `.env` file (copy
`.env.example`):

```bash
RESEND_API_KEY=re_...
EMAIL_FROM="Daily Task Planner <planner@example.com>"
APP_BASE_URL=https://planner.example.com
```

For Jenkins, make sure the Docker Hub credential ID used by the Jenkinsfile is
`dockerhub-creds`. Add three **Secret text** credentials with these exact IDs:
`resend-api-key`, `planner-email-from`, and `planner-public-url`. The pipeline
injects these into the deployed container at runtime; add them before running
the updated Jenkins pipeline. The app container binds to loopback so only the
local tunnel can reach it; the pipeline trusts Cloudflare's client-IP header
for auth throttling. Never commit API keys to Git. Email verification is
required for new accounts. Password reset responds with the same message
whether an account exists or not.

Signed-in, verified users can opt in to email task reminders from the sidebar.
Reminders are sent once per scheduled time and use the account's time zone.
The email provider is Resend; the API key is only needed by the server.

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
