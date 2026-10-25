# Security and deployment status

## Supported deployment scope today

The current product is a local, single-user development application. The `npm run dev` and `npm start` scripts bind to `127.0.0.1`. Do not expose this build publicly: there is no authentication, workspace identity, customer-connection authorization, or cross-workspace isolation. The `/SQG/content/v1` endpoints are intentionally unauthenticated for local development.

Hosted multi-user use requires an authentication provider and server-side workspace authorization on every API, plus per-workspace source/table grants and isolated uploaded datasets. Those features are not implemented, so public SaaS deployment is not supported.

## Implemented SQL protections

- PostgreSQL-aware AST parsing with a pinned parser version; parse errors, multiple statements, non-SELECT statements, modifying CTEs, non-public schemas, unknown relations, row-locking clauses, and selected dangerous functions are rejected.
- Base relations are schema-qualified and the transaction search path is pinned to `pg_catalog`; custom functions in `public` cannot resolve through the query's search path.
- Query execution uses an explicit read-only transaction, server-controlled 15-second statement timeout (configurable up to 120 seconds), 1,000-row response cap, 2 MiB serialized result cap by default, and bounded connection pool.
- Production requires separate reader and CSV-ingestion database URLs. Local development can continue using `DATABASE_URL`.
- API validation, JSON body limits, CSV byte/row/column limits, and structured sanitized errors.
- Process-local provider request/concurrency limits, CSV upload rate limits, and query pool/queue limits; Gemini/Ollama token counts are surfaced only when returned by the provider.
- Cross-origin browser mutation requests are rejected; this does not replace authentication.

The parser supports common PostgreSQL syntax, not every PostgreSQL extension. Unsupported syntax fails closed. Review parser upgrades against the security tests before changing the pinned version. Database permissions remain a second essential control; transaction read-only mode does not replace a least-privilege role.

## Remaining gaps

- No authentication, per-user/workspace authorization, distributed rate limit, per-user/provider budget, or persisted audit/history store. The current rate counters reset on process restart and are not shared between replicas.
- No automated test against a real PostgreSQL instance or actual Gemini/Ollama endpoint in this environment.
- CSV ingestion still writes into `public`; it requires administrator-reviewed grants and is only appropriate for a single-user database until workspace isolation is implemented.
- Function safety uses a maintained denylist plus a `pg_catalog`-only search path, not an exhaustive proof that every built-in function is harmless. Keep the reader role unprivileged and review available `EXECUTE` grants.
