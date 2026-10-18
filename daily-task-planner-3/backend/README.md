# Daily Task Planner — Split Backend

This folder separates the backend responsibilities into:

```text
backend/
├── db.js
├── server.js
├── recurring.js
├── routes/
│   ├── tasks.js
│   ├── stats.js
│   └── recurring.js
└── services/
    ├── notifications.js
    └── scheduler.js
```

## Setup

```bash
cd backend
npm install
npm start
```

The API listens on `http://localhost:4096`.

## API

- `GET /api/health`
- `GET/POST /api/tasks`
- `PUT/DELETE /api/tasks/:id`
- `PATCH /api/tasks/:id/status`
- `GET /api/stats`
- `GET/POST /api/recurring`
- `PUT/DELETE /api/recurring/:id`
- `PATCH /api/recurring/:id/toggle`

The SQLite database is created automatically as `tasks.db`.

## Frontend integration

The uploaded React file currently stores tasks and recurring tasks in
`window.storage`. The split backend is therefore a backend replacement/API
layer; the React frontend will need its persistence calls changed from
`window.storage.get/set` to HTTP requests against `/api/tasks`,
`/api/recurring`, and `/api/stats`.

The recurring behavior mirrors the uploaded frontend: daily, weekly
(same weekday as the start date), and monthly (same date) instances are
created only when an instance for that recurring task/date does not already
exist.

`services/notifications.js` provides the Linux `notify-send` integration.
