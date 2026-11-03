import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit, withConcurrencyLimit } from "../lib/resource-controls.js";

test("applies a process-local fixed-window request limit", () => {
  const variable = "QUERYRA_TEST_RATE_LIMIT";
  process.env[variable] = "1";
  const scope = `rate-test-${Date.now()}`;
  assert.equal(consumeRateLimit(scope, variable, 10).remaining, 0);
  assert.throws(() => consumeRateLimit(scope, variable, 10), (error) => error.status === 429);
  delete process.env[variable];
});

test("rejects excess concurrent work and releases the slot after completion", async () => {
  const variable = "QUERYRA_TEST_CONCURRENCY";
  process.env[variable] = "1";
  const scope = `concurrency-test-${Date.now()}`;
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const running = withConcurrencyLimit(scope, variable, 2, () => hold);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(withConcurrencyLimit(scope, variable, 2, async () => "unexpected"), (error) => error.status === 429);
  release();
  await running;
  assert.equal(await withConcurrencyLimit(scope, variable, 2, async () => "available"), "available");
  delete process.env[variable];
});

test("releases a concurrency slot when its operation fails", async () => {
  const variable = "QUERYRA_TEST_FAILURE_CONCURRENCY";
  process.env[variable] = "1";
  const scope = `failure-recovery-${Date.now()}`;
  await assert.rejects(withConcurrencyLimit(scope, variable, 1, async () => { throw new Error("expected failure"); }));
  assert.equal(await withConcurrencyLimit(scope, variable, 1, async () => "recovered"), "recovered");
  delete process.env[variable];
});

test("enforces an immediate database-style overload cap", async () => {
  const variable = "QUERYRA_TEST_DB_CONCURRENCY";
  process.env[variable] = "1";
  const scope = `database-overload-${Date.now()}`;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const running = withConcurrencyLimit(scope, variable, 1, () => held);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(withConcurrencyLimit(scope, variable, 1, async () => null, 20, { code: "QUERY_CAPACITY", message: "database busy" }), (error) => error.status === 429 && error.code === "QUERY_CAPACITY" && error.message === "database busy");
  release();
  await running;
  delete process.env[variable];
});
