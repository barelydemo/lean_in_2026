#!/usr/bin/env bash
# Ships the code to the VM and rebuilds the stack there.
#
#   HOST=ubuntu@<vm-ip> scripts/deploy.sh            # code only
#   HOST=ubuntu@<vm-ip> scripts/deploy.sh --env      # also upload .env.production as the VM's .env
#
# Secrets never go through git: .env.production stays on your laptop
# (gitignored) and lands on the VM as /opt/lexical/.env, readable only by you.
set -euo pipefail
: "${HOST:?set HOST=ubuntu@<vm-ip>}"
DIR=/opt/lexical
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--env" ]]; then
  [[ -f .env.production ]] || { echo "no .env.production here — copy .env.example and fill it in"; exit 1; }
  grep -q '^DOMAIN=.\+' .env.production || { echo ".env.production needs DOMAIN=..."; exit 1; }
  scp -q .env.production "$HOST:$DIR/.env"
  ssh "$HOST" "chmod 600 $DIR/.env"
  echo "uploaded .env"
fi

rsync -az --delete \
  --exclude .git --exclude '.env*' --exclude 'server/target' --exclude 'server/data' \
  --exclude 'web/node_modules' --exclude 'web/.next' --exclude backups --exclude .DS_Store \
  ./ "$HOST:$DIR/"

ssh "$HOST" "cd $DIR && docker compose -f compose.prod.yml up -d --build && docker image prune -f >/dev/null && docker compose -f compose.prod.yml ps"
DOMAIN=$(ssh "$HOST" "grep '^DOMAIN=' $DIR/.env | cut -d= -f2")
echo "deployed → https://$DOMAIN"
