#!/usr/bin/env bash
#
# deploy.sh — ONE-SHOT deployment for the MICO360 Tasks backend.
#
# Brings a freshly-extracted backend from empty to running, in one command:
#   1. Resolves configuration (command-line variables first, then the existing .env)
#   2. Installs dependencies (incl. build tools)
#   3. Generates the Prisma client and builds the app (dist/)
#   4. Records migrations the database already contains (databases made with `db push`)
#   5. Applies the remaining migrations — or wipes everything first when RESET_DATA=1
#   6. Creates the single admin account (idempotent)
#
# WHERE: run on the SERVER, from the backend app root (folder with package.json +
# prisma/). On Hostinger, run it inside the Node.js app environment — activate the
# app's nodevenv first, or use the terminal in the Node.js app panel so `node`/`npm`
# are on PATH.
#
# ── Inputs (environment variables; values given here always win over .env) ────
# Database (either give DATABASE_URL directly, OR the three DB_* parts):
#   DATABASE_URL   mysql://user:pass@localhost:3306/dbname
#   DB_USER, DB_PASSWORD, DB_NAME   (+ optional DB_HOST=localhost, DB_PORT=3306)
# Admin:
#   ADMIN_PASSWORD          required when no admin exists yet (never stored)
#   ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_FIRST_NAME, ADMIN_LAST_NAME   (optional)
# Other (optional):
#   UPLOAD_DIR              absolute folder for uploaded files; defaults to
#                           $HOME/mico360-data/uploads so redeploys never lose them
#   RESET_DATA=1            wipe ALL data and recreate the schema (DESTRUCTIVE) —
#                           also requires CONFIRM_RESET=<database name>; a mysqldump
#                           backup is taken first (SKIP_BACKUP=1 to skip, not advised)
#   NODE_ENV               defaults to production
#   API_BASE_URL / APP_URL / CORS_ORIGINS   default https://task.mico360.com
#   JWT_ACCESS_SECRET / JWT_REFRESH_SECRET  generated once if unset (see note at the end)
#
# ── Examples ─────────────────────────────────────────────────────────────────
#   # First deploy (empty database created in hPanel):
#   ADMIN_PASSWORD='<a strong password>' DB_USER='u116607139_tasks' \
#     DB_PASSWORD='<database password>' DB_NAME='u116607139_tasks' bash deploy.sh
#
#   # Re-deploy (configuration already in .env or hPanel):
#   bash deploy.sh
#
#   # Reset to a clean single-account state (backs up first):
#   RESET_DATA=1 CONFIRM_RESET=u116607139_tasks ADMIN_PASSWORD='<a strong password>' bash deploy.sh

set -euo pipefail
cd "$(dirname "$0")"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
note() { printf '\033[1;33m    %s\033[0m\n' "$*"; }

command -v node >/dev/null || die "node is not on PATH. Activate the Hostinger Node.js environment first."

ENV_FILE=".env"

# ── .env helpers (never `source` the file: values can contain spaces, <, >, #, $) ──
# Minimal dotenv reader: KEY=value, KEY="value", KEY='value'; comments and blanks ignored.
env_get() {
  [ -f "$ENV_FILE" ] || return 0
  node -e '
    const fs = require("fs");
    const key = process.argv[1];
    for (const raw of fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/)) {
      const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
      if (!m || m[1] !== key) continue;
      let v = (m[2] ?? "").trim();
      if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("\x27") && v.endsWith("\x27"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      process.stdout.write(v);
    }
  ' "$1" "$ENV_FILE"
}

# Insert or replace KEY in .env, quoting the value so dotenv reads it back exactly.
env_set() {
  node -e '
    const fs = require("fs");
    const [key, value, file] = process.argv.slice(1);
    const quoted = value.includes("\x27") ? JSON.stringify(value) : "\x27" + value + "\x27";
    const line = key + "=" + quoted;
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
    const re = new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=");
    let found = false;
    const out = lines.map((l) => (re.test(l) ? ((found = true), line) : l));
    if (!found) { if (out.length && out[out.length - 1] === "") out.pop(); out.push(line, ""); }
    fs.writeFileSync(file, out.join("\n"), { mode: 0o600 });
  ' "$1" "$2" "$ENV_FILE"
}

# Take a value from the caller's environment if set, otherwise from .env.
resolve_var() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    local from_file
    from_file="$(env_get "$name")"
    if [ -n "$from_file" ]; then printf -v "$name" '%s' "$from_file"; fi
  fi
  export "$name"
}

urlencode() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

# ── 1. Database connection ────────────────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  log "Using DATABASE_URL from the command line"
elif [ -n "${DB_USER:-}" ] && [ -n "${DB_PASSWORD:-}" ] && [ -n "${DB_NAME:-}" ]; then
  DATABASE_URL="mysql://$(urlencode "$DB_USER"):$(urlencode "$DB_PASSWORD")@${DB_HOST:-localhost}:${DB_PORT:-3306}/$(urlencode "$DB_NAME")"
  log "Assembled DATABASE_URL for database '${DB_NAME}' on ${DB_HOST:-localhost}"
else
  resolve_var DATABASE_URL
  [ -n "${DATABASE_URL:-}" ] || die "No database configured. Set DATABASE_URL, or pass DB_USER + DB_PASSWORD + DB_NAME. (Create the empty MySQL database in hPanel first.)"
  log "Using DATABASE_URL from .env"
fi
case "$DATABASE_URL" in mysql://*) ;; *) die "DATABASE_URL must start with mysql:// (this app uses MySQL in production)." ;; esac
export DATABASE_URL

# ── 2. Public URLs, runtime mode, secrets, uploads ────────────────────────────
for v in NODE_ENV API_BASE_URL APP_URL CORS_ORIGINS JWT_ACCESS_SECRET JWT_REFRESH_SECRET UPLOAD_DIR; do resolve_var "$v"; done
export NODE_ENV="${NODE_ENV:-production}"
export API_BASE_URL="${API_BASE_URL:-https://task.mico360.com}"
export APP_URL="${APP_URL:-https://task.mico360.com}"
export CORS_ORIGINS="${CORS_ORIGINS:-https://task.mico360.com}"

GEN_SECRETS=0
if [ -z "${JWT_ACCESS_SECRET:-}" ]; then
  JWT_ACCESS_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")"; GEN_SECRETS=1
fi
if [ -z "${JWT_REFRESH_SECRET:-}" ]; then
  JWT_REFRESH_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")"; GEN_SECRETS=1
fi
export JWT_ACCESS_SECRET JWT_REFRESH_SECRET

# Uploaded files must live outside the app folder: Hostinger can redeploy into a fresh folder.
case "${UPLOAD_DIR:-}" in
  /*) ;;
  *)
    OLD_UPLOADS="${UPLOAD_DIR:-uploads}"
    UPLOAD_DIR="${HOME}/mico360-data/uploads"
    mkdir -p "$UPLOAD_DIR"
    if [ -d "$OLD_UPLOADS" ] && [ -n "$(ls -A "$OLD_UPLOADS" 2>/dev/null)" ]; then
      log "Moving existing uploads from ./$OLD_UPLOADS to $UPLOAD_DIR"
      cp -Rn "$OLD_UPLOADS"/. "$UPLOAD_DIR"/
    fi
    ;;
esac
mkdir -p "$UPLOAD_DIR"
export UPLOAD_DIR

# ── 3. Persist configuration to .env (git-ignored; the app reads it on boot) ──
#     ADMIN_PASSWORD is intentionally NOT persisted (needed only for the admin seed).
for v in NODE_ENV DATABASE_URL API_BASE_URL APP_URL CORS_ORIGINS JWT_ACCESS_SECRET JWT_REFRESH_SECRET UPLOAD_DIR; do
  env_set "$v" "${!v}"
done
chmod 600 "$ENV_FILE" 2>/dev/null || true

# ── 4. Install, generate, build ───────────────────────────────────────────────
log "Installing dependencies"
if [ -f package-lock.json ]; then
  npm ci --include=dev --no-audit --no-fund
else
  npm install --include=dev --no-audit --no-fund
fi

log "Generating Prisma client"
npx prisma generate

log "Building the app"
npm run build

# ── 5. Database schema ────────────────────────────────────────────────────────
DB_NAME_FROM_URL="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))' "$DATABASE_URL")"
DB_HOST_FROM_URL="$(node -e 'const u=new URL(process.argv[1]); process.stdout.write(u.hostname + ":" + (u.port || "3306"))' "$DATABASE_URL")"

if [ "${RESET_DATA:-0}" = "1" ]; then
  log "RESET_DATA=1 — this will DELETE ALL DATA in database '${DB_NAME_FROM_URL}' on ${DB_HOST_FROM_URL}"
  [ "${CONFIRM_RESET:-}" = "$DB_NAME_FROM_URL" ] || die "Refusing to reset. Re-run with CONFIRM_RESET=${DB_NAME_FROM_URL} to confirm the target database."
  if [ "${SKIP_BACKUP:-0}" != "1" ]; then
    command -v mysqldump >/dev/null || die "mysqldump is not available, so no backup can be taken. Install it, or set SKIP_BACKUP=1 to reset without a backup."
    mkdir -p "${HOME}/mico360-data/backups"
    BACKUP="${HOME}/mico360-data/backups/${DB_NAME_FROM_URL}-$(date +%Y%m%d-%H%M%S).sql"
    log "Backing up to $BACKUP"
    node -e '
      const u = new URL(process.argv[1]);
      process.stdout.write([u.hostname, u.port || "3306", decodeURIComponent(u.username), decodeURIComponent(u.password), decodeURIComponent(u.pathname.slice(1))].join("\n"));
    ' "$DATABASE_URL" | {
      read -r H; read -r P; read -r U; read -r PW; read -r D
      MYSQL_PWD="$PW" mysqldump --single-transaction --routines -h "$H" -P "$P" -u "$U" "$D" > "$BACKUP"
    }
    note "Backup written ($(wc -c < "$BACKUP") bytes)."
  fi
  npx prisma migrate reset --force --skip-seed
else
  log "Checking for migrations the database already contains"
  BASELINE="$(node scripts/baseline-migrations.mjs)"
  if [ -n "$BASELINE" ]; then
    while IFS= read -r m; do
      [ -n "$m" ] || continue
      note "Recording existing migration: $m"
      npx prisma migrate resolve --applied "$m"
    done <<< "$BASELINE"
  fi
  log "Applying migrations (creating/updating tables)"
  npx prisma migrate deploy
fi

# ── 6. Admin account (idempotent — no-op if an active admin already exists) ───
ADMIN_EMAIL="${ADMIN_EMAIL:-khurram@prolens-team.com}"
ADMIN_USERNAME="${ADMIN_USERNAME:-khurram}"
ADMIN_FIRST_NAME="${ADMIN_FIRST_NAME:-Khurram}"
ADMIN_LAST_NAME="${ADMIN_LAST_NAME:-Admin}"
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  log "Ensuring the admin account: ${ADMIN_EMAIL}"
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_USERNAME="$ADMIN_USERNAME" \
  ADMIN_FIRST_NAME="$ADMIN_FIRST_NAME" ADMIN_LAST_NAME="$ADMIN_LAST_NAME" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  node dist/src/scripts/bootstrap.js
else
  note "ADMIN_PASSWORD not given — skipping admin creation (fine when an admin already exists)."
fi

# ── 7. Done ───────────────────────────────────────────────────────────────────
log "Deployment complete — restart the Node app in hPanel, then open ${APP_URL}"
note "Uploads are stored in ${UPLOAD_DIR} (outside the app folder; include it in backups)."
if [ "$GEN_SECRETS" = "1" ]; then
  note "JWT secrets were generated and written to .env."
  note "For stable logins across future re-deploys, copy JWT_ACCESS_SECRET and"
  note "JWT_REFRESH_SECRET from .env into your hPanel Environment Variables —"
  note "otherwise a deploy into a fresh folder generates new ones and logs everyone out."
fi
