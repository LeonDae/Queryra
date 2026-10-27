# Queryra CLI

Ask questions about local CSV files and run the generated read-only SQL with DuckDB on your computer. Gemini receives the question and CSV column names/types; CSV rows stay local. The CLI does not require the Queryra website, a database server, Supabase, Docker, or PostgreSQL.

Queryra CLI is licensed under MIT. You may use, modify, and redistribute it under the terms in [`LICENSE.md`](LICENSE.md); include the required copyright and permission notice with copies or substantial portions.

## Requirements

- Node.js 20.9 or newer and npm.
- An internet connection and your own Gemini API key for `queryra ask`.
- A readable `.csv` file for `queryra schema` and `queryra ask`.

Windows PowerShell and CMD are supported. DuckDB installs its native runtime through normal npm package dependencies. Other OS/CPU combinations are included by DuckDB's optional platform packages but have not been verified in this release preparation.

## Install

After the first npm release, install the `queryra-cli` package globally with:

```powershell
npm install --global queryra-cli
queryra --help
```

Global installation makes `queryra` available from any terminal. It does not make the CLI scan the installation folder: dataset discovery starts in the directory where you run the command.

For a locally built package tarball, install it globally by passing its path:

```powershell
npm install --global "C:\path\to\queryra-cli-0.1.0.tgz"
```

## First run and Gemini key

Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/apikey), then run:

```powershell
queryra init
```

Enter the key at the hidden prompt. It is saved in your user-local configuration, outside your project: `%APPDATA%\Queryra\config.json` on Windows, or `$XDG_CONFIG_HOME/queryra/config.json` (default `~/.config/queryra/config.json`) on Unix. The CLI restricts Unix config permissions to user-only access. On Windows the file uses the current user's AppData permissions.

`init` checks the current directory for readable CSV files but does not call Gemini. Press Enter at the key prompt to skip and configure it later with `queryra config --replace-key`, or set `QUERYRA_GEMINI_API_KEY` in your environment. The environment variable overrides the saved key. `QUERYRA_GEMINI_MODEL` optionally selects a model; default is `models/gemini-2.5-flash`.

Never put a real key in a CSV, source file, command-line argument, or project repository. The CLI does not print the key. Check configuration without revealing it with:

```powershell
queryra config --check
```

Manage the saved key with `queryra config --replace-key` and `queryra config --remove-key`. Removing the saved key does not clear an environment-variable override.

## Use from a project directory

Change to the folder containing your CSV. Paths with spaces should be quoted in PowerShell:

```powershell
Set-Location "C:\Users\you\Desktop\sales project"
queryra schema
queryra ask "Show total sales by customer"
```

With multiple CSV files, an interactive menu uses Up/Down arrows and Enter to select a dataset each time. For scripts or a fixed choice, pass a file explicitly:

```powershell
queryra schema --file ".\datasets\sales 2026.csv"
queryra ask "Show average order amount by region" --file ".\datasets\sales 2026.csv"
```

You can instead scan a specific directory:

```powershell
queryra schema --dir ".\datasets"
queryra ask "Show total sales by customer" --dir ".\datasets"
```

`--file` takes precedence over `--dir`; otherwise the current working directory is scanned. Discovery checks readable `.csv` files directly in the selected directory and does not recurse into subfolders. A single CSV is selected automatically. If no readable CSV is found, Queryra prints the directory and suggests the next step.

`ask` also supports `--limit 1-1000` (default 100) and `--json`. For example:

```powershell
queryra ask "Show the top 10 customers by sales" --file ".\sales.csv" --limit 10 --json
```

## Data handling and safety

- DuckDB reads and queries the selected CSV locally. Only the question, schema, and necessary generation context are sent to Gemini; row data is not uploaded.
- Generated SQL is restricted to one read-only query, checked against the selected CSV schema, and limited before results are displayed.
- CSV files are limited to 50 MiB and 200 columns. Results are limited to 1,000 rows and 2 MiB of JSON output.
- Provider timeout, quota, authentication, and temporary service errors are reported without running a previous query.
- Gemini usage metadata is shown only when the provider returns it. The CLI does not estimate tokens or cost.

## Troubleshooting

- **`queryra` is not recognized:** verify `npm install --global` completed, then open a new terminal. Check `npm prefix --global` and ensure its `bin` directory is on `PATH`.
- **No CSV datasets found:** use `Set-Location` to enter the CSV folder, or pass `--dir`/`--file`. Queryra does not search subfolders.
- **Multiple CSVs in a script:** pass `--file`; interactive arrow selection requires a terminal.
- **Gemini is not configured:** run `queryra init` or `queryra config --replace-key`, or set `QUERYRA_GEMINI_API_KEY`.
- **Quota or provider error:** check the key's Google AI Studio project, model access, quota, and network connection. No key is required for `queryra schema`.
- **Invalid or unsupported SQL:** rephrase the question using fields shown by `queryra schema`. The CLI will not invent missing CSV columns.

For package maintainers: the standalone package lives in `cli/`. Run its tests through the repository's `npm test`, and use `npm pack --dry-run` inside `cli/` to inspect published files. No package has been published by this project task.

Report CLI bugs through [GitHub Issues](https://github.com/LeonDae/Queryra/issues).
