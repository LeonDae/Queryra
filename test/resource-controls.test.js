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
