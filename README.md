# Queryra

### Your data. Your questions. SQL in seconds.

**Queryra** is an AI-powered data querying platform that lets users explore structured data using natural language instead of manually writing SQL queries.

Whether you're a developer working from the terminal or someone who wants to analyse a dataset through a web interface, Queryra bridges the gap between natural language and SQL.

[🌐 Live Application — Coming Soon](#) · [📦 npm Package](https://www.npmjs.com/package/queryra-cli) · [💻 GitHub Repository](https://github.com/LeonDae/Queryra)

---

## What is Queryra?

Working with structured data often requires SQL knowledge, familiarity with database schemas, and time spent writing and debugging queries.

Queryra simplifies this process.

It takes a question written in plain English, understands the available data structure, generates an appropriate SQL query, validates it, and executes it to return meaningful results.

Instead of writing:

```sql
SELECT region, SUM(revenue)
FROM sales
GROUP BY region
ORDER BY SUM(revenue) DESC;
```

You can simply ask:

```text
Show total revenue by region, sorted from highest to lowest.
```

Queryra handles the SQL workflow for you.

## How it works

Queryra follows a schema-aware query generation and execution pipeline.

1. **Data Discovery** — Load a dataset and identify its available tables, columns, and data types.
2. **Schema Context** — Provide the relevant schema information to the language model.
3. **SQL Generation** — Convert the natural-language question into a structured SQL query.
4. **Query Validation** — Apply SQL safety checks before execution.
5. **Execution** — Execute the validated query against the available dataset.
6. **Results** — Return the generated SQL and corresponding query results.

The goal is not simply to generate SQL, but to make data querying more accessible while retaining control over query execution.

## Two ways to use Queryra

### 1. Queryra Web

Explore your datasets through an interactive browser-based interface.

- Upload CSV or Excel datasets.
- Ask questions using natural language.
- Generate schema-aware SQL queries.
- Inspect generated SQL before execution.
- View query results in an interactive workspace.

**Best for:** Analysts, students, researchers, and users who prefer a visual data exploration experience.

[Launch Queryra Web — Coming Soon](#)

### 2. Queryra CLI

A lightweight command-line interface for developers who prefer working directly from their terminal.

Queryra CLI brings natural-language-to-SQL directly into your development workflow.

**Key capabilities:**
- Discover CSV datasets from your working directory.
- Inspect table schemas before querying.
- Select datasets interactively.
- Generate SQL using Google's Gemini models.
- Validate generated SQL before execution.
- Execute queries locally using DuckDB.
- Use your own Gemini API key (Bring Your Own Key).

**Best for:** Developers, engineers, technical users, and anyone who wants to query datasets without leaving the terminal.

### Install Queryra CLI

```bash
npm install -g queryra-cli
```

Initialize Queryra:

```bash
queryra init
```

Inspect available datasets:

```bash
queryra schema
```

Ask a question:

```bash
queryra ask "Show the top 10 customers by total sales"
```

Additional commands:

```bash
queryra --help
queryra --version
queryra config --check
```

**Requirements:** Node.js and a Google Gemini API key.

Get your API key from [Google AI Studio](https://aistudio.google.com/apikey).

Explore the package: [queryra-cli on npm](https://www.npmjs.com/package/queryra-cli)

---

## Technology Stack

Queryra combines modern web technologies, language models, and database execution tools.

| Layer | Technologies |
|---|---|
| Frontend | Next.js, React, Tailwind CSS |
| Backend | Next.js API routes, Node.js |
| Database | PostgreSQL, Supabase |
| AI / LLM | Google Gemini |
| Query Execution | DuckDB |
| CLI | Node.js |
| CLI Distribution | npm |

## Design Principles

- **Natural Language First:** Make structured data accessible without requiring users to write SQL manually.
- **Schema Awareness:** Generate queries using the actual structure of the available data.
- **Safety First:** Validate generated SQL before execution.
- **Developer Friendly:** Provide both a browser-based experience and a lightweight CLI.
- **User-Controlled AI:** Support user-provided Gemini API credentials in the CLI.

## Project Status

Queryra is under active development. The CLI is publicly available on npm, while the web application is being prepared for deployment.

Future improvements may include query history, saved insights, expanded model support, and additional deployment options.

## Resources

- [Queryra GitHub Repository](https://github.com/LeonDae/Queryra)
- [Queryra CLI — npm](https://www.npmjs.com/package/queryra-cli)
- [Google AI Studio](https://aistudio.google.com/)
- [DuckDB Documentation](https://duckdb.org/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  **Queryra — Your data, in plain language.**
</p>