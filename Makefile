.PHONY: install dev build start seed seed-reset test typecheck lint clean mcp sync-skills install-hermes

install:
	bun install

dev:
	bash -c 'cd backend && bun run dev' & bash -c 'cd web && ./node_modules/.bin/vite dev --port 5173' & wait

build:
	bash -c 'cd web && ./node_modules/.bin/vite build'

start:
	bash -c 'cd backend && bun run start'

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
	bash -c 'cd backend && bun run seed'

seed-reset:
	bash -c 'cd backend && bun run seed:reset'

mcp:
	BACKEND_URL=http://127.0.0.1:3000 bash -c 'cd backend && bun run mcp'

sync-skills:
	backend/scripts/sync-skills.sh

install-hermes:
	backend/scripts/copy-to-hermes.sh $(DEST)
