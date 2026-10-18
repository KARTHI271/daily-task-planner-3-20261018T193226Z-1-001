# Daily Task Planner Backend
# Node.js + Express + SQLite (better-sqlite3)

FROM node:20-bookworm-slim

WORKDIR /app/backend

# Install build tools for better-sqlite3
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY backend/src ./src

# Copy frontend public files
COPY frontend/public ../frontend/public

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
