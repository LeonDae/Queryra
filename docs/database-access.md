# PostgreSQL access roles (manual setup)

Queryra currently uses one configured analytics PostgreSQL database in local development. In production, configure separate credentials:

- `DATABASE_READER_URL`: `SELECT` access only, used for schema inspection and query execution.
- `DATABASE_ADMIN_URL`: restricted ingestion account used only to create and populate uploaded CSV tables.

The production app refuses to fall back to `DATABASE_URL` for either role. Do not place a PostgreSQL owner, Supabase service-role, or superuser URL in `DATABASE_READER_URL`.

## Before granting access

The repository cannot verify which database owns the analytics tables, which roles own existing tables, whether row-level security is enabled, or which Supabase-managed role features are available. A database administrator must inspect the target database and adapt the grants below. These example grants apply only to a single-user/local installation where all listed public-schema data is intended to be visible. They do not provide workspace isolation and must not be used as a multi-tenant policy.

1. Choose the analytics database and verify which `public` tables/views Queryra is allowed to read. Current schema introspection, SQL qualification, and CSV import are implemented only for `public`.
2. Confirm table/view owners and RLS policies; verify whether Supabase role creation is available for the project.
3. Create unique credentials in the database's secret-management workflow.
4. Grant the reader only the required schema usage and relation reads. Grant the ingestion account only schema create and the table insert permissions required by the CSV path.
5. Grant reader access to uploaded tables created by the ingestion owner using default privileges for that owner, or move to a dedicated dataset schema and explicitly grant there.
6. Test the roles manually: reader writes/DDL must fail; ingestion cannot read unrelated data or administer the database.

Example policy shape for DBA review (not an executable migration and not run by Queryra). The administrator should supply passwords through their secret-management workflow and verify which database grants are required before creating login roles:

```sql
-- Replace the role names and schema after reviewing the database.
CREATE ROLE queryra_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO queryra_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO queryra_reader;
ALTER ROLE queryra_reader SET default_transaction_read_only = on;
ALTER ROLE queryra_reader SET statement_timeout = '15s';

CREATE ROLE queryra_ingest LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE, CREATE ON SCHEMA public TO queryra_ingest;
-- Grant default SELECT on imported tables to the reader only when the ingestion
-- role owns those tables and the reader is intended to read those datasets.
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  GRANT SELECT ON TABLES TO queryra_reader;
```

The ingestion account should be used only by the CSV route. Because it owns the tables it creates, it can alter or drop those tables; keep the account limited to an isolated database/schema, and do not reuse it for query execution. The current CSV implementation creates tables in `public`, while SQL execution is explicitly qualified to `public`. Changing to a dedicated dataset schema requires an implementation change and should be done before enabling multi-workspace ingestion. The local Docker Compose role bootstrap is in `db/init-local-roles.sql`; it uses development-only passwords and runs only for an empty local PostgreSQL volume. This code does not attempt to create production roles or modify production grants automatically.
