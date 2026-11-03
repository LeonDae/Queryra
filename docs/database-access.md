# Database roles and workspace isolation

`DATABASE_TARGET` makes the database destination explicit. `local` (development default) requires `DATABASE_LOCAL_READER_URL` and `DATABASE_LOCAL_ADMIN_URL`. The app never falls back to `DATABASE_URL` for either role. `hosted` uses `DATABASE_READER_URL` and `DATABASE_ADMIN_URL`; it never falls back to the local URL. In production, `DATABASE_TARGET` defaults to `hosted`.

The app verifies that each selected direct PostgreSQL role is neither a superuser nor marked `BYPASSRLS`, nor able to `SET ROLE` to a bypass role. For the reader it additionally checks `NOINHERIT`, zero role memberships, the `default_transaction_read_only=on` setting, no `CREATE` on `public`, and no effective write grants on public tables or sequences. These checks run once per process and are cached; restart after changing role attributes or grants. Do not use the database owner or Supabase's default `postgres` identity as an application role.

## Local Docker roles

The repeatable local role setup is `db/init-local-roles.sql`, mounted into the local PostgreSQL container. The exact roles are `queryra_reader` and `queryra_ingest`:

- `queryra_reader`: `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, no role memberships, no database/schema create privilege, transaction-read-only by default, and a 15-second statement timeout. It has `USAGE` on `public` and `SELECT` only on existing `qr_<32-hex-workspace-id>_...` tables. Default privileges grant it SELECT on future tables created by `queryra_ingest`. No table/sequence write grants are made.
- `queryra_ingest`: distinct `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, and no role memberships. It has `CONNECT`, `USAGE` and `CREATE` on `public`, but no grants on pre-existing tables. It owns CSV tables it creates; Queryra applies `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a workspace-context policy within the same transaction.

The `public` schema's `CREATE` grant is necessary because the current CSV code creates tables there. The local bootstrap revokes legacy `CREATE` from `PUBLIC` so it cannot leak to the reader; the database owner retains its ownership privileges. Consequently, the ingestion login can create objects and alter/drop objects it owns; the app never gives user-generated SQL this login. SQL grants cannot constrain `CREATE` to only CSV table names, so fully narrowing ingestion requires changing the upload architecture (for example, controlled per-workspace schemas or a carefully scoped database function). New local-only passwords are passed through `QUERYRA_POSTGRES_READER_PASSWORD` and `QUERYRA_POSTGRES_INGEST_PASSWORD`; neither is stored in the SQL file. Compose requires both and builds the app's role URLs from them. Use different, strong URL-safe strings. For `npm run dev`, set `DATABASE_LOCAL_READER_URL` and `DATABASE_LOCAL_ADMIN_URL` to the same role credentials with host `127.0.0.1` and the configured local port.

Postgres initialization scripts run only for a new empty data directory. For an existing volume, do not remove or reset it: after adding both passwords to `.env.local`, manually rerun the mounted script with the documented `docker compose ... psql -f /docker-entrypoint-initdb.d/10-queryra-roles.sql` command in `docs/environment-setup.md`. This resets only the two Queryra role passwords/attributes/memberships and their grants/default privileges; it does not drop or rewrite table data. No database command was run for this task.

## Supabase Auth vs database authorization

Supabase Auth verifies a user's signed session using `auth.getClaims()`. Workspace membership is separately read through the user's Supabase session and protected by RLS on `public.workspace_members`. The app does not accept a user ID or workspace ID from the browser to select the data scope. If the user has no workspace, it calls the reviewed `create_workspace` RPC, which binds ownership to `auth.uid()`.

Direct `pg` connections do not inherit the Supabase JWT. After membership verification, Queryra scopes table discovery by a full workspace UUID prefix, sets a transaction-local `app.workspace_id` for query execution, and creates each uploaded table with `workspace_id`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy that checks the transaction context. Both reader and ingestion roles must lack `BYPASSRLS`; user SQL cannot call `set_config`, and the database role credentials remain server-only. These protections are active only after the migration has been applied and restricted roles/grants are configured and verified.

The workspace migration is applied to the Supabase project used for Auth, not automatically to local Docker PostgreSQL. `DATABASE_TARGET=local` keeps uploaded dataset tables in local Docker PostgreSQL while Supabase stores Auth/workspace membership metadata. Local PostgreSQL health can therefore be `UP` while `/tables`, `/schema`, and CSV upload return a workspace configuration error because the Supabase migration is absent. A valid workspace with no uploaded datasets instead returns an empty table/schema result.

## Fresh project setup required before data operations

The version-controlled proposal at `supabase/migrations/20261025000100_queryra_workspaces.sql` creates workspace metadata, RLS, and a safe workspace bootstrap RPC. It has not been run. Review and apply it manually to the fresh project.

### Manual Supabase Dashboard application

Prerequisites: confirm the Dashboard is for the fresh Supabase project whose URL and publishable key are configured for Queryra Auth; confirm `public.workspaces`, `public.workspace_members`, `app_private.user_workspace_ids()`, and `public.create_workspace(text)` are absent or match this migration; and review the complete migration file. This migration uses `CREATE TABLE IF NOT EXISTS` and replaces its named policies/functions, but it does not drop tables, remove rows, or depend on the historical demo tables. Do not use it against a project where same-named objects have an unknown shape without reviewing them first.

1. Open that project in the Supabase Dashboard, go to **SQL Editor**, create a new query, and paste the complete contents of `supabase/migrations/20261025000100_queryra_workspaces.sql`.
2. Review the target project shown in the Dashboard, then run the query once. The migration is transaction-wrapped; confirm the editor reports successful completion.
3. In **Table Editor**, confirm `public.workspaces` and `public.workspace_members` exist and RLS is enabled for both. In **Database → Functions**, confirm `public.create_workspace(workspace_name text)` exists. The SQL policies restrict membership reads to the signed-in user; workspace reads require membership.
4. Sign in through Queryra. The first authenticated `/tables` or `/schema` request should create one owned workspace through the RPC if the account has no membership. A valid workspace with no uploads should return an empty list/schema.

Applying through SQL Editor does not record the file in Supabase CLI migration history. If you later adopt `supabase db push` or migration-history commands, reconcile this version as already applied before pushing; do not blindly replay it against objects with a different shape. No SQL or Dashboard operation was performed during this task.

Then provision two separate PostgreSQL login roles through the supported Supabase database role workflow:

- Reader role: `NOSUPERUSER NOBYPASSRLS`, read-only, with `USAGE` on `public`, SELECT on authorized tables, and visibility for Queryra's information-schema discovery.
- Ingestion role: `NOSUPERUSER NOBYPASSRLS`, separate credentials, minimum `USAGE`/`CREATE` and insert/create privileges required for CSV tables. It is the owner of tables it creates; `FORCE ROW LEVEL SECURITY` makes the owner subject to those table policies.
- Configure default privileges for the ingestion table owner to grant SELECT to the reader on future upload tables. Confirm that the reader is not the table owner and neither role inherits a bypass role.

The application does not create these database roles, passwords, grants, or default privileges. The following is a review template, not an executed migration; replace the database name and enter newly generated passwords only in the Supabase SQL editor/secure administration workflow:

```sql
-- Provision roles before setting DATABASE_TARGET=hosted.
CREATE ROLE queryra_reader LOGIN PASSWORD '<generate-and-enter-manually>'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE queryra_ingest LOGIN PASSWORD '<generate-a-different-password>'
  NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE postgres TO queryra_reader, queryra_ingest;
GRANT USAGE ON SCHEMA public TO queryra_reader;
GRANT USAGE, CREATE ON SCHEMA public TO queryra_ingest;
ALTER ROLE queryra_reader SET default_transaction_read_only = on;
ALTER ROLE queryra_reader SET statement_timeout = '15s';
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  GRANT SELECT ON TABLES TO queryra_reader;
```

Copy the connection URLs for these roles from Supabase Connect. If the connection uses the shared pooler, use its session mode for the persistent Node `pg.Pool`; use the exact host and username Supabase provides. Percent-encode reserved characters in generated passwords before placing them in URLs. Do not add the passwords to this repository. Manually verify using two test users that each sees only their own workspace-prefixed datasets and cannot query another workspace. Test that missing `app.workspace_id`, an incorrect workspace context, and attempts to insert outside the user's scope are rejected by PostgreSQL RLS.

## Dataset notes and residual gaps

Only tables beginning `qr_<full-workspace-uuid>_` are discoverable to a workspace. Existing trial/demo tables such as `uploaded_table` and `wallpaper_transactions` are not included in authenticated user schema discovery. If a synthetic demo is added later, it needs an explicit read-only shared-demo policy and separate product decision; do not expose old data by removing the prefix filter.

The deployment currently provides one default workspace per signed-in user and no workspace picker or collaboration UI. Queryra's direct reader/admin credentials are shared server secrets; server authorization and RLS provide row isolation, but leaked credentials could allow a caller to forge the custom PostgreSQL GUC. Limit network access and protect those credentials. Workspace quota/billing enforcement is not implemented. The process-local rate limits are not distributed quotas. Verify role behavior and RLS against the actual project before production use.
