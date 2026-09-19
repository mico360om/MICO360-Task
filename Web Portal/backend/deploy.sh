#!/usr/bin/env bash
#
# deploy.sh — ONE-SHOT deployment for the MICO360 Tasks backend.
#
# Brings a freshly-extracted backend from empty to running, in one command:
#   1. Configures the database connection (DATABASE_URL)
#   2. Installs dependencies (incl. build tools)
#   3. Generates the Prisma client
#   4. Builds the app (dist/)
#   5. Configures the database SCHEMA — creates/updates all tables (migrate deploy),
#      or wipes everything first when RESET_DATA=1
#   6. Creates the single admin account
#
# WHERE: run on the SERVER, from the backend app root (folder with package.json +
# prisma/). On Hostinger, run it inside the Node.js app environment — activate the
# app's nodevenv first, or use the "Run JS script" / terminal in the Node.js app panel
# so `node`/`npm` are on PATH.
#
# ── Inputs (environment variables) ──────────────────────────────────────────
# Database (either give DATABASE_URL directly, OR the three DB_* parts):
#   DATABASE_URL   mysql://user:pass@localhost:3306/dbname
#   DB_USER, DB_PASSWORD, DB_NAME   (+ optional DB_HOST=localhost, DB_PORT=3306)
# Admin (required):
#   ADMIN_PASSWORD          password for the single admin
# Admin (optional, sensible defaults):
#   ADMIN_EMAIL=khurram@mshh.co   ADMIN_USERNAME=khurram
#   ADMIN_FIRST_NAME=Khurram      ADMIN_LAST_NAME=Admin
# Other (optional):
#   RESET_DATA=1            wipe ALL existing data before seeding (DESTRUCTIVE)
#   NODE_ENV               defaults to production
#   API_BASE_URL / APP_URL / CORS_ORIGINS   default https://task.mico360.com
#   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET  auto-generated if unset (see note)
#
# ── Examples ─────────────────────────────────────────────────────────────────
#   # First deploy, DB created in hPanel, pass its creds + admin password:
#   ADMIN_PASSWORD='Welcome@123' DB_USER='u116607139_tasks' \
#     DB_PASSWORD='YOUR_DB_PASS' DB_NAME='u116607139_tasks' bash deploy.sh
#
#   # Re-deploy where env is already set in hPanel:
#   ADMIN_PASSWORD='Welcome@123' bash deploy.sh
#
#   # Reset to a clean single-account state:
#   RESET_DATA=1 ADMIN_PASSWORD='Welcome@123' bash deploy.sh

set -euo pipefail
cd "$(dirname "$0")"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '\033[1;33m    %s\033[0m\n' "$*"; }

ENV_FILE=".env"

# Load any existing .env so already-configured values are visible to this script.
if [ -f "$ENV_FILE" ]; then set -a; . "./$ENV_FILE"; set +a; fi

# ── 1. Configure the database connection ─────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -n "${DB_USER:-}" ] && [ -n "${DB_PASSWORD:-}" ] && [ -n "${DB_NAME:-}" ]; then
    DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${DB_HOST:-localhost}:${DB_PORT:-3306}/${DB_NAME}"
    export DATABASE_URL
    log "Assembled DATABASE_URL for database '${DB_NAME}' on ${DB_HOST:-localhost}"
  else
    die "No database configured. Set DATABASE_URL, or pass DB_USER + DB_PASSWORD + DB_NAME. (Create the empty MySQL database in hPanel first.)"
  fi
fi

# ── 2. Public URLs + runtime mode ────────────────────────────────────────────
export NODE_ENV="${NODE_ENV:-production}"
export API_BASE_URL="${API_BASE_URL:-https://task.mico360.com}"
export APP_URL="${APP_URL:-https://task.mico360.com}"
export CORS_ORIGINS="${CORS_ORIGINS:-https://task.mico360.com}"

# ── 3. JWT secrets — generate strong ones if not provided ────────────────────
GEN_SECRETS=0
if [ -z "${JWT_ACCESS_SECRET:-}" ]; then
  JWT_ACCESS_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  export JWT_ACCESS_SECRET; GEN_SECRETS=1
fi
if [ -z "${JWT_REFRESH_SECRET:-}" ]; then
  JWT_REFRESH_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  export JWT_REFRESH_SECRET; GEN_SECRETS=1
fi

# ── 4. Persist connection + secrets to .env (git-ignored; the app reads it) ──
#     ADMIN_PASSWORD is intentionally NOT persisted (needed only for the seed).
add_env() { # KEY VALUE — append only if the key isn't already in .env
  local k="$1"; shift; local v="$*"
  touch "$ENV_FILE"
  grep -q "^${k}=" "$ENV_FILE" 2>/dev/null || printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
}
add_env NODE_ENV "$NODE_ENV"
add_env DATABASE_URL "$DATABASE_URL"
add_env API_BASE_URL "$API_BASE_URL"
add_env APP_URL "$APP_URL"
add_env CORS_ORIGINS "$CORS_ORIGINS"
add_env JWT_ACCESS_SECRET "$JWT_ACCESS_SECRET"
add_env JWT_REFRESH_SECRET "$JWT_REFRESH_SECRET"

# ── 5. Admin identity ────────────────────────────────────────────────────────
ADMIN_EMAIL="${ADMIN_EMAIL:-khurram@mshh.co}"
ADMIN_USERNAME="${ADMIN_USERNAME:-khurram}"
ADMIN_FIRST_NAME="${ADMIN_FIRST_NAME:-Khurram}"
ADMIN_LAST_NAME="${ADMIN_LAST_NAME:-Admin}"
[ -n "${ADMIN_PASSWORD:-}" ] || die "Set ADMIN_PASSWORD (the password for ${ADMIN_EMAIL})."

# ── 6. Install deps (force dev deps — needed for tsc/prisma even in production) ─
log "Installing dependencies"
npm install --include=dev --no-audit --no-fund

log "Generating Prisma client"
npx prisma generate

log "Building the app"
npm run build

# ── 7. Configure the database schema ─────────────────────────────────────────
if [ "${RESET_DATA:-0}" = "1" ]; then
  log "RESET_DATA=1 — wiping ALL data and recreating the schema"
  npx prisma migrate reset --force --skip-seed
else
  log "Applying migrations (creating/updating tables)"
  npx prisma migrate deploy
fi

# ── 8. Create the single admin (idempotent — no-op if an admin already exists) ─
log "Ensuring the admin account: ${ADMIN_EMAIL}"
ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_USERNAME="$ADMIN_USERNAME" \
ADMIN_FIRST_NAME="$ADMIN_FIRST_NAME" ADMIN_LAST_NAME="$ADMIN_LAST_NAME" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
node dist/src/scripts/bootstrap.js

# ── 9. Done ──────────────────────────────────────────────────────────────────
log "Deployment complete — restart the Node app in hPanel, then open https://task.mico360.com"
if [ "$GEN_SECRETS" = "1" ]; then
  note "JWT secrets were generated and written to .env."
  note "For stable logins across future re-deploys, copy JWT_ACCESS_SECRET and"
  note "JWT_REFRESH_SECRET from .env into your hPanel Environment Variables —"
  note "otherwise a fresh deploy generates new ones and logs everyone out."
fi
