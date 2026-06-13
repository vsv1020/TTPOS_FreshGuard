#!/usr/bin/env bash
#
# FreshGuard backend deploy — run ON the node6 server (e.g. /opt/apps/deploy.sh).
#
# Pulls the latest code from GitHub, syncs it into the live service directory
# while PRESERVING .env, data/ (the SQLite DB) and node_modules/, reinstalls
# production deps, restarts the systemd service, and health-checks. If the
# health check fails it automatically rolls back to the pre-deploy snapshot.
#
# HTTPS (certbot) is a one-time setup and is intentionally NOT part of this
# script; the Let's Encrypt cert auto-renews via certbot's systemd timer.
#
# Usage:
#   ./deploy.sh                 # deploy the default branch
#   BRANCH=main ./deploy.sh     # deploy a specific branch
#   APP_DIR=/opt/apps/freshguard SERVICE=freshguard ./deploy.sh
#
set -euo pipefail

# ---- config (override via environment) ----
REPO_URL="${REPO_URL:-https://github.com/vsv1020/TTPOS_FreshGuard.git}"
BRANCH="${BRANCH:-feat/week2-selfcheck-scoring}"
APP_DIR="${APP_DIR:-/opt/apps/freshguard}"
SERVICE="${SERVICE:-freshguard}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/health}"
KEEP_BACKUPS="${KEEP_BACKUPS:-5}"

log() { echo "[$(date +%H:%M:%S)] $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# ---- preflight ----
[ -d "$APP_DIR" ] || fail "APP_DIR not found: $APP_DIR"
[ -f "$APP_DIR/.env" ] || fail "no .env in $APP_DIR (refusing to deploy into an unconfigured dir)"
command -v git >/dev/null   || fail "git not installed"
command -v rsync >/dev/null || fail "rsync not installed"
command -v npm >/dev/null   || fail "npm not installed"

TS="$(date +%Y%m%d-%H%M%S)"
SRC="$(mktemp -d /tmp/fg-deploy-XXXXXX)"
BACKUP="${APP_DIR}.bak-${TS}"
trap 'rm -rf "$SRC"' EXIT

log "1/6 clone $BRANCH"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC" >/dev/null 2>&1 \
  || fail "git clone failed (branch $BRANCH)"
[ -f "$SRC/backend/src/server.js" ] || fail "clone missing backend/src/server.js"

log "2/6 backup current deploy -> $BACKUP"
cp -a "$APP_DIR" "$BACKUP"

log "3/6 sync backend (preserve .env, data/, node_modules/)"
rsync -a --delete \
  --exclude='.env' --exclude='data/' --exclude='node_modules/' --exclude='._*' \
  "$SRC/backend/" "$APP_DIR/"

log "4/6 npm install (production deps)"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) \
  || fail "npm install failed"

log "5/6 restart $SERVICE"
systemctl restart "$SERVICE"

log "6/6 health check ($HEALTH_URL)"
ok=""
for _ in $(seq 1 10); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

if [ -z "$ok" ]; then
  log "HEALTH CHECK FAILED — rolling back to $BACKUP"
  mv "$APP_DIR" "${APP_DIR}.failed-${TS}"
  mv "$BACKUP" "$APP_DIR"
  systemctl restart "$SERVICE"
  fail "deploy rolled back; bad build left at ${APP_DIR}.failed-${TS}"
fi

# ---- prune old backups, keep the most recent $KEEP_BACKUPS ----
ls -dt "${APP_DIR}".bak-* 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do
  log "prune old backup $old"
  rm -rf "$old"
done

log "DONE — $SERVICE is healthy on $BRANCH (backup: $BACKUP)"
