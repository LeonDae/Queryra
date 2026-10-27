# Queryra CLI

Queryra CLI converts a question into a read-only SQL query over a local CSV. DuckDB discovers the schema and executes the query on your computer; Gemini receives the question and schema metadata, not CSV rows. The CLI is a standalone package: it does not require the Queryra website, Supabase, Docker, PostgreSQL, or a Queryra API.

## Install for local development

Use Node.js 20.9 or newer. From a checkout of this repository, link the separate CLI package globally for local development:

```powershell
Set-Location .\cli
npm install
npm link
queryra --help
```

`npm link` is for local development. The package metadata currently uses the candidate name `queryra-cli`; its npm availability has not been confirmed. Before a release, confirm the name is available and change `name` in both `cli/package.json` and `cli/package-lock.json` if needed. After publication, the global install form will be `npm install --global <confirmed-package-name>`. This milestone does not publish the package.

The hosted website can link to CLI documentation or a released installer later, but the CLI itself does not need the website to be online.

The package declares Node.js >=20.9, a `queryra` executable at `bin/queryra.js`, and pinned `@duckdb/node-api` and `pgsql-ast-parser` dependencies. DuckDB's lockfile includes optional native bindings for Windows, macOS, and Linux x64/ARM64 (including listed musl variants). The current Windows development environment was exercised by the test and build commands; other operating systems and architectures have not been integration-tested here. `npm pack --dry-run` is used to review package contents before release.

## Setup and key handling

Create your own key in [Google AI Studio](https://aistudio.google.com/apikey). Gemini usage is subject to the billing, quota, and rate limits of the Google account/project associated with your key.

```powershell
queryra init
queryra config --check
```

`queryra init` displays a welcome header, prompts for a Gemini key using hidden terminal input when needed, then checks the **current working directory** for readable CSV files. Press Enter at the key prompt to skip. Setup does not call Gemini or make a paid provider request. If you skip the key, set `QUERYRA_GEMINI_API_KEY` in your environment or run `queryra config --replace-key` before `queryra ask`.

The key is stored in user-local config, outside the repository: `%APPDATA%\Queryra\config.json` on Windows, or `$XDG_CONFIG_HOME/queryra/config.json` (default `~/.config/queryra/config.json`) on Unix. Unix permissions are restricted to directory/file modes `0700`/`0600`; Windows uses the current user's AppData ACL. `QUERYRA_GEMINI_API_KEY` overrides the saved CLI key. The website's `GOOGLE_API_KEY` is never used as a fallback. `queryra config --check` reports only whether a key is configured; `--replace-key` and `--remove-key` manage the saved key. Removing the saved key does not unset the environment override.

Older CLI versions may have saved dataset directories/default files in per-project or legacy global configuration. These values are left in place for compatibility, but current commands do not consult them. No dataset preference can override the current working directory.

## Commands

```powershell
# Run from the directory containing a CSV
Set-Location ".\datasets"
queryra schema
queryra ask "Show total sales by customer"

# Or choose a directory or CSV explicitly
queryra schema --dir ".\datasets"
queryra ask "Show total sales by customer" --file ".\datasets\sales 2026.csv"

# Automation-friendly JSON with an explicit input
queryra ask "Show the top 10 customers by sales" --file ".\sales.csv" --limit 10 --json
```

For a folder with one CSV, `queryra schema` selects it automatically and `queryra ask "..."` uses it. For a folder with multiple CSVs, `queryra schema` or `queryra ask "..."` displays a new menu on each run. Use `queryra ask "..." --file ".\sales.csv"` for a fixed, scriptable choice.

Each invocation uses this precedence:

1. `--file <path.csv>` selects that CSV explicitly and takes priority if `--dir` is also present.
2. `--dir <path>` scans that directory for that command.
3. Otherwise, Queryra scans `process.cwd()` for that command.

Discovery checks only readable `.csv` files directly inside the chosen directory. It does not recurse into subfolders or search parent folders. A single CSV is selected automatically. If multiple CSVs are present, an interactive terminal presents an Up/Down and Enter selection menu every time a command needs a dataset; it does not remember or silently reuse an earlier choice. In non-interactive use, provide `--file`. Filenames and paths containing spaces are supported.

If no readable CSV is found, Queryra identifies the directory and explains how to enter the right folder with `cd`, or use `--dir` or `--file`. For example, if the current folder contains a `datasets` subfolder, use `queryra schema --dir ".\datasets"`; Queryra will not scan it automatically.

`queryra config --check` also reports the current directory and CSV count. `queryra schema` prints the selected directory and filename, then the discovered table and columns. `queryra ask` prints the selected input, schema/Gemini/validation/execution progress, generated SQL, and a formatted result table. With no question argument, `ask` prompts in an interactive terminal; scripts should pass the question and `--file` explicitly.

Exit codes: `0` success; `2` command/argument or selection-cancel error; `3` missing/invalid local configuration; `4` Gemini/provider failure; `5` dataset, SQL-validation, or local execution failure.

## Local processing and safety

- Only a local `.csv` is supported. The file must be readable, non-empty, at most 50 MiB, and contain no more than 200 columns. Schema sent to Gemini is capped at 32 KiB. CSV contents and rows remain local.
- The pipeline is DuckDB schema discovery, Gemini SQL generation, conservative SQL validation, DuckDB schema binding, then local execution. SQL must be one read-only `SELECT`/CTE over the selected CSV relation and use an allowlisted function. DuckDB `EXPLAIN` binds generated references against the selected table before the query is run; missing columns are rejected with available-column guidance. Valid aliases, aggregates, grouping, and ordering remain supported.
- Before generation, Queryra catches high-confidence missing group-by attributes (for example, `customer age` when `age` is absent). Gemini is instructed to return an unsupported-field or clarification response rather than substitute an unrelated query. Semantic interpretation is not perfect: synonyms and vague descriptions can still be ambiguous, so review generated SQL and clarify the question when needed.
- DuckDB processing has a 15-second deadline and a five-second outer watchdog. Gemini requests time out after 60 seconds. Results are limited to 1–1000 rows (default 100) and 2 MiB of JSON output. DuckDB is capped at 1 GiB and two threads; the worker has a 512 MiB old-generation heap cap.
- JSON output includes usage metadata only when Gemini actually reports it. The CLI does not estimate tokens or cost.
- The CLI has no PostgreSQL or Parquet support and never reads website database settings.
- Terminal colors are used only for TTY output, respect `NO_COLOR` and `FORCE_COLOR=0`, and fall back to plain ASCII labels. No terminal styling dependency is added. The same ASCII status text works in Windows PowerShell and CMD.

Only the prompt, discovered column names/types, and necessary SQL-generation context are sent to Gemini. Do not put sensitive values into the question or column names. No entire CSV or row data is uploaded.

## Verification scope

Tests use temporary synthetic CSVs and exercise the real local DuckDB schema/query path, selection behavior, SQL checks, limits, timeouts, and package metadata. Gemini tests use mocked provider responses. No live Gemini request is implied by passing tests. Use `npm pack --dry-run` in `cli/` to review a candidate package; confirm the name and release configuration before publishing or advertising a global install.
