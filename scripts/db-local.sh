#!/usr/bin/env bash
# Creates a local PostgreSQL database for development (no Supabase stack needed).
# Requires a running local PostgreSQL 15+ and permission to run psql as the postgres superuser.
set -euo pipefail
DB="${UCS_DB_NAME:-ucs}"
APP_ROLE="${UCS_DB_ROLE:-ucs_app}"
APP_PASS="${UCS_DB_PASSWORD:-ucs_local_dev}"
PSQL="${PSQL_SUPER:-su postgres -c}"
run() { $PSQL "psql -v ON_ERROR_STOP=1 $1"; }

if [ "${1:-}" = "--reset" ]; then run "-c 'drop database if exists $DB'"; fi
run "-tc \"select 1 from pg_roles where rolname='$APP_ROLE'\"" | grep -q 1 \
  || run "-c \"create role $APP_ROLE login password '$APP_PASS' bypassrls createrole\""
run "-tc \"select 1 from pg_database where datname='$DB'\"" | grep -q 1 \
  || run "-c 'create database $DB owner $APP_ROLE'"
cat "$(dirname "$0")/local-shim.sql" | $PSQL "psql -v ON_ERROR_STOP=1 -d $DB -q"
run "-d $DB -qc 'grant authenticated, anon, service_role to $APP_ROLE; grant all on schema auth to $APP_ROLE; grant all on all tables in schema auth to $APP_ROLE'"
echo "Local database ready: postgres://$APP_ROLE:$APP_PASS@127.0.0.1:5432/$DB"
