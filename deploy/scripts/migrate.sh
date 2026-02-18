#!/usr/bin/env bash
# =============================================================================
# smoltbot Database Migration Runner
# =============================================================================
# Applies SQL migration files from database/migrations/ to PostgreSQL in
# alphabetical order. Tracks applied migrations in the _schema_migrations
# table to ensure idempotent execution.
#
# Usage:
#   ./migrate.sh [--dry-run]
#
# Environment variables (provide POSTGRES_URL or individual PG vars):
#   POSTGRES_URL     — Full connection string (postgres://user:pass@host:port/db)
#   PGHOST           — PostgreSQL host       (default: localhost)
#   PGPORT           — PostgreSQL port       (default: 5432)
#   PGDATABASE       — Database name         (default: smoltbot)
#   PGUSER           — Database user         (default: smoltbot)
#   PGPASSWORD       — Database password
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/app/database/migrations}"
DRY_RUN=false
APPLIED=0
SKIPPED=0
FAILED=0

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --help|-h)
      echo "Usage: $0 [--dry-run]"
      echo ""
      echo "Applies SQL migrations from ${MIGRATIONS_DIR} to PostgreSQL."
      echo ""
      echo "Options:"
      echo "  --dry-run   Show which migrations would be applied without executing them"
      echo "  --help      Show this help message"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Build connection string
# ---------------------------------------------------------------------------
if [[ -n "${POSTGRES_URL:-}" ]]; then
  PSQL_CONN="${POSTGRES_URL}"
else
  _host="${PGHOST:-localhost}"
  _port="${PGPORT:-5432}"
  _db="${PGDATABASE:-smoltbot}"
  _user="${PGUSER:-smoltbot}"
  _pass="${PGPASSWORD:-}"

  if [[ -z "${_pass}" ]]; then
    echo "ERROR: Either POSTGRES_URL or PGPASSWORD must be set." >&2
    exit 1
  fi

  PSQL_CONN="postgres://${_user}:${_pass}@${_host}:${_port}/${_db}"
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info()  { echo "[migrate] $(date -u '+%Y-%m-%dT%H:%M:%SZ') INFO  $*"; }
log_warn()  { echo "[migrate] $(date -u '+%Y-%m-%dT%H:%M:%SZ') WARN  $*" >&2; }
log_error() { echo "[migrate] $(date -u '+%Y-%m-%dT%H:%M:%SZ') ERROR $*" >&2; }

run_sql() {
  psql "${PSQL_CONN}" --no-psqlrc --single-transaction -v ON_ERROR_STOP=1 -q "$@"
}

run_sql_query() {
  psql "${PSQL_CONN}" --no-psqlrc -v ON_ERROR_STOP=1 -t -A -c "$1"
}

# ---------------------------------------------------------------------------
# Wait for database to be reachable (up to 30 seconds)
# ---------------------------------------------------------------------------
wait_for_db() {
  local retries=15
  local wait_seconds=2

  log_info "Waiting for database to be reachable..."

  for ((i = 1; i <= retries; i++)); do
    if run_sql_query "SELECT 1" >/dev/null 2>&1; then
      log_info "Database is reachable."
      return 0
    fi
    log_info "Attempt ${i}/${retries} — database not ready, retrying in ${wait_seconds}s..."
    sleep "${wait_seconds}"
  done

  log_error "Database is not reachable after $((retries * wait_seconds))s. Aborting."
  exit 1
}

# ---------------------------------------------------------------------------
# Ensure _schema_migrations tracking table exists
# ---------------------------------------------------------------------------
ensure_migrations_table() {
  log_info "Ensuring _schema_migrations table exists..."

  run_sql_query "
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      filename    TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  " >/dev/null
}

# ---------------------------------------------------------------------------
# Check if a migration has already been applied
# ---------------------------------------------------------------------------
is_applied() {
  local filename="$1"
  local result
  result=$(run_sql_query "SELECT 1 FROM _schema_migrations WHERE filename = '${filename}' LIMIT 1;")
  [[ "${result}" == "1" ]]
}

# ---------------------------------------------------------------------------
# Apply a single migration inside a transaction
# ---------------------------------------------------------------------------
apply_migration() {
  local filepath="$1"
  local filename
  filename=$(basename "${filepath}")

  if is_applied "${filename}"; then
    log_info "SKIP  ${filename} (already applied)"
    SKIPPED=$((SKIPPED + 1))
    return 0
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "DRY   ${filename} (would be applied)"
    APPLIED=$((APPLIED + 1))
    return 0
  fi

  log_info "APPLY ${filename}..."

  # Build a combined SQL payload that wraps the migration and the tracking
  # insert in one transaction. psql --single-transaction ensures atomicity.
  local tmp
  tmp=$(mktemp)
  {
    echo "BEGIN;"
    cat "${filepath}"
    echo ""
    echo "INSERT INTO _schema_migrations (filename) VALUES ('${filename}');"
    echo "COMMIT;"
  } > "${tmp}"

  if psql "${PSQL_CONN}" --no-psqlrc -v ON_ERROR_STOP=1 -q -f "${tmp}"; then
    log_info "OK    ${filename}"
    APPLIED=$((APPLIED + 1))
  else
    log_error "FAIL  ${filename}"
    FAILED=$((FAILED + 1))
    rm -f "${tmp}"
    return 1
  fi

  rm -f "${tmp}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  log_info "=== smoltbot migration runner ==="
  log_info "Migrations directory: ${MIGRATIONS_DIR}"
  [[ "${DRY_RUN}" == "true" ]] && log_info "Mode: DRY RUN (no changes will be made)"

  # Validate migrations directory
  if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
    log_error "Migrations directory not found: ${MIGRATIONS_DIR}"
    exit 1
  fi

  # Collect migration files (*.sql, sorted alphabetically)
  local files=()
  while IFS= read -r -d '' f; do
    files+=("${f}")
  done < <(find "${MIGRATIONS_DIR}" -maxdepth 1 -name '*.sql' -print0 | sort -z)

  if [[ ${#files[@]} -eq 0 ]]; then
    log_warn "No migration files found in ${MIGRATIONS_DIR}"
    exit 0
  fi

  log_info "Found ${#files[@]} migration file(s)."

  wait_for_db
  ensure_migrations_table

  for filepath in "${files[@]}"; do
    apply_migration "${filepath}" || {
      log_error "Migration failed. Stopping."
      log_info "Summary: ${APPLIED} applied, ${SKIPPED} skipped, ${FAILED} failed."
      exit 1
    }
  done

  log_info "=== Migration complete ==="
  log_info "Summary: ${APPLIED} applied, ${SKIPPED} skipped, ${FAILED} failed."

  if [[ "${DRY_RUN}" == "true" ]]; then
    log_info "(Dry run — no changes were made to the database.)"
  fi
}

main
