-- Local-only role setup for the docker-compose development database.
-- Never reuse these example passwords outside this loopback-only stack.
CREATE ROLE queryra_reader
  WITH LOGIN PASSWORD 'queryra_reader_dev'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE queryra_ingest
  WITH LOGIN PASSWORD 'queryra_ingest_dev'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE queryra TO queryra_reader, queryra_ingest;
GRANT USAGE ON SCHEMA public TO queryra_reader;
GRANT USAGE, CREATE ON SCHEMA public TO queryra_ingest;
ALTER ROLE queryra_reader SET default_transaction_read_only = on;
ALTER ROLE queryra_reader SET statement_timeout = '15s';
ALTER DEFAULT PRIVILEGES FOR ROLE queryra_ingest IN SCHEMA public
  GRANT SELECT ON TABLES TO queryra_reader;
