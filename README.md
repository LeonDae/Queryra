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

If `.env.local` already exists, preserve it and add only missing variables from `.env.example`. Set `DATABASE_URL` and `GOOGLE_API_KEY` for local development. For a local PostgreSQL server without TLS, set `PGSSL=disable`. The default Supabase connection enables TLS. Never commit `.env.local` or put secrets in browser-prefixed variables. Existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` settings are not read by this Next.js app; the database connection uses `DATABASE_URL` directly.

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

Generated SQL is returned by Gemini (or Ollama followed by Gemini review). Generation and execution are separate; the UI requires a deliberate Run SQL action. Execution parses and validates one PostgreSQL SELECT, checks relations, uses a read-only transaction, applies a statement timeout, and caps response size. CSV uploads create a table in the `public` schema.

## Configuration

See `.env.example` for the supported environment variables. Secrets belong in `.env.local`, which is excluded from version control. `DATABASE_URL` is a local-development fallback. Production requires separate restricted `DATABASE_READER_URL` and `DATABASE_ADMIN_URL` credentials; see [database access guidance](docs/database-access.md).

## Docs and deployment scope

- [API v1 contracts and examples](docs/api.md)
- [Gemini and Ollama configuration](docs/model-configuration.md)
- [Security and deployment status](docs/security-status.md)

This is currently a local, single-user application. Do not expose it as a public service: authentication and workspace isolation are not implemented. The production API requires separate database roles, but those alone do not provide user authorization.

Local request limits are process-local. A hosted deployment needs authenticated per-user/workspace quotas and a shared limiter before it can be exposed through multiple app instances.

## Docker Compose

The Compose stack builds the standalone Next.js production image, starts a persistent PostgreSQL 16 development database with separate reader/ingestion roles, and publishes both services only on the host loopback interface. Set the Gemini key in `.env.local`; do not replace an existing file. Start with:

```bash
docker compose --env-file .env.local up --build -d
```

If `.env.local` contains `DATABASE_READER_URL` or `DATABASE_ADMIN_URL`, Compose uses those; otherwise it uses the local Compose database. The local database roles and passwords in `db/init-local-roles.sql` are development-only. The role script runs only when PostgreSQL initializes an empty data volume. Existing volumes retain their existing credentials.

Check status and logs with `docker compose ps` and `docker compose logs -f app postgres`. Stop the services with `docker compose --env-file .env.local down`; the PostgreSQL volume remains. Rebuild after code changes with `docker compose --env-file .env.local up --build -d`.

Docker is not required for `npm run dev`. If using Ollama from the container, it must listen on a host interface reachable from Docker; configure `OLLAMA_DOCKER_BASE_URL` for that address. `localhost` inside the app container refers to the container. Docker is not installed in the current environment, so this Compose workflow has not been built or run here.
