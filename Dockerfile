# syntax=docker/dockerfile:1
FROM oven/bun:1.4 AS webbuild
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json ./backend/package.json
COPY web/package.json ./web/package.json
RUN bun install
COPY web ./web
RUN bash -c 'cd web && ./node_modules/.bin/vite build'

FROM oven/bun:1.4 AS runtime
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json ./backend/package.json
COPY web/package.json ./web/package.json
RUN bun install
COPY backend ./backend
COPY --from=webbuild /app/web/build ./web/build
ENV HOST=0.0.0.0
ENV PORT=3000
# MySQL (overridden by docker-compose)
ENV MYSQL_HOST=db
ENV MYSQL_PORT=3306
ENV MYSQL_USER=kanban
ENV MYSQL_PASSWORD=kanban
ENV MYSQL_DATABASE=kanban
EXPOSE 3000
CMD ["bash", "-c", "cd backend && bun run start"]
