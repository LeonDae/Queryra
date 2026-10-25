# Queryra Architectural Refinement & Product Specification Update

> **Document Type:** Architectural Refinement & Implementation Specification  
> **Status:** Approved for Implementation (Planning Phase)  
> **Target System:** Queryra Next.js 15 Text-to-SQL Workstation  
> **Date:** October 2026

---

## 1. Executive Summary

This document specifies the refined target architecture for transforming **Queryra** from a single-page prototype into an enterprise-grade, schema-aware AI analytics workstation.

All proposed changes strictly adhere to the **Non-Breaking Invariant**: the existing Next.js 15 App Router codebase, working Gemini Flash generation, optional Ollama SLM pipeline, CSV table ingestion, and PostgreSQL read-only transactions remain operational at every stage.

---

## 2. Verified Repository Baseline vs. Proposed Architecture

| Dimension | Verified Repository Baseline (Actual Code) | Target Architecture (Proposed) |
|---|---|---|
| **Frontend Structure** | Monolithic 875-line client component in `app/page.jsx` with 17 `useState` hooks. Branding shows "SQLQueryGen". | Decomposed modular workstation components with Next.js App Router multi-page shell (`/`, `/schema`, `/history`, `/evaluations`, `/settings`). Standardized "Queryra" branding. |
| **Database Pool & Access** | Single shared `pg.Pool` in `lib/db.js` via single `DATABASE_URL`. Shared between read queries and `CREATE TABLE`/`INSERT` for CSVs. | **Dual-Role Connection Pools:** Unprivileged `queryra_reader` pool for query execution (`default_transaction_read_only = on`) and controlled `queryra_admin` pool for CSV ingestion. |
| **SQL Execution Safety** | Regex check (`/^select\b/i`), substring blocklist (`INSERT`, `DROP`, etc.), transaction `BEGIN READ ONLY` in `lib/db.js`. | **5-Layer Defense-in-Depth:** PostgreSQL AST parser (`pgsql-ast-parser`), relation authorization allowlist, unprivileged role, `15s` statement timeout, AST `LIMIT 1000`. |
| **Persistence & State** | **Zero server persistence.** Query history, feedback, and settings exist purely in transient React memory. | **Isolated App Metadata Store:** Hosted edition uses dedicated Supabase / PostgreSQL (`queryra_metadata` schema). Optional embedded SQLite (`better-sqlite3`) for self-hosted instances. |
| **Model Integration** | Hardcoded model `models/gemini-2.5-flash` with API key in URL query parameter in `lib/sql.js`. | **Pluggable Provider Architecture:** Tier 1 (Hosted Gemini default with header-based key), Tier 2 (Customer BYOK: OpenAI/Anthropic), Tier 3 (Private local Ollama/vLLM). |
| **Hybrid Pipeline Disclosure** | `"slm_review"` runs candidate on Ollama and silently transmits candidate + schema to Gemini cloud without user disclosure. | **Explicit Cloud Transfer Disclosure:** Mandatory UI warning badge/modal disclosing that schema and prompt are transmitted to Gemini cloud. Added pure `"slm_only"` offline mode. |
| **API Endpoints** | Legacy catch-all route at `app/SQG/content/v1/[...path]/route.js`. | Preserved as backward-compatibility proxy delegating internally to modular `/api/v2/*` route handlers with Zod schema validation. |

---

## 3. Key Architectural Decisions

### Decision 1: Application Metadata Storage (Supabase/PostgreSQL vs. SQLite)

- **Hosted Multi-Tenant SaaS (Default):** Application metadata (users, organizations, workspaces, query sessions, generated SQL, execution telemetry, feedback, evaluation benchmarks, and encrypted connection configs) is stored in a dedicated PostgreSQL database (such as Supabase) under a partitioned schema `queryra_metadata`. Customer analytics databases are never co-mingled with application state.
- **Self-Hosted / Single-User Edition (Optional):** For local desktop or air-gapped container deployments where deploying an external PostgreSQL instance is unwanted friction, Queryra supports an embedded SQLite engine (`better-sqlite3` at `~/.queryra/metadata.db`). The storage adapter interface (`IMetadataStore`) abstracts this completely.

```mermaid
graph TB
    subgraph StorageSeparation ["Storage Separation Architecture"]
        subgraph AppMetadata ["Application Metadata Store (Isolated)"]
            MetaPG["Supabase / PostgreSQL<br/>[Primary Hosted SaaS]<br/>(schema: queryra_metadata)"]
            MetaLite["SQLite via better-sqlite3<br/>[Optional Self-Hosted Only]<br/>(~/.queryra/metadata.db)"]
        end

        subgraph CustomerTarget ["Customer Analytics Target Database"]
            TargetPG["Customer PostgreSQL / Supabase<br/>(Analytical Tables · Uploaded CSVs)"]
            subgraph DualPool ["Dual-Role Connection Pools"]
                ReaderRole["Role: queryra_reader<br/>(CONNECT, SELECT only, read-only)"]
                AdminRole["Role: queryra_admin<br/>(Controlled CSV Table Creation)"]
            end
        end
    end

    AppMetadata -.->|Stores encrypted credentials| CustomerTarget
```

---

### Decision 2: Multi-Layer SQL Guardrail & AST Validation Engine

The existing regex string-matching (`/^select\b/i` and keyword blocklist) is superseded by a 5-layer defense system:

```mermaid
graph LR
    RawSQL["Generated SQL"] --> L1["Layer 1: AST Parser<br/>(pgsql-ast-parser)<br/>Root SelectStmt Only"]
    L1 --> L2["Layer 2: Relation Check<br/>Allowlisted Tables Only<br/>Catalog Queries Blocked"]
    L2 --> L3["Layer 3: AST Limit Injection<br/>Inject/Clamp LIMIT 1000"]
    L3 --> L4["Layer 4: Dual-Role Pool<br/>Role: queryra_reader<br/>(SELECT only, read-only)"]
    L4 --> L5["Layer 5: Safe Transaction<br/>BEGIN READ ONLY;<br/>SET statement_timeout = '15s';<br/>COMMIT;"]
```

1. **PostgreSQL AST Parser (`pgsql-ast-parser`):** The raw generated SQL is parsed into a syntax tree. The validator enforces:
   - Root AST statement must be strictly `SelectStmt`.
   - Rejection of statement stacking/multi-statements (`SemiColon`).
   - Rejection of data-modifying Common Table Expressions (`WITH deleted AS (DELETE ...) SELECT ...`).
   - Rejection of sensitive PostgreSQL administrative functions (`pg_terminate_backend`, `pg_read_file`, `lo_export`, `dblink`, `pg_sleep`, etc.).
2. **Authorized Relation Enforcement:** Table and view identifiers extracted from the AST are verified against an allowlist of introspected tables for the current workspace schema. Unauthorized system catalogs (`pg_authid`, `information_schema.user_mapping`) are blocked at parse time.
3. **Database-Level Least-Privilege Roles:**
   - **Query Execution Pool:** Connects with an unprivileged database role (`queryra_reader`) with explicit permissions: `GRANT CONNECT`, `GRANT USAGE ON SCHEMA public`, `GRANT SELECT ON ALL TABLES`. It possesses zero `INSERT`, `UPDATE`, `DELETE`, `CREATE`, or `ALTER` privileges, and has `SET default_transaction_read_only = on`.
   - **Administrative Pool (CSV Uploads only):** A separate controlled role (`queryra_admin`) used only by the CSV upload handler to perform sanitized `CREATE TABLE` and batch `INSERT` operations.
4. **Transaction Constraints:** Queries are executed within an explicit read-only transaction block:
   ```sql
   BEGIN READ ONLY;
   SET LOCAL statement_timeout = '15s';
   <validated_query>;
   COMMIT;
   ```
5. **Bounded Execution & Streaming:** AST rewrites automatically inject or clamp `LIMIT 1000` to prevent memory blowouts. Node.js processes query streams with backpressure to safeguard server memory.

---

### Decision 3: Model Provider Tiering & Hybrid SLM Disclosure

The system defines three distinct provider tiers via `IModelProvider`:

```mermaid
graph TB
    subgraph Tiers ["AI Model Provider Tiers"]
        Tier1["Tier 1: Hosted Default<br/>Google Gemini 2.5 Flash / Pro<br/>(Managed Server Key · Quota Controlled)"]
        Tier2["Tier 2: Customer-Managed (BYOK)<br/>OpenAI / Anthropic / Custom Gemini<br/>(Customer API Key in Vault)"]
        Tier3["Tier 3: Private Self-Hosted<br/>Local Ollama / vLLM / LocalAI<br/>(VPC / Localhost / Air-gapped)"]
    end

    subgraph Pipelines ["Execution Pipelines"]
        P1["Default Pipeline ('llm')<br/>Direct to Tier 1 or Tier 2"]
        P2["Hybrid Pipeline ('slm_review')<br/>Local Draft (Ollama) + Gemini Review<br/>⚠️ MANDATORY CLOUD DISCLOSURE"]
        P3["Strict Local Pipeline ('slm_only')<br/>Pure Local Inference (0% Cloud Egress)"]
    end

    Tier1 --> P1
    Tier2 --> P1
    Tier3 --> P2
    Tier3 --> P3
    Tier1 --> P2
```

- **Tier 1 — Hosted Gemini (Default):** Gemini 2.5 Flash / Pro executed via Google Generative Language REST/gRPC API. Handled through server-managed API keys with tenant quota controls.
- **Tier 2 — Customer-Managed Cloud Endpoints (BYOK):** Direct customer integrations for OpenAI, Anthropic, or customer-owned Google Cloud Vertex/Gemini keys.
- **Tier 3 — Private Self-Hosted Inference:** Customer-hosted local or VPC models (Ollama, vLLM, TGI) exposing an OpenAI-compatible or Ollama `/api/chat` interface.
- **Mandatory Hybrid Mode Cloud Transfer Disclosure:**
  - *Context:* The existing codebase contains a hybrid pipeline (`pipeline: "slm_review"`) where Ollama generates a candidate SQL query, but then immediately invokes Google Gemini to review and correct the candidate SQL.
  - *Architecture Requirement:* The system must never secretly transmit customer questions or schema structures to a cloud provider when a user believes they are running locally. When `"slm_review"` is chosen, the UI and API must provide an explicit disclosure badge:
    > ⚠️ **Cloud Data Transfer Notice:** Hybrid mode generates draft SQL locally via Ollama, but transmits your schema and question to Google Gemini cloud for review.
  - A pure **Local SLM Only** pipeline (`pipeline: "slm_only"`) is added so compliance-restricted users can run 100% locally with zero external network egress.

---

### Decision 4: Secrets & Runtime Configuration Strategy

| Operational Area | Hosted Multi-Tenant SaaS | Self-Hosted / On-Premises |
|---|---|---|
| **Secret Storage** | Supabase Vault / AWS KMS with AES-256-GCM envelope encryption. Master key in environment. | Local `.env.local` or encrypted local SQLite table. |
| **Workspace Settings** | Stored in PostgreSQL `queryra_metadata.workspaces` table with role-based access control. | Stored in local config file or `.env.local`. |
| **Deployment Artifact** | Next.js standalone container on Vercel or Google Cloud Run. | Multi-service `docker-compose.yml` (App + PostgreSQL + optional Ollama sidecar). |
| **API Versioning** | Primary `/api/v2/*` routes with structured Zod validation. | Same `/api/v2/*` routes, plus legacy `/SQG/content/v1/*` proxy for backward compatibility. |

---

## 4. Evaluated Architectural Trade-offs

1. **Supabase/PostgreSQL vs. SQLite for Application Metadata:**
   - *Trade-off:* SQLite is zero-configuration for local desktop development, but cannot support concurrent multi-tenant hosted SaaS, horizontal scaling, or centralized disaster recovery.
   - *Resolution:* Made Supabase/PostgreSQL the primary storage engine for the hosted multi-user edition, with SQLite retained strictly as an optional adapter for single-user self-hosted deployments.
2. **AST Parsing in Node.js vs. PostgreSQL Native `EXPLAIN`:**
   - *Trade-off:* Running `EXPLAIN (FORMAT JSON)` on PostgreSQL catches engine-level errors, but requires an active database round-trip and can execute malicious functions within expression indices or CTEs.
   - *Resolution:* Implemented client/server AST validation via `pgsql-ast-parser` before the query ever reaches the database, followed by `BEGIN READ ONLY` transaction execution on the database side.
3. **Dual Connection Pools vs. Single Connection Pool:**
   - *Trade-off:* Managing two connection pools (`queryra_reader` and `queryra_admin`) increases connection count overhead.
   - *Resolution:* Essential for defense-in-depth. If application code is ever bypassed or compromised, the database itself guarantees that the query connection cannot mutate data or drop tables.

---

## 5. Implementation Prerequisites (Before Phase 1)

### 5.1 Database Role Setup (Customer Database)
Execute the following DDL on the target PostgreSQL / Supabase analytical database:

```sql
-- 1. Create unprivileged query execution role
CREATE ROLE queryra_reader WITH LOGIN PASSWORD 'reader_secure_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE postgres TO queryra_reader;
GRANT USAGE ON SCHEMA public TO queryra_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO queryra_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO queryra_reader;

-- Enforce read-only transaction defaults at the role level
ALTER ROLE queryra_reader SET default_transaction_read_only = on;
ALTER ROLE queryra_reader SET statement_timeout = '15s';

-- 2. Create restricted ingestion role (CSV uploads only)
CREATE ROLE queryra_admin WITH LOGIN PASSWORD 'admin_secure_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE postgres TO queryra_admin;
GRANT USAGE, CREATE ON SCHEMA public TO queryra_admin;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO queryra_admin;
```

### 5.2 Application Metadata Schema (Supabase/PostgreSQL)
Execute the following DDL on the dedicated application metadata instance:

```sql
CREATE SCHEMA IF NOT EXISTS queryra_metadata;

-- Workspaces & Data Sources
CREATE TABLE queryra_metadata.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Query Execution Ledger & History
CREATE TABLE queryra_metadata.query_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES queryra_metadata.workspaces(id),
  question TEXT NOT NULL,
  generated_sql TEXT NOT NULL,
  pipeline TEXT NOT NULL, -- 'llm', 'slm_review', 'slm_only'
  provider TEXT NOT NULL, -- 'gemini', 'openai', 'ollama'
  execution_status TEXT NOT NULL, -- 'SUCCESS', 'AST_REJECTED', 'DB_ERROR'
  execution_duration_ms INTEGER,
  rows_returned INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Quality Evaluations & Feedback
CREATE TABLE queryra_metadata.evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES queryra_metadata.query_sessions(id),
  satisfied BOOLEAN NOT NULL,
  feedback_notes TEXT,
  regeneration_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.3 Required Dependencies & Environment Variables
```bash
# Add parsing and persistence dependencies
npm install pgsql-ast-parser zod better-sqlite3
```

Update `.env.local` to support dual-role connections without breaking existing configs:
```env
# Existing configuration (preserved)
DATABASE_URL=postgresql://user:password@host:5432/database
GOOGLE_API_KEY=your_gemini_api_key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:7b

# Dual-role connections (Phase 1+)
DATABASE_READER_URL=postgresql://queryra_reader:reader_secure_pass@host:5432/database
DATABASE_ADMIN_URL=postgresql://queryra_admin:admin_secure_pass@host:5432/database

# Application Metadata Store (Phase 2+)
APP_METADATA_DATABASE_URL=postgresql://supabase_admin:secret@host:5432/queryra_app
```

---

## 6. Phased Implementation Roadmap

- **Phase 1 (Weeks 1–2):** AST Guardrails (`pgsql-ast-parser`), Dual-Role Database Pools (`queryra_reader` / `queryra_admin`), Monolith Decomposition into Workstation Shell, Header-based Gemini API Key.
- **Phase 2 (Weeks 3–4):** Pluggable Provider Interface (Tier 1 Gemini / Tier 2 BYOK / Tier 3 Ollama), Supabase Metadata Store, History & Evaluation APIs.
- **Phase 3 (Weeks 5–7):** Interactive Schema Explorer, History Replay Drawer, Evaluations Quality Center, Settings Console.
- **Phase 4 (Weeks 8–9):** Automated Test Suites (Vitest + Playwright), Production Dockerfile & Compose Stack.
- **Phase 5 (Weeks 10+):** Intelligent Chart Visualizations, SQL Explanation in Natural Language, Token Streaming (SSE).
