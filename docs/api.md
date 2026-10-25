# API v1

The existing API route family remains available at `/SQG/content/v1`. This is the API version currently implemented by the application; no `/api/v2` route is implemented.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/SQG/content/v1/health` | Readiness check including PostgreSQL connectivity |
| GET | `/SQG/content/v1/schema` | Public tables/views and column metadata |
| GET | `/SQG/content/v1/tables` | Available public tables/views |
| POST | `/SQG/content/v1/generate-sql` | Generate SQL without executing it |
| POST | `/SQG/content/v1/execute-sql` | Validate and execute one bounded SELECT |
| POST | `/SQG/content/v1/feedback` | Submit feedback or regenerate SQL |
| POST | `/SQG/content/v1/upload-csv` | Ingest a CSV into the public schema |

## Generate, inspect, then execute

Generation and execution are separate operations. A client must show the returned SQL and wait for a deliberate execute action before calling the execution endpoint.

```bash
curl -s http://127.0.0.1:3000/SQG/content/v1/generate-sql \
  -H 'content-type: application/json' \
  -d '{"question":"Show the top 10 customers by order total","pipeline":"llm","schemaMode":"selected_tables","selectedTables":["customers","orders"]}'
```

The generate response preserves the existing fields. When the upstream returns token counts, the response also includes `providerUsage` with those reported counts; otherwise the field is `null`.

```json
{"originalQuestion":"Show the top 10 customers by order total","generatedSQL":"SELECT ...;","providerUsage":null}
```

After review, the UI or API client explicitly submits the SQL:

```bash
curl -s http://127.0.0.1:3000/SQG/content/v1/execute-sql \
  -H 'content-type: application/json' \
  -d '{"originalQuestion":"Show the top 10 customers by order total","generatedSQL":"SELECT ...;","selectedTables":["customers","orders"]}'
```

Successful execution returns `rows`, `rowCount`, `durationMs`, `truncated`, and `rowLimit`. The server caps results at 1,000 rows and at the configured JSON byte limit. `durationMs` is measured by the application and is not PostgreSQL execution telemetry.

## Request and error behavior

- JSON request bodies are limited to 256 KiB.
- Questions are limited to 8,000 characters, custom schema to 100,000, SQL to 50,000, and feedback to 4,000.
- CSV uploads are limited to 10 MiB, 100,000 data rows, and 200 columns.
- Errors use `{ "detail": "...", "code": "..." }`. Internal provider, database and stack details are logged server-side and are not returned.
- `429` indicates quota or query capacity; `408` indicates query timeout; `413` indicates a size limit; `503` indicates database availability/configuration.
- Model usage fields are `null` when the upstream provider does not return counts; they are not estimates.

## Pipeline identifiers

- `llm`: hosted Gemini SQL generation.
- `slm_review`: Ollama draft followed by Gemini review. The user question, schema context, and candidate SQL are sent to Gemini. This is a hybrid cloud pipeline, not local-only inference.

There is no `slm_only` pipeline, chart endpoint, history endpoint, Excel import, authentication, or workspace isolation in this API version.
