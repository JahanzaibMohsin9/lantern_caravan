#!/usr/bin/env bash
# Pulls the latest main, installs dependencies, builds the game for this site and restarts the server.
# Usage (on the VM): sudo lantern-update
set -euo pipefail

APP=/opt/lantern-caravan
[ -f /etc/lantern-caravan.domain ] && . /etc/lantern-caravan.domain
DOMAIN="${DOMAIN:?No domain configured}"
as_app() { runuser -u lantern -- env npm_config_cache=/var/cache/lantern-caravan-npm "$@"; }

cd "$APP"
as_app git fetch --quiet origin main
as_app git reset --quiet --hard origin/main
as_app npm ci --no-audit --no-fund --loglevel=error
# The browser talks to the API on the same address, through Caddy.
as_app env VITE_SERVER_URL="https://$DOMAIN" npm run build -w @lantern/web
systemctl restart lantern-caravan 2>/dev/null || true
echo "Deployed $(as_app git rev-parse --short HEAD)"
