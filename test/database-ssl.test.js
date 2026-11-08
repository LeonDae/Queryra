import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveDatabaseSslOptions } from "../lib/db.js";

const poolerUrl = "postgresql://reader:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";
const certificate = "-----BEGIN CERTIFICATE-----\nZmFrZS1jZXJ0aWZpY2F0ZQ==\n-----END CERTIFICATE-----\n";

function withCertificate(t, contents = certificate) {
  const directory = mkdtempSync(join(tmpdir(), "queryra-db-ssl-"));
  const caFile = join(directory, "supabase-ca.crt");
  writeFileSync(caFile, contents);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return caFile;
}

test("hosted Supabase SSL loads the configured CA and keeps certificate verification enabled", (t) => {
  const caFile = withCertificate(t);
  const ssl = resolveDatabaseSslOptions(poolerUrl, { DATABASE_TARGET: "hosted", DATABASE_SSL_CA_FILE: caFile });

  assert.deepEqual(ssl, { ca: readFileSync(caFile, "utf8"), rejectUnauthorized: true });
});

test("hosted Supabase SSL requires DATABASE_SSL_CA_FILE", () => {
  assert.throws(
    () => resolveDatabaseSslOptions(poolerUrl, { DATABASE_TARGET: "hosted" }),
    (error) => error.status === 503 && error.code === "DATABASE_CONFIGURATION" && /DATABASE_SSL_CA_FILE is required/.test(error.message),
  );
});

test("hosted Supabase SSL reports an unreadable CA file path as configuration error", () => {
  assert.throws(
    () => resolveDatabaseSslOptions(poolerUrl, { DATABASE_TARGET: "hosted", DATABASE_SSL_CA_FILE: join(tmpdir(), "missing-queryra-ca.crt") }),
    (error) => error.status === 503 && error.code === "DATABASE_CONFIGURATION" && /readable PEM certificate/.test(error.message),
  );
});

test("hosted Supabase SSL rejects files without a PEM certificate", (t) => {
  const caFile = withCertificate(t, "not a certificate");

  assert.throws(
    () => resolveDatabaseSslOptions(poolerUrl, { DATABASE_TARGET: "hosted", DATABASE_SSL_CA_FILE: caFile }),
    (error) => error.status === 503 && error.code === "DATABASE_CONFIGURATION" && /must contain a PEM certificate/.test(error.message),
  );
});

test("local PostgreSQL SSL behavior does not require or read a hosted CA file", () => {
  assert.equal(resolveDatabaseSslOptions("postgresql://reader@127.0.0.1:5432/queryra", {
    DATABASE_TARGET: "local",
    DATABASE_SSL_CA_FILE: "missing-local-ca.crt",
  }), undefined);
  assert.equal(resolveDatabaseSslOptions("postgresql://reader@127.0.0.1:5432/queryra", {
    DATABASE_TARGET: "local",
    PGSSL: "disable",
  }), false);
});
