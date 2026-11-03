# Queryra (Next.js)

Queryra converts natural-language questions into SQL, can execute read-only queries against PostgreSQL, and supports CSV uploads and feedback-based SQL regeneration. The former Vite frontend and FastAPI backend are consolidated into a single Next.js application.

## Requirements

- Node.js 24 LTS recommended (Next.js 16 requires Node.js 20.9 or later)
- PostgreSQL (or Supabase PostgreSQL)
- A Google Gemini API key for cloud generation
- Optional: Ollama with `qwen2.5-coder:7b` for the local SLM + Gemini review pipeline

## Local setup

```bash
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Keep the existing `.env.local` as your private configuration; do not replace it with the template. The tracked `.env.example` documents local and hosted modes. Keep `DATABASE_TARGET=local` and `DATABASE_URL` pointed at local Docker PostgreSQL unless deliberately switching to hosted. `DATABASE_URL` is reserved for owner maintenance and is not used for application queries or uploads. Local workspace operations require separate restricted `DATABASE_LOCAL_READER_URL` and `DATABASE_LOCAL_ADMIN_URL`; there is no fallback to `DATABASE_URL`. Run `docker compose --env-file .env.local up -d postgres` for the local database. Supabase Auth uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; fill them with values from the fresh project and configure the callback URL. `PGSSL=disable` is only for trusted local PostgreSQL without TLS. Never commit `.env.local` or put server credentials in `NEXT_PUBLIC_*` variables.

Start the app with `npm run dev` and open <http://localhost:3000>.

## API

The UI continues to use the existing `/SQG/content/v1` endpoint prefix. Next.js route handlers provide:

- `GET /SQG/content/v1/health`
- `GET /SQG/content/v1/schema`
- `GET /SQG/content/v1/tables`
- `POST /SQG/content/v1/generate-sql`
- `POST /SQG/content/v1/execute-sql`
- `POST /SQG/content/v1/feedback`
- `POST /SQG/content/v1/upload-csv` (multipart form)

Generated SQL is returned by Gemini (or Ollama followed by Gemini review). Generation and execution are separate; the UI requires a deliberate Run SQL action. Execution parses and validates one PostgreSQL SELECT, checks workspace-scoped relations, uses a read-only transaction with transaction-local RLS context, applies a statement timeout, and caps response size. CSV uploads create workspace-prefixed tables in `public` with forced row-level security.

## Configuration

See [environment setup](docs/environment-setup.md) for the complete variable inventory and where to obtain values. Email/password Supabase Auth and cookie-backed SSR sessions are implemented. No service-role key is required. Hosted operation requires separate restricted `DATABASE_READER_URL` and `DATABASE_ADMIN_URL` credentials, the unexecuted workspace migration, and verified grants/RLS; see [database access guidance](docs/database-access.md).

## Operational limits

Gemini and Ollama request-rate and in-flight limits, CSV upload limits, database query concurrency, and CSV ingestion concurrency are process-local. Configure the per-process values in `.env.local` from `.env.example`. With multiple app replicas, each has its own counters and limits; use a shared atomic limiter (for example Redis), shared concurrency coordination, authenticated workspace identities, and durable provider-usage accounting before relying on global SaaS quotas. See [security and deployment status](docs/security-status.md).

## Docs and deployment scope

- [API v1 contracts and examples](docs/api.md)
- [Gemini and Ollama configuration](docs/model-configuration.md)
- [Security and deployment status](docs/security-status.md)
- [Queryra CLI MVP](docs/cli.md)

Authentication and first-workspace ownership are implemented, but production use is not verified. The migration is unexecuted and hosted database roles/grants/RLS behavior have not been validated against your Supabase project. Do not expose this as a public SaaS deployment until the manual prerequisites and two-user isolation checks in [database access guidance](docs/database-access.md) pass.

Local request limits are process-local. A hosted deployment needs authenticated per-user/workspace quotas and a shared limiter before it can be exposed through multiple app instances.

## Docker Compose

The Compose stack builds the standalone Next.js image, starts a persistent PostgreSQL 16 development database with separate reader/ingestion roles, and publishes both services only on the host loopback interface. Start with:

```bash
docker compose --env-file .env.local up --build -d
```

Compose always selects `DATABASE_TARGET=local` and connects its app container to its own local `postgres` service using the local reader and ingestion roles. It deliberately does not pass host database connection URLs, so a hosted URL in `.env.local` cannot redirect CSV uploads from this Compose stack. It passes `GOOGLE_API_KEY` server-side when configured and builds the browser bundle with the public Supabase URL/publishable key. The local role passwords in `db/init-local-roles.sql` are development-only. That script runs only when PostgreSQL initializes an empty data volume; existing volumes retain their existing credentials.

Check status and logs with `docker compose ps` and `docker compose logs -f app postgres`. Stop the services with `docker compose --env-file .env.local down`; the PostgreSQL volume remains. Rebuild after code changes with `docker compose --env-file .env.local up --build -d`.

Docker is not required for `npm run dev`. If using Ollama from the container, it must listen on a host interface reachable from Docker; configure `OLLAMA_DOCKER_BASE_URL` for that address. `localhost` inside the app container refers to the container. Docker is not installed in the current environment, so this Compose workflow has not been built or run here.
