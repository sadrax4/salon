#!/usr/bin/env bash
# Usage: ./deploy.sh [PORT]   (run on the server, inside the cloned repo)
set -euo pipefail
PORT="${1:-47563}"
IP="$(curl -4 -s ifconfig.me || hostname -I | awk '{print $1}')"
if [ ! -f .env ]; then
  cat > .env <<EOF
DB_PASSWORD=$(openssl rand -hex 16)
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
APP_URL=http://$IP:$PORT
APP_PORT=$PORT
SALON_TIMEZONE=Asia/Tehran
SEED_OWNER_EMAIL=owner@example.com
SEED_OWNER_PASSWORD=Aa$(openssl rand -hex 8)
SMS_PROVIDER=mock
EOF
  chmod 600 .env
fi
docker compose -f docker-compose.prod.yml up -d --build
echo; echo "UP: http://$IP:$PORT"; grep SEED_OWNER .env
