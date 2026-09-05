.PHONY: install dev build start seed seed-reset test typecheck lint clean mcp sync-skills

install:
	bun install

dev:
	bun --cwd backend run dev & bash -c 'cd web && ./node_modules/.bin/vite dev --port 5173' & wait

build:
	bash -c 'cd web && ./node_modules/.bin/vite build'

start:
	bun --cwd backend run start

test:
	bun test backend/test
	@echo "== web build check =="
	bash -c 'cd web && ./node_modules/.bin/vite build' > /dev/null && echo "web build ok"

typecheck:
	bunx tsc --noEmit --project backend/tsconfig.json

lint:
	bunx biome check .

clean:
	rm -rf web/build web/.svelte-kit backend/dist data/*.db

seed:
	bun --cwd backend run seed

seed-reset:
	bun --cwd backend run seed:reset

mcp:
	BACKEND_URL=http://127.0.0.1:3000 bun --cwd backend run mcp

sync-skills:
	backend/scripts/sync-skills.sh
