import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAuthCallbackUrl, resolveSiteOrigin, safeRedirectPath } from "../lib/supabase/redirects.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("signup callback uses the configured production origin and local development falls back to its browser origin", () => {
  assert.equal(
    getAuthCallbackUrl("https://queryra-production.up.railway.app", "http://localhost:3000"),
    "https://queryra-production.up.railway.app/auth/callback?next=%2Fworkspace",
  );
  assert.equal(
    getAuthCallbackUrl("", "http://localhost:3000"),
    "http://localhost:3000/auth/callback?next=%2Fworkspace",
  );
  assert.equal(resolveSiteOrigin("https://queryra.example/path", "http://localhost:3000"), "https://queryra.example");
  assert.throws(() => resolveSiteOrigin("http://queryra.example", "http://localhost:3000"), /HTTPS/);
});

test("callback and client redirects reject external and backslash-based open redirects", () => {
  assert.equal(safeRedirectPath("/workspace?tab=results#table"), "/workspace?tab=results#table");
  assert.equal(safeRedirectPath("//attacker.example"), "/workspace");
  assert.equal(safeRedirectPath("/\\\\attacker.example"), "/workspace");
  assert.equal(safeRedirectPath("https://attacker.example"), "/workspace");
});

test("dynamic composer resizes refresh scroll positions and reveals replay in both scroll directions", () => {
  const reveal = source("../app/scroll-reveal.jsx");
  assert.match(reveal, /new ResizeObserver\(scheduleRefresh\)/);
  assert.match(reveal, /querySelectorAll\("\.web-composer-panel"\)/);
  assert.match(reveal, /toggleActions: "play reverse play reverse"/);
  assert.match(reveal, /start: "top 85%"/);
  assert.match(reveal, /end: "bottom 15%"/);
  assert.match(reveal, /prefers-reduced-motion: reduce/);
});

test("workspace query results use document scrolling instead of a nested vertical scroller", () => {
  const workspace = source("../app/queryra-app.jsx");
  assert.match(workspace, /overflow-x-auto rounded-xl border border-slate-200 scrollbar-thin/);
  assert.doesNotMatch(workspace, /max-h-\[380px\]/);
  assert.doesNotMatch(workspace, /bg-slate-50\/90 border-b border-slate-200 sticky top-0/);
});

test("shared footer credit is rendered once at the end of the root layout with semibold styling", () => {
  const layout = source("../app/layout.jsx");
  const credit = source("../app/footer-credit.jsx");
  const css = source("../app/globals.css");
  const marketing = source("../app/marketing-site.jsx");
  assert.match(layout, /<FooterCredit \/>/);
  assert.match(credit, /Crafted &amp; Developed by Ditsu/);
  assert.match(css, /\.footer-credit\s*\{[^}]*font-weight:\s*600/);
  assert.doesNotMatch(marketing, /Crafted &amp; Developed by Ditsu/);
});
