import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { db, hashStaffPassword, posTransaction } from "@workspace/db";

const path = ".local/private/staff-browser.json", base = "http://localhost:80/api";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
type Fixture = { tag: string; owner: { id: number; email: string; password: string; token: string }; actors: { id: number; email: string; role: string; token: string }[]; createdEmails: string[] };
let stage = "setup";
const read = async () => JSON.parse(await readFile(path, "utf8")) as Fixture;
const save = async (f: Fixture) => { await mkdir(".local/private", { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(f), { mode: 0o600 }); };

class Client {
  cookies = new Map<string, string>();
  csrf = "";
  constructor(token?: string) { if (token) this.cookies.set("sofia_session", token); }
  async json(route: string, method = "GET", body?: unknown) {
    const response = await fetch(base + route, { method, signal: AbortSignal.timeout(60000), headers: {
      Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...(body ? { "Content-Type": "application/json", "x-csrf-token": this.csrf } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]!, i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const data = await response.json();
    if (typeof data.csrfToken === "string") this.csrf = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  }
}
async function prepare() {
  try { await readFile(path); throw new Error("Existing private fixture requires cleanup first"); } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }
  const tag = randomUUID().slice(0, 8), password = randomBytes(24).toString("base64url");
  const f: Fixture = { tag, owner: { id: 0, email: "", password, token: "" }, actors: [], createdEmails: [] };
  await save(f);
  for (const role of ["STORE_OWNER", "MANAGER", "CASHIER"]) {
    const email = `verify-staff-browser-${role.toLowerCase()}-${tag}@invalid.test`;
    f.createdEmails.push(email); await save(f);
    const user = await db.user.create({ data: { email, passwordHash: role === "STORE_OWNER" ? await hashStaffPassword(password) : "DISABLED_VERIFICATION_ONLY",
      active: true, mustChangePassword: false, roles: { create: { role: { connect: { name: role } } } } } });
    const token = randomBytes(32).toString("hex");
    await db.session.create({ data: { userId: user.id, tokenHash: hash(token), csrfHash: hash(randomUUID()), expiresAt: new Date(Date.now() + 3600000) } });
    const actor = { id: user.id, email, role, token };
    f.actors.push(actor); if (role === "STORE_OWNER") f.owner = { ...actor, password };
    await save(f);
  }
  console.log("Private staff browser fixture prepared. Credentials/session cookies were not printed.");
}
async function http(f: Fixture) {
  const owner = new Client(f.owner.token), guest = new Client();
  await owner.json("/auth/session"); await guest.json("/auth/session");
  const email = `verify-staff-http-${f.tag}@invalid.test`; f.createdEmails.push(email); await save(f);
  const create = { kind: "CREATE", requestId: randomUUID(), email, role: "CASHIER", reason: "Vérification HTTP isolée" };
  stage = "endpoint permissions";
  for (const a of [null, ...f.actors.filter(a => a.role !== "STORE_OWNER")]) {
    const client = a ? new Client(a.token) : guest; if (a) await client.json("/auth/session");
    const expected = a ? 403 : 401;
    assert.equal((await client.json("/admin/staff")).status, expected);
    assert.equal((await client.json("/admin/staff/commands", "POST", create)).status, expected);
    assert.equal((await client.json(`/admin/staff/requests/${create.requestId}`)).status, expected);
    assert.equal((await client.json("/admin/staff/requests/cancel", "POST", create)).status, expected);
  }
  assert.equal((await owner.json("/admin/staff/commands", "POST", { ...create, role: "STORE_OWNER" })).status, 400);
  const csrf = owner.csrf; owner.csrf = "";
  assert.equal((await owner.json("/admin/staff/commands", "POST", create)).status, 403);
  owner.csrf = csrf;
  stage = "create and forced password change";
  const created = await owner.json("/admin/staff/commands", "POST", create);
  assert.equal(created.status, 200); assert.ok(created.headers.get("cache-control")?.includes("no-store"));
  const targetId = created.data.staff.id, temporaryPassword = created.data.temporaryPassword;
  assert.equal((await owner.json("/admin/staff/commands", "POST", create)).data.temporaryPassword, null);
  const target = new Client(); await target.json("/auth/session");
  const login = await target.json("/auth/login", "POST", { email, password: temporaryPassword });
  assert.equal(login.status, 200); assert.equal(login.data.user.mustChangePassword, true);
  assert.equal((await target.json("/pos/context")).status, 403);
  const oldToken = target.cookies.get("sofia_session")!;
  const password = randomBytes(24).toString("base64url");
  const changed = await target.json("/auth/password", "POST", { currentPassword: temporaryPassword, newPassword: password });
  assert.equal(changed.status, 200); assert.equal(changed.data.user.mustChangePassword, false);
  assert.equal((await new Client(oldToken).json("/auth/session")).data.user, null);
  stage = "role-change revocation";
  let user = await db.user.findUniqueOrThrow({ where: { id: targetId } });
  const update = { kind: "UPDATE", requestId: randomUUID(), userId: targetId, version: user.version, role: "MANAGER", active: true, reason: "Vérification HTTP du rôle" };
  assert.equal((await owner.json("/admin/staff/commands", "POST", update)).status, 200);
  assert.equal((await target.json("/auth/session")).data.user, null);
  assert.equal((await target.json("/auth/login", "POST", { email, password })).status, 200);
  stage = "login-versus-reset revocation";
  user = await db.user.findUniqueOrThrow({ where: { id: targetId } });
  const reset = { kind: "RESET", requestId: randomUUID(), userId: targetId, version: user.version, reason: "Vérification concurrence connexion et reset" };
  const [resetResponse, racingLogin] = await Promise.all([
    owner.json("/admin/staff/commands", "POST", reset),
    target.json("/auth/login", "POST", { email, password }),
  ]);
  assert.equal(resetResponse.status, 200);
  assert.ok([200, 401, 403].includes(racingLogin.status));
  assert.equal(await db.session.count({ where: { userId: targetId } }), 0, "No stale login survives a reset");
  assert.equal((await owner.json(`/admin/staff/requests/${reset.requestId}`)).data.temporaryPassword, null);
  assert.equal((await owner.json("/admin/staff/commands", "POST", reset)).data.temporaryPassword, null);
  stage = "owner protection and durable abandon";
  const own = await db.user.findUniqueOrThrow({ where: { id: f.owner.id } });
  assert.equal((await owner.json("/admin/staff/commands", "POST", { ...reset, requestId: randomUUID(), userId: own.id, version: own.version })).status, 403);
  const cancel = { ...create, requestId: randomUUID(), email: `verify-staff-cancelled-${f.tag}@invalid.test` };
  f.createdEmails.push(cancel.email); await save(f);
  assert.equal((await owner.json(`/admin/staff/requests/${cancel.requestId}`)).status, 404);
  assert.equal((await owner.json("/admin/staff/requests/cancel", "POST", cancel)).data.status, "CANCELLED");
  assert.equal((await owner.json("/admin/staff/commands", "POST", cancel)).status, 409);
  const list = await owner.json("/admin/staff"); assert.equal(list.status, 200);
  assert.ok(!JSON.stringify(list.data).includes("passwordHash") && !JSON.stringify(list.data).includes(temporaryPassword));
  console.log("PASS: running owner-only endpoints, CSRF, one-time credentials, forced password change, session revocation, login/reset race, owner protection, durable cancellation and no-store responses.");
}
async function cleanup(f: Fixture) {
  const users = (await db.user.findMany({ where: { email: { in: f.createdEmails } }, select: { id: true } })).map(u => u.id);
  await posTransaction(async tx => {
    await tx.staffCommand.deleteMany({ where: { actorId: { in: users } } });
    await tx.auditLog.deleteMany({ where: { userId: { in: users } } });
    await tx.session.deleteMany({ where: { userId: { in: users } } });
    await tx.userRole.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
  });
  await unlink(path);
  console.log("Only exact staff verification accounts/commands removed, private credential file deleted. Real owner, users, tills, sales, stock and settings preserved.");
}
try {
  if (process.env.NODE_ENV === "production") throw new Error("Development verification only");
  const mode = process.argv[2];
  if (mode === "prepare") await prepare();
  else if (mode === "http") await http(await read());
  else if (mode === "register-target") {
    const f = await read(), email = process.argv[3] || "";
    if (!email.startsWith(`verify-staff-ui-${f.tag}-`) || !email.endsWith("@invalid.test")) throw new Error("Verification target outside owned namespace");
    f.createdEmails.push(email); await save(f); console.log("Owned browser target registered without credentials.");
  } else if (mode === "verify") {
    const f = await read();
    const targets = await db.user.findMany({ where: { email: { in: f.createdEmails.filter(e => e.startsWith(`verify-staff-ui-${f.tag}-`)) } } });
    assert.ok(targets.length > 0);
    for (const user of targets) {
      assert.ok(user.passwordHash.startsWith("scrypt$32768$"));
      assert.ok(user.version >= 5);
      assert.ok(user.active && !user.mustChangePassword);
      assert.ok(await db.staffCommand.count({ where: { actorId: f.owner.id, resultUserId: user.id, state: "COMMITTED" } }) >= 4);
    }
    console.log("PASS: browser-created staff states, credential hashes, versions and committed operation history verified without printing credentials.");
  } else if (mode === "cleanup") await cleanup(await read());
  else throw new Error("Use prepare/http/register-target/verify/cleanup");
} catch (e) {
  console.error("Staff fixture check failed at", stage, (e as { code?: string }).code || (e as Error).name);
  process.exitCode = 1;
} finally { await db.$disconnect(); }
