import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("website uses Overpass typography and keeps technical text monospace", () => {
  const css = source("../app/globals.css");
  const layout = source("../app/layout.jsx");
  assert.match(css, /font-family:\s*var\(--font-sans\)/);
  assert.match(css, /--font-sans:\s*"Overpass"/);
  assert.match(css, /--font-mono:[^;]*monospace/);
  assert.match(layout, /fonts\.googleapis\.com/);
  assert.match(layout, /data-scroll-behavior="smooth"/);
});

test("authenticated workspace keeps its route and uses Queryra's light visual identity", () => {
  const workspace = source("../app/queryra-app.jsx");
  const css = source("../app/globals.css");
  const route = source("../app/workspace/page.jsx");
  assert.match(workspace, /className="workspace-shell/);
  assert.match(workspace, /Queryra<span>\.<\/span>/);
  assert.match(css, /\.workspace-shell\s*\{[^}]*linear-gradient\(135deg, #edf6ff 0%, #f4f0ff 48%, #fff2f0 100%\)/);
  assert.match(route, /<QueryraApp\s*\/>/);
});

test("landing page omits release and scroll prompts and enlarges the nav logo", () => {
  const site = source("../app/marketing-site.jsx");
  const css = source("../app/globals.css");
  assert.doesNotMatch(site, /NPM RELEASE PENDING|scroll-cue|Scroll to explore/i);
  assert.match(css, /\.site-brand img \{[^}]*width:\s*45px/);
  assert.match(css, /\.site-brand img \{ width: 39px; height: 39px; \}/);
  assert.match(site, /className="final-cta"[^>]*onPointerMove=\{updateFinalGradient\}/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("auth navigation stays inside Queryra and callbacks use the configured site origin", () => {
  const site = source("../app/marketing-site.jsx");
  const docs = source("../app/docs/page.jsx");
  const authForm = source("../app/auth-form.jsx");
  const callback = source("../app/auth/callback/route.js");
  assert.match(site, /href="\/login"/);
  assert.match(site, /<Link href="\/login">Log in<\/Link>/);
  assert.match(docs, /href="\/login"/);
  assert.match(authForm, /href=\{signup \? "\/login" : "\/signup"\}/);
  assert.match(authForm, /getAuthCallbackUrl\(process\.env\.NEXT_PUBLIC_SITE_URL, window\.location\.origin\)/);
  assert.match(callback, /safeRedirectPath\(requested\)/);
  assert.match(callback, /resolveSiteOrigin\(process\.env\.NEXT_PUBLIC_SITE_URL, url\.origin\)/);
  assert.match(callback, /new URL\(error \? "\/login\?error=confirmation" : next, origin\)/);
  assert.doesNotMatch(callback, /https?:\/\//);
});

test("composer validates before loading and starts without selecting workspace datasets", () => {
  const composer = source("../app/queryra-web-composer.jsx");
  assert.match(composer, /Upload a CSV or Excel file and enter a question to continue\./);
  assert.match(composer, /Enter a question about your data\./);
  assert.match(composer, /Upload a CSV or Excel file first\./);
  assert.match(composer, /setBusy\(true\)[\s\S]*?try \{[\s\S]*?finally \{ setBusy\(false\); \}/);
  assert.doesNotMatch(composer, /onMouseEnter|\/tables|workspace dataset|Authenticated · workspace scoped/);
  assert.match(composer, /disabled=\{busy\}/);
});
