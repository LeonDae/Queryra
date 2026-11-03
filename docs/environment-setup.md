# Environment setup

`.env.example` is the tracked variable inventory. Keep `.env.local` private; it was intentionally not inspected or changed for this milestone. Put replacement credentials there manually. `.gitignore` and `.dockerignore` exclude environment-specific files. Never set a service-role/secret key in `NEXT_PUBLIC_*`.

## Values to enter

| Variable | Required | Source / notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes for Auth | New Supabase project → Project Settings → API → Project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes for Auth | Same project API settings → publishable key. It is intentionally public client configuration; never use a secret/service-role key. |
| `DATABASE_TARGET` | Yes; defaults `local` in development and `hosted` in production | Set `local` for loopback Docker PostgreSQL; set `hosted` only when deliberately using your new Supabase Postgres project. |
| `DATABASE_URL` | Retained local owner/maintenance URL; not used by application role pools | Keep it pointed at local Docker PostgreSQL. Queryra never falls back to it for reader or CSV ingestion connections. |
| `DATABASE_LOCAL_READER_URL` | Required for local workspace queries | Local `queryra_reader` PostgreSQL URL. It must be separate from the owner/admin URL and pass runtime checks for NOINHERIT, no role memberships, transaction read-only, no `public` CREATE, and no table/sequence write grants. |
| `DATABASE_LOCAL_ADMIN_URL` | Required for local CSV upload | Separate `queryra_ingest` local URL. It must be non-superuser and no-BYPASSRLS; it can create CSV tables and is subject to their forced RLS policies. |
| `DATABASE_READER_URL` | Required when `DATABASE_TARGET=hosted` | Hosted PostgreSQL URI for a separately provisioned, non-superuser, non-`BYPASSRLS` role with SELECT on intended workspace datasets and metadata needed by Queryra. Obtain it from Supabase Connect after manually provisioning the role. |
| `DATABASE_ADMIN_URL` | Required when `DATABASE_TARGET=hosted` and CSV upload is enabled | Distinct restricted ingestion role, no superuser or `BYPASSRLS`; it creates workspace-prefixed upload tables and writes only during the CSV route. Obtain it from Supabase Connect after role setup. Never use Supabase's default `postgres` identity. |
| `GOOGLE_API_KEY` | Required only for Gemini generation and Gemini review in hybrid mode | Google AI Studio / Google project credentials. Server-side secret; never prefix with `NEXT_PUBLIC_`. |
| `GEMINI_MODEL` | Optional | Model identifier available to the key; default `models/gemini-2.5-flash`. |
| `OLLAMA_BASE_URL` | Optional | Ollama endpoint reachable by the Next server; default `http://127.0.0.1:11434`. |
| `OLLAMA_MODEL` | Optional | Locally installed model; default `qwen2.5-coder:7b`. |
| `OLLAMA_DOCKER_BASE_URL` | Optional, Compose only | Address reachable from the container; default `http://host.docker.internal:11434`. |
| `DB_POOL_MAX` | Optional | Each-role pool size; default 5, maximum 50. |
| `DB_POOL_TIMEOUT_MS` | Optional | Pool connection timeout; default 5000, maximum 60000. |
| `DB_STATEMENT_TIMEOUT_MS` | Optional | SQL statement timeout; default 15000, maximum 120000. |
| `DB_QUERY_CONCURRENCY` | Optional | Read query concurrency; default follows pool max. |
| `DB_INGEST_CONCURRENCY` | Optional | CSV ingestion concurrency; default 1. |
| `MAX_RESULT_BYTES` | Optional | Query response cap; default 2000000, maximum 20000000. |
| `GEMINI_REQUESTS_PER_MINUTE` | Optional | Process-local request cap; default 20. |
| `OLLAMA_REQUESTS_PER_MINUTE` | Optional | Process-local request cap; default 20. |
| `PROVIDER_CONCURRENCY` | Optional | Per-process provider concurrency; default 2. |
| `CSV_UPLOADS_PER_10_MINUTES` | Optional | Process-local upload cap; default 3. |
| `PGSSL` | Optional | Leave blank for normal TLS behavior. `disable` is for trusted local PostgreSQL only. |
| `QUERYRA_POSTGRES_PASSWORD` | Compose only | Password for the local Compose owner; development only. Never reuse outside local. |
| `QUERYRA_POSTGRES_READER_PASSWORD` | Required for local Compose role initialization | Generated local-only password for `queryra_reader`; use URL-safe characters so it can appear in the local connection URL without encoding ambiguity. |
| `QUERYRA_POSTGRES_INGEST_PASSWORD` | Required for local Compose role initialization | A different generated local-only password for `queryra_ingest`; use URL-safe characters. |
| `QUERYRA_POSTGRES_PORT` | Compose only | Host port for local PostgreSQL; default 55432. |
| `QUERYRA_PORT` | Compose only | Host port for Queryra; default 3000. |

## Local development and Compose

Keep `DATABASE_TARGET=local` explicitly. Keep `DATABASE_URL` on the local Docker database, but note application queries and uploads do not use it. Set `QUERYRA_POSTGRES_READER_PASSWORD` and `QUERYRA_POSTGRES_INGEST_PASSWORD` to different local-only values, then set `DATABASE_LOCAL_READER_URL` and `DATABASE_LOCAL_ADMIN_URL` to the matching `queryra_reader` and `queryra_ingest` URLs. `.env.example` shows the URI shape and Next.js variable expansion. Existing `.env.local` values were not edited; add these four variables manually if absent.

Compose pins `DATABASE_TARGET=local` and constructs internal role URLs for the Compose `postgres` service from the two password variables. It does not pass hosted `DATABASE_URL`, `DATABASE_READER_URL`, or `DATABASE_ADMIN_URL` to the app container. The SQL initialization script creates or updates `queryra_reader` and `queryra_ingest`, removes their direct role memberships, resets their attributes/grants, and sets the reader to transaction-read-only. It runs automatically only when Postgres initializes an empty data directory. Do not delete a persistent volume to rerun initialization.

For `npm run dev`, after setting the four local role variables, start the local database with `docker compose --env-file .env.local up -d postgres`. Supabase project URL/publishable key are read by the Auth client at runtime in development. If the database volume already exists, update role setup without resetting data by rerunning the idempotent script manually:

```powershell
docker compose --env-file .env.local exec -T postgres psql -v ON_ERROR_STOP=1 -U queryra_owner -d queryra -f /docker-entrypoint-initdb.d/10-queryra-roles.sql
```

This command is for you to run manually after reviewing it; it was not run as part of this task. After changing the role passwords, restart the app process so its pools use the new URLs.

## Hosted database selection

To intentionally use hosted PostgreSQL, set `DATABASE_TARGET=hosted` and provide both `DATABASE_READER_URL` and `DATABASE_ADMIN_URL`. `DATABASE_URL` remains local and is never a hosted fallback. The reader and ingestion credentials are server-only. The health endpoint reports a sanitized connection status and checks the reader role is not superuser/`BYPASSRLS`; it does not prove all grants or RLS policies are correct.

Before hosted CSV/query use, apply the reviewed `supabase/migrations/20261025000100_queryra_workspaces.sql` manually, provision different restricted Postgres roles, grant reader access and ingestion privileges/default privileges, and verify RLS behavior. Queryra does not create roles or apply migrations. The migration has not been executed. Do not use a service-role key.

## Authentication and redirect setup

Supabase Auth uses `@supabase/ssr` and `@supabase/supabase-js` with cookie-based sessions. In Supabase Authentication URL Configuration, set the local Site URL (for example `http://localhost:3000`) and allow both local callbacks `http://localhost:3000/auth/callback` and `http://127.0.0.1:3000/auth/callback`; add the deployed origin/callback only when you deploy. Enable email/password as desired. Email confirmation determines whether signup signs in immediately or asks the user to confirm first. The app creates a personal workspace on the first authenticated dataset API request through the migration's `create_workspace` RPC.

In Docker Compose, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are passed as build args because Next.js embeds public client configuration into the browser bundle. They are public values and not secrets. They are also passed at runtime for server-side Auth. `GOOGLE_API_KEY` remains server-side and is passed only at runtime. Database URLs are runtime-only and are not Docker build arguments. Do not provide server secrets in build args.

## Existing fixed limits

CSV uploads are limited in code to 10 MiB, 100,000 data rows and 200 columns; JSON bodies are capped at 256 KiB. Gemini/Ollama timeouts are 60/120 seconds. Request-rate and concurrency counters remain single-process controls, not user quotas and not shared across replicas.

Next.js loads its root `.env*` files automatically; no custom dotenv loader or `next.config.js` environment override is used. `npm test` uses Node's test runner and does not load `.env.local` automatically.
