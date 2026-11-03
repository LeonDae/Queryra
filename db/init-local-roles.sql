-- Local-only least-privilege roles for Queryra's Docker PostgreSQL.
-- Passwords come from the postgres container environment, never this file.
\getenv queryra_reader_password QUERYRA_POSTGRES_READER_PASSWORD
\getenv queryra_ingest_password QUERYRA_POSTGRES_INGEST_PASSWORD

SELECT format(
  'CREATE ROLE queryra_reader WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
  :'queryra_reader_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'queryra_reader')
\gexec

SELECT format(
  'CREATE ROLE queryra_ingest WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT',
  :'queryra_ingest_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'queryra_ingest')
\gexec

-- Reset role attributes and passwords on reruns. Remove every direct role
-- membership so neither login can inherit privileges or SET ROLE to a bypass role.
ALTER ROLE queryra_reader WITH LOGIN PASSWORD :'queryra_reader_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE queryra_ingest WITH LOGIN PASSWORD :'queryra_ingest_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

SELECT format('REVOKE %I FROM queryra_reader', granted.rolname)
FROM pg_auth_members AS membership
JOIN pg_roles AS granted ON granted.oid = membership.roleid
JOIN pg_roles AS member ON member.oid = membership.member
WHERE member.rolname = 'queryra_reader'
\gexec

SELECT format('REVOKE %I FROM queryra_ingest', granted.rolname)
FROM pg_auth_members AS membership
JOIN pg_roles AS granted ON granted.oid = membership.roleid
JOIN pg_roles AS member ON member.oid = membership.member
WHERE member.rolname = 'queryra_ingest'
\gexec

REVOKE ALL PRIVILEGES ON DATABASE queryra FROM queryra_reader, queryra_ingest;
GRANT CONNECT ON DATABASE queryra TO queryra_reader, queryra_ingest;

-- The reader has no schema create privilege or direct table/sequence writes.
-- Remove PostgreSQL's legacy PUBLIC CREATE default so the reader cannot
-- receive schema CREATE indirectly. The local owner retains ownership access.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM queryra_reader;
GRANT USAGE ON SCHEMA public TO queryra_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM queryra_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM queryra_reader;
ALTER ROLE queryra_reader SET default_transaction_read_only = on;
ALTER ROLE queryra_reader SET statement_timeout = '15s';
ALTER ROLE queryra_reader SET search_path = pg_catalog;
ALTER ROLE queryra_ingest SET search_path = pg_catalog;

-- Preserve access only to Queryra's already-created workspace datasets. Legacy
-- demo/trial tables without the full qr_<workspace UUID>_ prefix stay ungranted.
SELECT format('GRANT SELECT ON TABLE public.%I TO queryra_reader', tablename)
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename ~ '^qr_[0-9a-f]{32}_'
\gexec

-- The ingestion login needs CREATE only in public, where the current CSV path
-- creates tables. It gets no grants on pre-existing tables; it owns new tables.
REVOKE ALL PRIVILEGES ON SCHEMA public FROM queryra_ingest;
GRANT USAGE, CREATE ON SCHEMA public TO queryra_ingest;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM queryra_ingest;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM queryra_ingest;

-- Newly created CSV tables are readable by the query role, but have no PUBLIC
-- table grants. Queryra creates each table with ENABLE + FORCE ROW LEVEL SECURITY.
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  REVOKE ALL ON TABLES FROM queryra_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  GRANT SELECT ON TABLES TO queryra_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, queryra_reader;
