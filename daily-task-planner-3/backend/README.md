# Daily Task Planner backend

Express serves both the API and the static frontend. The app uses SQLite in
`backend/data/tasks.db`; Docker deployments should keep that directory on a
persistent volume.

## Local setup

```bash
npm install
npm start
```

The server listens on `http://localhost:3000` by default. Set `PORT` to change
the port.

## Email configuration

Registration verification, password reset, and opt-in task reminders use the
Resend email API. Configure these environment variables in the runtime:

- `RESEND_API_KEY`: Resend API key; keep it out of Git.
- `EMAIL_FROM`: sender address on a domain verified in Resend.
- `APP_BASE_URL`: public HTTPS origin used to create verification and reset
  links (for example, `https://planner.example.com`).

Email reminders are disabled by default. A verified account can enable them in
the app sidebar. Reminder delivery uses the account's IANA time zone and sends
each reminder once for its scheduled time.

## Main endpoints

- `GET /api/health`
- `POST /api/auth/register`, `/login`, `/verify-email`
- `POST /api/auth/forgot-password`, `/reset-password`
- `GET /api/auth/me`, `PUT /api/auth/preferences`, `POST /api/auth/logout`
- `GET/POST /api/tasks`
- `PUT/DELETE /api/tasks/:id`
- `GET /api/stats`
- `GET/POST /api/recurring`
- `PUT/DELETE /api/recurring/:id`
- `PATCH /api/recurring/:id/toggle`
