import test from "node:test";
import assert from "node:assert/strict";
import { assertSameOriginMutation } from "../lib/request-security.js";

function request(url, headers = {}) {
  return { url, headers: new Headers(headers) };
}

test("allows same-origin browser writes and local CLI requests without Origin", () => {
  assert.doesNotThrow(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api", { origin: "http://127.0.0.1:3000" })));
  assert.doesNotThrow(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api")));
});

test("rejects cross-origin and cross-site mutations", () => {
  assert.throws(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api", { origin: "https://attacker.example" })), (error) => error.status === 403);
  assert.throws(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api", { "sec-fetch-site": "cross-site" })), (error) => error.status === 403);
});
