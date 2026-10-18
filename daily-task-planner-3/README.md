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
| GET | `/health` | `{status, database, scheduler}` |

## Notes on what's not here

Per the free-tier plan: no email (SMTP costs/limits), no Prometheus/Grafana,
no AI scheduling. The `/health` endpoint and a clean route/service split are
already in place so those can be added later without restructuring.
