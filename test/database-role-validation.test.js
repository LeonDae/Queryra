import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isSafeIngestionRole } from "../lib/db.js";

const dbSource = readFileSync(new URL("../lib/db.js", import.meta.url), "utf8");
const safeIngestionRole = {
  rolsuper: false,
  rolbypassrls: false,
  inherited_bypass: false,
  rolinherit: false,
  role_memberships: false,
  public_usage: true,
  public_create: true,
};

test("ingestion role with no memberships and required schema privileges is accepted", () => {
  assert.equal(isSafeIngestionRole([safeIngestionRole]), true);
});

test("inbound membership granted to the ingestion role does not count as its membership", () => {
  const inboundMembership = { roleid: "queryra_ingest", member: "postgres" };
  const roleMemberships = [inboundMembership].some((membership) => membership.member === "queryra_ingest");

  assert.match(dbSource, /EXISTS \(SELECT 1 FROM pg_auth_members m WHERE m\.member = active\.oid\) AS role_memberships/);
  assert.equal(roleMemberships, false);
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, role_memberships: roleMemberships }]), true);
});

test("ingestion role that inherits another role or has an outbound membership is rejected", () => {
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, rolinherit: true }]), false);
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, role_memberships: true }]), false);
});

test("ingestion role with SUPERUSER or BYPASSRLS is rejected", () => {
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, rolsuper: true }]), false);
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, rolbypassrls: true }]), false);
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, inherited_bypass: true }]), false);
});

test("ingestion role must have schema USAGE and CREATE privileges", () => {
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, public_usage: false }]), false);
  assert.equal(isSafeIngestionRole([{ ...safeIngestionRole, public_create: false }]), false);
});
