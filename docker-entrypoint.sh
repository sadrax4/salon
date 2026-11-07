#!/bin/sh
set -e
# wait for Postgres, create tables, apply constraints, seed owner (idempotent), start
until npx prisma db push --skip-generate; do echo "waiting for db..."; sleep 3; done
npx prisma db execute --file prisma/sql/constraints.sql --schema prisma/schema.prisma
node prisma/seed.ts || echo "seed skipped/failed (check SEED_OWNER_* env)"
exec npx next start -H 0.0.0.0 -p 3000
