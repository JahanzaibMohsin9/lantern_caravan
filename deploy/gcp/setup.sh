#!/usr/bin/env bash
# One-time setup for the Lantern Caravan live server on a Debian 12 VM.
# Installs Node 24 and Caddy, clones the repo, builds the game and starts it as a service.
# Usage (on the VM): sudo DOMAIN=lanterncaravan.duckdns.org bash setup.sh
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, for example lanterncaravan.duckdns.org}"
REPO="${REPO:-https://github.com/JahanzaibMohsin9/lantern_caravan.git}"
APP=/opt/lantern-caravan
DATA=/var/lib/lantern-caravan
ENV_FILE=/etc/lantern-caravan.env
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

# Node 24 from NodeSource.
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -q nodejs
fi

# Caddy from its official repository.
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# A 2 GB swap file keeps the build safe on a 2 GB machine.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id lantern >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin lantern
mkdir -p "$DATA" /var/cache/lantern-caravan-npm
chown lantern:lantern /var/cache/lantern-caravan-npm
chown lantern:lantern "$DATA"
chmod 750 "$DATA"

if [ ! -d "$APP/.git" ]; then
  git clone "$REPO" "$APP"
fi
chown -R lantern:lantern "$APP"

# Settings. The NEAR operator key is added separately (see deploy/gcp/README.md) and never comes from the repo.
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
PORT=4318
LANTERN_DATA_DIR=$DATA
IDENTITY=dev
STORE=file
SETTLEMENT=dev
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
NEAR_ACCOUNT_ROOT=lantern-caravan.testnet
EOF
fi
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

install -m 644 "$HERE/lantern-caravan.service" /etc/systemd/system/lantern-caravan.service
sed "s/{\$DOMAIN}/$DOMAIN/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
install -m 755 "$HERE/update.sh" /usr/local/bin/lantern-update
echo "DOMAIN=$DOMAIN" > /etc/lantern-caravan.domain

systemctl daemon-reload
DOMAIN="$DOMAIN" /usr/local/bin/lantern-update
systemctl enable --now lantern-caravan
systemctl reload caddy || systemctl restart caddy
echo "Lantern Caravan is set up at https://$DOMAIN"
