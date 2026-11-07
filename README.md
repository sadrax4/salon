# Nail Salon Platform (Persian / RTL) — foundation

See `docs/STATUS.md` first: it states exactly what is verified, what is unexecuted, and what is not built yet.

## Run locally in VS Code
1. Install Node ≥ 22.18 and Docker Desktop. Open this folder in VS Code.
2. `cp .env.example .env`, then fill `DATA_ENCRYPTION_KEY`, `SESSION_SECRET` (commands are in the file) and the seed owner password.
3. `docker compose up -d` (Postgres 16).
4. `npm install`
5. `npm test` — runs the domain/security tests (no database needed). `npm run typecheck` checks everything.
6. `npm run db:setup` (migration + exclusion constraint) → `npm run db:seed` → `npm run dev` → http://localhost:3000

## Conventions
- Money: integer **Rial** in the DB; Toman only for display (`formatToman`). Deposit default 30% (3000 bp).
- Instants: UTC `timestamptz`; salon timezone `Asia/Tehran`; weekdays 0=Saturday..6=Friday.
- Business rules live in `src/domain` (pure, tested); DB/HTTP glue lives in `src/server` and `src/app/api`.
- Every admin route calls `requireStaff(permission)`; the UI is never the enforcement point.
