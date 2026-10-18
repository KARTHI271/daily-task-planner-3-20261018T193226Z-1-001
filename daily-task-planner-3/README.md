# Daily Task Planner (free-tier build)

Local-first task planner: Node/Express API + SQLite, static vanilla-JS frontend
(no build step). Matches the free-tier plan — no email, no cloud services,
no paid anything.

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

The app supports self-service registration and sign-in. Passwords are stored
as individual salted Argon2id hashes (a one-way password hash, not reversible
encryption). Sessions use random, HttpOnly, SameSite cookies; production cookies
are marked Secure. Tasks and recurring rules are scoped to the signed-in user.
The first account created after upgrading receives any previously unassigned
single-user tasks and recurring rules.

Task content remains in the SQLite database without application-level
encryption at rest. Protect the Pi and its database backups accordingly.

For the Pi deployment, Jenkins maps container port 3000 to host port 3001. To
make the app reachable over HTTPS through Tailscale Funnel, use a separate
HTTPS port so the Jenkins webhook Funnel on 443 remains in place:

```bash
sudo tailscale funnel --bg --https=8443 3001
sudo tailscale funnel status
```

The public app URL is `https://rpi.tail92d0d8.ts.net:8443/`. Anyone with that
URL can reach the registration page, so create your account promptly after
deploying and before sharing it. Each registration receives a separate task
space. Use HTTPS for account sign-in.

## Android app download

The Android app is a small WebView wrapper around the responsive planner. It
requires internet access and uses the same HTTPS backend and account as the
website. GitHub Actions builds a debug-signed APK when the Android project or
frontend changes, then publishes it as the `android-latest` GitHub release. The
website's **Download Android app** button links directly to that APK. The
repository must be public for anyone to download the release without signing
in to GitHub.

The debug APK is suitable for practice installs. For wider distribution, sign
a release APK with a private release key and consider publishing through
Google Play; never commit signing keys or passwords to this repository.
