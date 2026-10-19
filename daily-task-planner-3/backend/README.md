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

Registration verification, password reset, and opt-in task reminders use
Gmail SMTP. Configure these environment variables in the runtime:

- `SMTP_USER`: full Gmail address used to authenticate.
- `SMTP_APP_PASSWORD`: Google App Password; keep it out of Git.
- `EMAIL_FROM`: sender display name and the same Gmail address, for example
  `Daily Task Planner <planner@gmail.com>`.
- `APP_BASE_URL`: public HTTPS origin used to create verification and reset
  links (for example, `https://rpi.tail92d0d8.ts.net:8443`).

Gmail App Passwords require 2-Step Verification. The mailer uses TLS to
`smtp.gmail.com:465`; use it for low-volume app mail, not bulk sending.

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
