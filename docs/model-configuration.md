# Model configuration

The model calls run on the Next.js server. The browser never receives `GOOGLE_API_KEY` or the Ollama endpoint configuration.

## Gemini

Set `GOOGLE_API_KEY` in `.env.local` for local use or in the server's secret manager for deployment. Requests use the `x-goog-api-key` header. The default model is `models/gemini-2.5-flash`; override it with `GEMINI_MODEL` to select another model available to the key. Google currently keeps 2.5 Flash available for existing users but recommends newer Flash models for new projects, so confirm your project has access before deploying.

## Ollama hybrid review

Install and run Ollama on a host reachable from the Next.js server, then pull the configured model:

```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

Configure `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`) and `OLLAMA_MODEL` (default `qwen2.5-coder:7b`). `localhost` is resolved by the machine/container running Next.js; it does not refer to an end user's laptop. If the app is containerized, configure a reachable Ollama service hostname rather than the container's own loopback address.

Test connectivity from the same host/container as Queryra:

```bash
curl http://127.0.0.1:11434/api/tags
```

Select `pipeline: "slm_review"` in the implemented API. Ollama first generates candidate SQL. Queryra then sends the question, schema context, and candidate SQL to Gemini for review. Gemini credentials and external network access are therefore still required. The UI displays this transfer disclosure when the hybrid option is selected.

## Local-only status

Strict local-only generation is not implemented. `slm_only` is rejected by request validation. Do not use the existing hybrid pipeline for a no-cloud-egress requirement.

## Common failures

- Missing `GOOGLE_API_KEY`: configure the key in the server environment.
- Gemini 429: provider quota/rate limit; check the Google API project quota and retry after the limit window.
- Ollama connection failure: verify the service URL from the Queryra process's network namespace.
- Ollama model failure: verify `OLLAMA_MODEL` matches a model returned by `ollama list`.
- Gemini review failure in hybrid mode: local candidate generation can succeed while the full request still fails because cloud review is required.
