# syntax=docker/dockerfile:1
FROM oven/bun:1.4 AS webbuild
WORKDIR /app
COPY package.json bun.lock ./
COPY web/package.json ./web/package.json
RUN bun install
COPY web ./web
RUN bash -c 'cd web && ./node_modules/.bin/vite build'

FROM oven/bun:1.4 AS runtime
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json ./backend/package.json
RUN bun install --cwd backend
COPY backend ./backend
COPY --from=webbuild /app/web/build ./web/build
ENV HOST=0.0.0.0
ENV PORT=3000
ENV KANBAN_DB=/app/data/kanban.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "--cwd", "backend", "run", "start"]
