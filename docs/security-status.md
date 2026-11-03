# Security and deployment status

## Supported deployment scope today

Email/password Supabase Auth, SSR cookie refresh, server-verified identity, protected application pages and data endpoints, first-workspace ownership, membership checks, and workspace-scoped CSV table/RLS context are implemented. The `npm run dev` and `npm start` scripts bind to `127.0.0.1`. Production use is not verified: the workspace migration is only a proposal, hosted roles/grants have not been provisioned, and no live Supabase integration test was run.

Protected data operations require the version-controlled workspace migration and restricted reader/ingestion roles. Until those are applied and tested, workspace APIs fail closed when authorization metadata is absent. Public SaaS deployment is not supported until the manual database prerequisites and two-user isolation checks pass.

## Queryra Web guest sessions

The public landing-page composer uses a separate guest workflow. It stores the uploaded CSV/XLSX worksheet as a normalized temporary CSV under the server OS temporary directory, addressed by a random ID in an HttpOnly, SameSite cookie signed with a process-local secret. Files are size/schema checked, query execution uses a fresh in-memory DuckDB instance, and session files are removed after 30 minutes of inactivity by periodic and request-time cleanup. The guest path does not call `requireWorkspace`, write PostgreSQL tables, or create dataset-history records. Only the question and discovered column/type schema are sent to Gemini; the uploaded rows are not sent to the provider.

This implementation is suitable for local development and a single Node.js process. A multi-instance deployment needs shared session storage, a stable secret-management-backed signing key, and coordinated expiry/cleanup; otherwise requests routed to another process cannot validate the cookie or find the temp file. Temporary local disk is not durable storage and should not be treated as an account data store. These limitations do not change the separate authenticated workspace API, which continues to enforce Supabase membership and database RLS.

The Morjuis typeface is loaded from the developer's installed system font using CSS `local()` sources. It is not bundled, so visitors without Morjuis installed will not see that face. Obtain and verify a webfont redistribution license before bundling it for public deployment.

## Implemented SQL protections

- PostgreSQL-aware AST parsing with a pinned parser version; parse errors, multiple statements, non-SELECT statements, modifying CTEs, non-public schemas, unknown relations, row-locking clauses, and selected dangerous functions are rejected.
- Base relations are schema-qualified and the transaction search path is pinned to `pg_catalog`; custom functions in `public` cannot resolve through the query's search path.
- Query execution uses an explicit read-only transaction, server-controlled 15-second statement timeout (configurable up to 120 seconds), 1,000-row response cap, 2 MiB serialized result cap by default, bounded connection pool, and a process-local immediate concurrency cap (`DB_QUERY_CONCURRENCY`, no greater than `DB_POOL_MAX`). CSV ingestion has its own process-local cap (`DB_INGEST_CONCURRENCY`, default 1).
- Production requires separate reader and CSV-ingestion database URLs. Local development requires `DATABASE_LOCAL_READER_URL` and `DATABASE_LOCAL_ADMIN_URL`; application queries/uploads never fall back to `DATABASE_URL`.
- API validation, JSON body limits, CSV byte/row/column limits, and structured sanitized errors.
- Process-local fixed-window request limits for Gemini, Ollama, and CSV uploads; separate Gemini/Ollama in-flight caps; bounded database query and ingestion concurrency; PostgreSQL connection, queue, and statement-timeout limits. Gemini/Ollama request timeouts and provider failures map to sanitized API errors. Provider quota and local overload responses use 429; timeouts use 504 (PostgreSQL statement timeout uses 408).
- Provider usage is copied only from provider responses. Gemini reported token counts and optional token-detail fields are returned when present; Ollama token counts and duration telemetry are returned when present. No token counts or costs are estimated.
- Cross-origin browser mutation requests are rejected; this does not replace authentication.
- Direct PostgreSQL reader/ingestion roles are checked for `rolsuper`, `rolbypassrls`, bypass-role membership, and membership/inheritance restrictions; the reader also must be transaction-read-only with no public write grants. The result is cached per process and requires a restart after role changes.
- CSV tables are given a full workspace UUID prefix, carry `workspace_id`, and are created with `ENABLE` + `FORCE ROW LEVEL SECURITY`. The transaction-local workspace context is selected only after Supabase membership authorization. Existing trial tables are not exposed by the authenticated workspace schema filter. Dataset details are introspected from PostgreSQL catalogs; no demo table or dataset registry migration is required.

The parser supports common PostgreSQL syntax, not every PostgreSQL extension. Unsupported syntax fails closed. Review parser upgrades against the security tests before changing the pinned version. Database permissions remain a second essential control; transaction read-only mode does not replace a least-privilege role.

## Remaining gaps

- No distributed rate limit, per-user/provider budget, or persisted audit/history store. The current fixed-window request counters and concurrency counters exist only in one Node.js process, reset on process restart, and are not shared between replicas. With N replicas, aggregate request and concurrency capacity can reach approximately N times each configured per-process value; database pool connections can also multiply by replica count.
- A multi-instance SaaS deployment needs a shared limiter such as Redis with atomic fixed-window/token-bucket updates keyed by authenticated workspace/user and provider, plus shared in-flight capacity coordination (leases with expiry/recovery) where a global provider cap is required. Usage quotas need a durable, idempotent usage ledger keyed to actual provider responses; the current application has no user identity or durable quota ledger. Database connection budgets must be planned across all replicas against PostgreSQL's connection limit.
- No automated test against a real PostgreSQL instance, Supabase Auth project, or actual Gemini/Ollama endpoint in this environment. Database migration and role setup remain manual.
- CSV ingestion writes workspace-prefixed tables in `public`; access depends on the unexecuted Supabase workspace migration and manually verified grants/default privileges on the selected ingestion and reader roles. The migration establishes workspace identity/membership metadata in Supabase; uploaded datasets remain in the separately selected PostgreSQL target (local Docker when `DATABASE_TARGET=local`).
- The ingestion login needs `CREATE` in the shared `public` schema and owns tables it creates, so it can alter/drop those owned tables and is not restricted to CSV creation by PostgreSQL ACLs. The least disruptive current mitigation is to keep the credential server-only and never expose it to query execution; a narrower follow-up requires moving uploads to controlled per-workspace schemas or a narrowly scoped database function.
- On a valid empty workspace, dataset discovery succeeds with an empty result. The UI now surfaces authorization/schema endpoint errors instead of silently treating them as an empty dataset list. No live Supabase workspace migration or PostgreSQL grant test was run.
- Initial workspace selection currently chooses a user's oldest membership and has no UI for switching workspaces or collaborating with other members.
- Function safety uses a maintained denylist plus a `pg_catalog`-only search path, not an exhaustive proof that every built-in function is harmless. Keep the reader role unprivileged and review available `EXECUTE` grants.
