import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const roleSql = readFileSync(new URL("../db/init-local-roles.sql", import.meta.url), "utf8");
const compose = readFileSync(new URL("../docker-compose.yml", import.meta.url), "utf8");
const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("local role SQL sources separate passwords from the container environment", () => {
  assert.match(roleSql, /\\getenv\s+queryra_reader_password\s+QUERYRA_POSTGRES_READER_PASSWORD/i);
  assert.match(roleSql, /\\getenv\s+queryra_ingest_password\s+QUERYRA_POSTGRES_INGEST_PASSWORD/i);
  assert.doesNotMatch(roleSql, /PASSWORD\s+'[^']+'/i);
  assert.doesNotMatch(roleSql, /(?:DROP\s+(?:DATABASE|TABLE|SCHEMA)|TRUNCATE\s|DELETE\s+FROM)/i);
});

test("local roles reset privileges and memberships for least privilege and RLS", () => {
  for (const role of ["queryra_reader", "queryra_ingest"]) {
    const create = roleSql.match(new RegExp(`CREATE ROLE ${role}[\\s\\S]*?\\\\gexec`, "i"))?.[0] || "";
    const alter = roleSql.match(new RegExp(`ALTER ROLE ${role}[\\s\\S]*?;`, "i"))?.[0] || "";
    assert.match(create, /NOSUPERUSER[\s\S]*NOBYPASSRLS[\s\S]*NOINHERIT/i);
    assert.match(alter, /NOSUPERUSER[\s\S]*NOBYPASSRLS[\s\S]*NOINHERIT/i);
    assert.match(roleSql, new RegExp(`REVOKE %I FROM ${role}`));
  }
  assert.match(roleSql, /ALTER ROLE queryra_reader SET default_transaction_read_only = on/i);
  assert.match(roleSql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM queryra_reader/i);
  assert.match(roleSql, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM queryra_reader/i);
  assert.match(roleSql, /REVOKE CREATE ON SCHEMA public FROM PUBLIC/i);
  assert.match(roleSql, /GRANT USAGE ON SCHEMA public TO queryra_reader/i);
  assert.match(roleSql, /GRANT USAGE, CREATE ON SCHEMA public TO queryra_ingest/i);
  assert.match(roleSql, /tablename ~ '\^qr_\[0-9a-f\]\{32\}_'/i);
  assert.match(roleSql, /ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public[\s\S]*GRANT SELECT ON TABLES TO queryra_reader/i);
});

test("Compose requires local role passwords and constructs only local role URLs", () => {
  assert.match(compose, /QUERYRA_POSTGRES_READER_PASSWORD:\s*\$\{QUERYRA_POSTGRES_READER_PASSWORD:\?/);
  assert.match(compose, /QUERYRA_POSTGRES_INGEST_PASSWORD:\s*\$\{QUERYRA_POSTGRES_INGEST_PASSWORD:\?/);
  assert.match(compose, /DATABASE_TARGET:\s*local/);
  assert.match(compose, /DATABASE_LOCAL_READER_URL: postgresql:\/\/queryra_reader:\$\{QUERYRA_POSTGRES_READER_PASSWORD:/);
  assert.match(compose, /DATABASE_LOCAL_ADMIN_URL: postgresql:\/\/queryra_ingest:\$\{QUERYRA_POSTGRES_INGEST_PASSWORD:/);
  assert.doesNotMatch(compose, /queryra_reader_dev|queryra_ingest_dev/);
});

test("environment template documents the two new local role passwords and URLs", () => {
  for (const variable of ["QUERYRA_POSTGRES_READER_PASSWORD", "QUERYRA_POSTGRES_INGEST_PASSWORD", "DATABASE_LOCAL_READER_URL", "DATABASE_LOCAL_ADMIN_URL"]) {
    assert.match(example, new RegExp(`^${variable}=`, "m"));
  }
});
