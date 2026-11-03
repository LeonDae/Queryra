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

test("matches the browser origin against the incoming host when Next has an internal URL", () => {
  assert.doesNotThrow(() => assertSameOriginMutation(request("http://localhost:3000/SQG/content/v1/upload-csv", {
    origin: "http://127.0.0.1:3000",
    host: "127.0.0.1:3000",
    "sec-fetch-site": "same-origin",
  })));
});

test("uses trusted forwarded host and protocol when a reverse proxy terminates TLS", () => {
  assert.doesNotThrow(() => assertSameOriginMutation(request("http://queryra-app:3000/SQG/content/v1/upload-csv", {
    origin: "https://queryra.example",
    host: "queryra-app:3000",
    "x-forwarded-host": "queryra.example",
    "x-forwarded-proto": "https",
    "sec-fetch-site": "same-origin",
  })));
});

test("rejects cross-origin and cross-site mutations", () => {
  assert.throws(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api", { origin: "https://attacker.example" })), (error) => error.status === 403);
  assert.throws(() => assertSameOriginMutation(request("http://localhost:3000/api", { origin: "http://attacker.example", host: "127.0.0.1:3000" })), (error) => error.status === 403);
  assert.throws(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api", { "sec-fetch-site": "cross-site" })), (error) => error.status === 403);
  assert.throws(() => assertSameOriginMutation(request("http://127.0.0.1:3000/api", { origin: "http://127.0.0.1:3000", "sec-fetch-site": "cross-site" })), (error) => error.status === 403);
  assert.throws(() => assertSameOriginMutation(request("http://queryra-app:3000/api", {
    origin: "https://queryra.example", host: "queryra-app:3000", "x-forwarded-host": "queryra.example", "x-forwarded-proto": "ftp",
  })), (error) => error.status === 403);
});
