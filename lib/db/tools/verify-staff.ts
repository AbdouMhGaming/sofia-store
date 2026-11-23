import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, posTransaction, executeStaffOperation, recoverStaffOperation, abandonStaffOperation, listStaffAccounts,
  verifyStaffPassword, openDrawer, closeDrawer, lockAccount, type StaffActor, type PosActor } from "../src/index";
import type { StaffCommandInput } from "@workspace/api-zod";

const emails = new Set<string>(), registers: number[] = [], suffix = randomUUID().slice(0, 8);
const hash = () => createHash("sha256").update(randomBytes(32)).digest("hex");
const mail = (label: string) => { const email = `verify-staff-${label}-${suffix}@invalid.test`; emails.add(email); return email; };
let stage = "setup";
async function actor(role: string, label: string): Promise<StaffActor> {
  const user = await db.user.create({ data: { email: mail(label), passwordHash: "DISABLED_VERIFICATION_ONLY", active: true, mustChangePassword: false,
    roles: { create: { role: { connect: { name: role } } } } } });
  const tokenHash = hash();
  await db.session.create({ data: { userId: user.id, tokenHash, csrfHash: hash(), expiresAt: new Date(Date.now() + 3600000) } });
  return { id: user.id, role, tokenHash };
}
const input = (data: Omit<Extract<StaffCommandInput, { kind: "RESET" }>, "requestId" | "reason">): StaffCommandInput =>
  ({ ...data, requestId: randomUUID(), reason: "Vérification isolée du personnel" });
const denied = (run: () => Promise<unknown>, status: number) => assert.rejects(run, (e: unknown) => (e as { status: number }).status === status);

try {
  if (process.env.NODE_ENV === "production") throw new Error("Development only");
  const owner = await actor("STORE_OWNER", "owner"), other = await actor("STORE_OWNER", "other-owner");
  const manager = await actor("MANAGER", "manager"), cashier = await actor("CASHIER", "cashier");
  for (const a of [manager, cashier]) await denied(() => listStaffAccounts(a), 403);
  stage = "concurrent create";
  const create: StaffCommandInput = { kind: "CREATE", requestId: randomUUID(), email: mail("created"), role: "CASHIER", reason: "Vérification isolée du personnel" };
  const pair = await Promise.all([executeStaffOperation(create, owner), executeStaffOperation(create, owner)]);
  const first = pair.find(r => r.temporaryPassword)!;
  assert.equal(pair.filter(r => r.temporaryPassword !== null).length, 1);
  const id = first.staff!.id, password = first.temporaryPassword!;
  let current = await db.user.findUniqueOrThrow({ where: { id } });
  assert.ok(current.active && current.mustChangePassword);
  assert.ok(await verifyStaffPassword(password, current.passwordHash));
  assert.equal(await db.user.count({ where: { email: create.email } }), 1);
  assert.equal(await db.staffCommand.count({ where: { requestId: create.requestId } }), 1);
  assert.equal((await executeStaffOperation(create, owner)).temporaryPassword, null);
  assert.equal((await recoverStaffOperation(create.requestId, owner)).temporaryPassword, null);
  await denied(() => executeStaffOperation({ ...create, role: "MANAGER" }, owner), 409);
  await denied(() => recoverStaffOperation(create.requestId, other), 403);
  const page = await listStaffAccounts(owner);
  assert.ok(page.staff.some(s => s.id === id));
  assert.ok(!page.staff.some(s => [owner.id, other.id].includes(s.id)));
  assert.ok(!JSON.stringify(page).includes("passwordHash"));

  stage = "drawer and stale version";
  const reg = await db.cashRegister.create({ data: { code: `VS-${suffix}`, name: "VÉRIFICATION PERSONNEL" } }); registers.push(reg.id);
  const opener: PosActor = { id, role: "CASHIER", registerCode: reg.code, authVersion: current.version };
  await denied(() => posTransaction(tx => openDrawer(tx, { requestId: randomUUID(), openingMinor: 0 }, opener)), 403);
  await posTransaction(async tx => {
    await lockAccount(tx, id);
    await tx.user.update({ where: { id }, data: { mustChangePassword: false, version: { increment: 1 } } });
  });
  current = await db.user.findUniqueOrThrow({ where: { id } });
  const stale = input({ kind: "RESET", userId: id, version: current.version - 1 });
  await denied(() => executeStaffOperation(stale, owner), 409);
  assert.equal((await abandonStaffOperation(stale, owner)).status, "CANCELLED");
  await denied(() => executeStaffOperation(stale, owner), 409);

  stage = "role reset state session revocation";
  await db.session.create({ data: { userId: id, tokenHash: hash(), csrfHash: hash(), expiresAt: new Date(Date.now() + 100000) } });
  const change: StaffCommandInput = { kind: "UPDATE", requestId: randomUUID(), userId: id, version: current.version, role: "MANAGER", active: true, reason: "Vérification changement de rôle" };
  const changed = await executeStaffOperation(change, owner);
  assert.equal(changed.staff!.role, "MANAGER"); assert.equal(await db.session.count({ where: { userId: id } }), 0);
  const reset = input({ kind: "RESET", userId: id, version: changed.staff!.version });
  const resetResult = await executeStaffOperation(reset, owner);
  const resetPassword = resetResult.temporaryPassword!;
  current = await db.user.findUniqueOrThrow({ where: { id } });
  assert.ok(current.mustChangePassword && await verifyStaffPassword(resetPassword, current.passwordHash));
  assert.ok(!await verifyStaffPassword(password, current.passwordHash));
  assert.equal((await executeStaffOperation(reset, owner)).temporaryPassword, null);
  assert.equal((await recoverStaffOperation(reset.requestId, owner)).temporaryPassword, null);
  const disable: StaffCommandInput = { ...change, requestId: randomUUID(), version: current.version, active: false };
  const disabled = await executeStaffOperation(disable, owner);
  assert.equal(disabled.staff!.active, false);
  const enabled = await executeStaffOperation({ ...disable, requestId: randomUUID(), version: disabled.staff!.version, active: true }, owner);
  assert.equal(enabled.staff!.active, true); assert.equal(enabled.staff!.mustChangePassword, true);
  const logs = JSON.stringify(await db.auditLog.findMany({ where: { userId: owner.id } }));
  const commands = JSON.stringify(await db.staffCommand.findMany({ where: { actorId: owner.id } }));
  for (const secret of [password, resetPassword]) assert.ok(!logs.includes(secret) && !commands.includes(secret));

  stage = "owner protection";
  for (const targetId of [owner.id, other.id]) {
    const target = await db.user.findUniqueOrThrow({ where: { id: targetId } });
    await denied(() => executeStaffOperation(input({ kind: "RESET", userId: targetId, version: target.version }), owner), 403);
    await denied(() => executeStaffOperation({ ...change, requestId: randomUUID(), userId: targetId, version: target.version, role: "CASHIER", active: false }, owner), 403);
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: targetId } })).active);
  }

  stage = "cancel-versus-delayed-create";
  const cancelled: StaffCommandInput = { ...create, requestId: randomUUID(), email: mail("cancelled") };
  await denied(() => recoverStaffOperation(cancelled.requestId, owner), 404);
  assert.equal((await abandonStaffOperation(cancelled, owner)).status, "CANCELLED");
  await denied(() => executeStaffOperation(cancelled, owner), 409);
  assert.equal(await db.user.count({ where: { email: cancelled.email } }), 0);
  const race: StaffCommandInput = { ...create, requestId: randomUUID(), email: mail("race") };
  await Promise.allSettled([executeStaffOperation(race, owner), abandonStaffOperation(race, owner)]);
  const recovered = await recoverStaffOperation(race.requestId, owner);
  assert.equal(recovered.temporaryPassword, null);
  assert.equal(await db.user.count({ where: { email: race.email } }), recovered.status === "COMMITTED" ? 1 : 0);

  stage = "open-drawer-versus-disable";
  await posTransaction(async tx => { await lockAccount(tx, id); await tx.user.update({ where: { id }, data: { mustChangePassword: false, version: { increment: 1 } } }); });
  current = await db.user.findUniqueOrThrow({ where: { id } });
  const version = current.version;
  const raceDisable: StaffCommandInput = { ...disable, requestId: randomUUID(), version };
  const outcomes = await Promise.allSettled([
    posTransaction(tx => openDrawer(tx, { requestId: randomUUID(), openingMinor: 0 }, { id, role: "MANAGER", registerCode: reg.code, authVersion: version })),
    executeStaffOperation(raceDisable, owner),
  ]);
  const active = await db.registerSession.findFirst({ where: { registerId: reg.id, status: "OPEN" } });
  const after = await db.user.findUniqueOrThrow({ where: { id } });
  assert.ok((!!active && after.active) || (!active && !after.active), "No disabled operator can own an open drawer");
  assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
  if (active) {
    const versionNow = after.version;
    for (const operation of [
      input({ kind: "RESET", userId: id, version: versionNow }),
      { ...raceDisable, requestId: randomUUID(), version: versionNow },
    ]) await denied(() => executeStaffOperation(operation, owner), 409);
    await posTransaction(tx => closeDrawer(tx, active.id, { requestId: randomUUID(), countedMinor: 0, reason: "Clôture du tiroir de vérification" }, { id: owner.id, role: "STORE_OWNER", registerCode: reg.code }));
  } else await denied(() => posTransaction(tx => openDrawer(tx, { requestId: randomUUID(), openingMinor: 0 }, { id, role: "MANAGER", registerCode: reg.code, authVersion: version })), 403);
  console.log("PASS: owner-only CRUD, one-time credentials/hashes, role/state/reset session revocation, protected owners, stale versions, identical/concurrent retries, actor/payload binding, durable cancellation and open-drawer/disable race.");
} catch (e) {
  console.error("Staff verification failed at", stage, (e as { code?: string }).code || (e as Error).name, (e as { status?: number }).status ?? "");
  process.exitCode = 1;
} finally {
  try {
    const users = (await db.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } })).map(u => u.id);
    await posTransaction(async tx => {
      await tx.cashRegister.updateMany({ where: { id: { in: registers } }, data: { currentSessionId: null } });
      await tx.registerSession.deleteMany({ where: { registerId: { in: registers } } });
      await tx.cashRegister.deleteMany({ where: { id: { in: registers } } });
      await tx.staffCommand.deleteMany({ where: { actorId: { in: users } } });
      await tx.auditLog.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.userRole.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    console.log("PASS: exact owned verification users, commands and private drawer removed; no real owner, staff, cash drawer, stock, order or settings changed.");
  } catch (e) { console.error("Staff fixture cleanup needs attention:", (e as { code?: string }).code || "CLEANUP_FAILED"); process.exitCode = 1; }
  await db.$disconnect();
}
