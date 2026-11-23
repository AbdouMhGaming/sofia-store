import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/index";
import { GetRetailReportResponse } from "@workspace/api-zod";

// No credentials are printed or saved. All temporary accounts have disabled
// password hashes; only their short-lived, in-memory fixture sessions work.
const ids: number[] = [], cases = new Map<string, string>();
const base = "http://localhost:80/api";
const query = "?from=2001-01-01&to=2001-03-31&groupBy=MONTH&channel=ALL";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function request(path: string, role?: string) {
  return fetch(`${base}${path}`, { headers: role ? { Cookie: `sofia_session=${cases.get(role)!}` } : {}, signal: AbortSignal.timeout(40000) });
}
try {
  if (process.env.NODE_ENV === "production") throw new Error("Development verification only");
  for (const name of ["STORE_OWNER", "MANAGER", "CASHIER"]) {
    const role = await db.role.findUniqueOrThrow({ where: { name } });
    const user = await db.user.create({ data: { email: `verify-http-${randomUUID()}@invalid.test`, passwordHash: "DISABLED_VERIFICATION_ONLY", active: true, mustChangePassword: false, roles: { create: { roleId: role.id } } } });
    ids.push(user.id);
    const token = randomBytes(32).toString("hex");
    await db.session.create({ data: { userId: user.id, tokenHash: hash(token), csrfHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 300000) } });
    cases.set(name, token);
  }
  for (const endpoint of ["/admin/reports", "/admin/reports/export"]) {
    assert.equal((await request(endpoint + query)).status, 401, "Anonymous blocked");
    for (const role of ["MANAGER", "CASHIER"]) assert.equal((await request(endpoint + query, role)).status, 403, `${role} blocked from ${endpoint}`);
  }
  const res = await request("/admin/reports" + query, "STORE_OWNER");
  assert.equal(res.status, 200, "Owner JSON");
  assert.ok(res.headers.get("cache-control")?.includes("no-store"));
  const report = GetRetailReportResponse.parse(await res.json());
  assert.equal(report.groupBy, "MONTH"); assert.equal(report.from, "2001-01-01");
  const csvResponse = await request("/admin/reports/export" + query + `&expectedFingerprint=${report.fingerprint}`, "STORE_OWNER");
  assert.equal(csvResponse.status, 200); assert.ok(csvResponse.headers.get("content-type")?.startsWith("text/csv"));
  assert.ok(csvResponse.headers.get("cache-control")?.includes("no-store"));
  const csv = await csvResponse.text();
  assert.ok(csv.includes(`"activite.netMinor";"${report.summary.activity.netMinor}";"centimes_DZD"`));
  assert.ok(csv.includes(`"estimatedMarginMinor";"${report.summary.estimatedMarginMinor}";"centimes_DZD"`));
  assert.equal((await request("/admin/reports/export" + query + `&expectedFingerprint=${"0".repeat(64)}`, "STORE_OWNER")).status, 409, "Mismatched export is refused");
  for (const path of ["/admin/reports?from=2001-02-30&to=2001-03-01", "/admin/reports/export?from=2001-01-01&to=2002-01-02"])
    assert.equal((await request(path, "STORE_OWNER")).status, 400, "Invalid range/calendar rejected");
  await db.user.update({ where: { id: ids[0]! }, data: { mustChangePassword: true } });
  assert.equal((await request("/admin/reports" + query, "STORE_OWNER")).status, 403, "Password-change gate preserved");
  console.log("PASS: running JSON/CSV endpoints, owner-only access, anonymous/manager/cashier denial, first-password gate, no-store headers, matching CSV figures, invalid date/range errors.");
} catch (e) {
  console.error("Report HTTP verification failed:", (e as Error).name, (e as Error).name === "AssertionError" ? (e as Error).message : "");
  process.exitCode = 1;
} finally {
  try {
    await db.session.deleteMany({ where: { userId: { in: ids } } });
    await db.userRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    assert.equal(await db.user.count({ where: { id: { in: ids } } }), 0);
    console.log("PASS: temporary HTTP fixture accounts/sessions removed; no real owner, cashier, register, order, inventory or settings modified.");
  } finally { await db.$disconnect(); }
}
