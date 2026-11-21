#!/usr/bin/env bash
# Builds Lexical here and ships it to a small VM that runs it without Docker
# (see deploy/native). Cross-compiles the server for Linux with cargo-zigbuild.
#
#   HOST=ubuntu@<ip> DOMAIN=<host> scripts/deploy-native.sh [--env]
#
# --env uploads .env.production as /opt/lexical/.env (readable only by the app).
set -euo pipefail
: "${HOST:?set HOST=ubuntu@<ip>}"; : "${DOMAIN:?set DOMAIN (e.g. 1-2-3-4.sslip.io)}"
KEY=${KEY:-$HOME/.ssh/lexical_oci}
ARCH=${ARCH:-x86_64}
SSH="ssh -i $KEY"
cd "$(dirname "$0")/.."

echo "── build server ($ARCH linux)"
(cd server && cargo zigbuild --release --target "$ARCH-unknown-linux-gnu.2.35" -q)
echo "── build web for https://$DOMAIN"
(cd web && rm -rf .next-prod && NEXT_DIST_DIR=.next-prod NEXT_PUBLIC_API_URL="https://$DOMAIN" NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null)
cp -R web/.next-prod/static web/.next-prod/standalone/.next-prod/static
cp -R web/public web/.next-prod/standalone/public

STAGE=$(mktemp -d)
mkdir -p "$STAGE/server" "$STAGE/web"
cp "server/target/$ARCH-unknown-linux-gnu/release/lexical-server" "$STAGE/server/"
cp -R server/content "$STAGE/server/content"
cp -R web/.next-prod/standalone/. "$STAGE/web/"
cp deploy/native/*.service deploy/native/Caddyfile "$STAGE/"

if [[ "${1:-}" == "--env" ]]; then
  [[ -f .env.production ]] || { echo "no .env.production"; exit 1; }
  cp .env.production "$STAGE/.env"
fi

echo "── upload"
rsync -az --delete -e "$SSH" "$STAGE/" "$HOST:/tmp/lexical-release/"
rm -rf "$STAGE"
$SSH "$HOST" "sudo bash -s" <<REMOTE
set -euo pipefail
rsync -a --delete /tmp/lexical-release/server/ /opt/lexical/server/
rsync -a --delete /tmp/lexical-release/web/ /opt/lexical/web/
if [[ -f /tmp/lexical-release/.env ]]; then install -m 600 -o lexical -g lexical /tmp/lexical-release/.env /opt/lexical/.env; fi
install -m 644 /tmp/lexical-release/*.service /etc/systemd/system/
install -m 644 /tmp/lexical-release/Caddyfile /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=DOMAIN=$DOMAIN\n' > /etc/systemd/system/caddy.service.d/domain.conf
chown -R root:root /opt/lexical/server /opt/lexical/web
rm -rf /tmp/lexical-release
systemctl daemon-reload
systemctl enable --now lexical-server lexical-web caddy
systemctl restart lexical-server lexical-web caddy
sleep 3
systemctl --no-pager --lines=0 status lexical-server lexical-web caddy | grep -E "●|Active:"
REMOTE
echo "deployed → https://$DOMAIN"
