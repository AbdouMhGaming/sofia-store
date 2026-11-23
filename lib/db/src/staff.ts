import { createHash, randomBytes } from "node:crypto";
import type { Prisma, StaffCommand } from "@prisma/client";
import type { StaffCommandInput, StaffCommandResult, StaffPage, StaffRow } from "@workspace/api-zod";
import { db, posTransaction } from "./index";
import { accountRole, hashStaffPassword, lockAccount } from "./accounts";
import { fail } from "./pos/shared";

export type StaffActor = { id: number; role: string; tokenHash: string };
const select = { id: true, email: true, active: true, mustChangePassword: true, version: true, createdAt: true,
  roles: { include: { role: true } }, registerOpenings: { where: { status: "OPEN" }, select: { id: true }, take: 1 } } satisfies Prisma.UserSelect;
type StaffRecord = Prisma.UserGetPayload<{ select: typeof select }>;
function row(user: StaffRecord): StaffRow {
  const role = accountRole(user);
  if (role !== "MANAGER" && role !== "CASHIER") fail("Ce compte n'est pas un compte personnel modifiable.", 403);
  return { id: user.id, email: user.email, active: user.active, mustChangePassword: user.mustChangePassword, version: user.version,
    createdAt: user.createdAt, role, openRegisterSessionId: user.registerOpenings[0]?.id ?? null };
}
function ownerRole(actor: StaffActor) {
  if (actor.role !== "STORE_OWNER") fail("Gestion du personnel réservée au propriétaire.", 403);
}
async function owner(tx: Prisma.TransactionClient, actor: StaffActor, lock: boolean) {
  ownerRole(actor);
  const user = lock ? await lockAccount(tx, actor.id) : await tx.user.findUnique({ where: { id: actor.id }, include: { roles: { include: { role: true } } } });
  const session = await tx.session.findUnique({ where: { tokenHash: actor.tokenHash } });
  if (!user?.active || user.mustChangePassword || accountRole(user) !== "STORE_OWNER" || session?.userId !== actor.id || session.expiresAt <= new Date())
    fail("La session propriétaire n'est plus autorisée. Reconnectez-vous.", 401);
}
export async function listStaffAccounts(actor: StaffActor): Promise<StaffPage> {
  ownerRole(actor);
  return posTransaction(async tx => {
    await owner(tx, actor, false);
    const users = await tx.user.findMany({ where: { roles: { some: { role: { name: { in: ["MANAGER", "CASHIER"] } } }, none: { role: { name: "STORE_OWNER" } } } },
      select, orderBy: { id: "asc" }, take: 201 });
    if (users.length > 200) fail("Plus de 200 comptes ; une recherche paginée est nécessaire.", 413);
    return { staff: users.map(row) };
  });
}
export function normalizeStaffCommand(input: StaffCommandInput): StaffCommandInput {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)) fail("Référence de requête invalide.", 400);
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 400) fail("Un motif de 3 à 400 caractères est requis.", 400);
  if (input.kind === "CREATE") {
    const email = input.email.trim().toLowerCase();
    if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["MANAGER", "CASHIER"].includes(input.role)) fail("Adresse e-mail ou rôle invalide.", 400);
    return { kind: "CREATE", requestId: input.requestId, email, role: input.role, reason };
  }
  if (!["UPDATE", "RESET"].includes(input.kind) || !Number.isSafeInteger(input.userId) || input.userId < 1 || !Number.isSafeInteger(input.version) || input.version < 1) fail("Compte ou version invalide.", 400);
  if (input.kind === "RESET") return { kind: "RESET", requestId: input.requestId, userId: input.userId, version: input.version, reason };
  if (!["MANAGER", "CASHIER"].includes(input.role) || typeof input.active !== "boolean") fail("Rôle ou état invalide.", 400);
  return { kind: "UPDATE", requestId: input.requestId, userId: input.userId, version: input.version, role: input.role, active: input.active, reason };
}
function fingerprint(input: StaffCommandInput) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }
async function result(tx: Prisma.TransactionClient, command: StaffCommand): Promise<StaffCommandResult> {
  const user = command.resultUserId ? await tx.user.findUnique({ where: { id: command.resultUserId }, select }) : null;
  const role = user && accountRole(user);
  return { requestId: command.requestId, kind: command.kind as StaffCommandResult["kind"], status: command.state as StaffCommandResult["status"],
    staff: user && role !== "STORE_OWNER" && role ? row(user) : null, resultVersion: command.resultVersion, temporaryPassword: null };
}
function matches(command: StaffCommand, actor: StaffActor, hash?: string) {
  if (command.actorId !== actor.id) fail("Cette référence appartient à un autre opérateur.", 403);
  if (hash && command.requestHash !== hash) fail("Référence déjà utilisée pour un autre contenu. N'envoyez pas une nouvelle tentative modifiée.", 409);
}
export async function executeStaffOperation(raw: StaffCommandInput, actor: StaffActor): Promise<StaffCommandResult> {
  ownerRole(actor);
  const input = normalizeStaffCommand(raw), requestHash = fingerprint(input);
  // KDF outside locks; never save the plaintext in the command/audit. A replay
  // discards this candidate, and can return metadata only.
  const temporaryPassword = input.kind === "UPDATE" ? null : randomBytes(24).toString("base64url");
  const passwordHash = temporaryPassword ? await hashStaffPassword(temporaryPassword) : null;
  try {
    return await posTransaction(async tx => {
      await owner(tx, actor, true);
      const previous = await tx.staffCommand.findUnique({ where: { requestId: input.requestId } });
      if (previous) {
        matches(previous, actor, requestHash);
        if (previous.state === "CANCELLED") fail("Cette tentative a été abandonnée définitivement.", 409);
        return result(tx, previous);
      }
      let target: StaffRecord;
      if (input.kind === "CREATE") {
        const role = await tx.role.findUniqueOrThrow({ where: { name: input.role } });
        target = await tx.user.create({ data: { email: input.email, passwordHash: passwordHash!, active: true, mustChangePassword: true, roles: { create: { roleId: role.id } } }, select });
      } else {
        const candidate = await tx.user.findUnique({ where: { id: input.userId }, include: { roles: { include: { role: true } } } });
        if (input.userId === actor.id || candidate && accountRole(candidate) === "STORE_OWNER")
          fail("Le compte propriétaire est protégé. Aucune modification ou réinitialisation autorisée ici.", 403);
        const locked = await lockAccount(tx, input.userId);
        if (accountRole(locked) === "STORE_OWNER" || locked.id === actor.id) fail("Le compte propriétaire est protégé. Aucune modification ou réinitialisation autorisée ici.", 403);
        target = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select });
        row(target);
        if (target.version !== input.version) fail("Le compte a changé. Actualisez sa fiche avant une nouvelle opération.", 409);
        const open = target.registerOpenings[0];
        if (open) fail(`Clôturez et rapprochez d'abord le tiroir n°${open.id} dans Caisse → Tiroir. Le compte n'a pas été modifié.`, 409);
        if (input.kind === "UPDATE") {
          if (target.active === input.active && accountRole(target) === input.role) fail("Aucune modification demandée.", 409);
          const role = await tx.role.findUniqueOrThrow({ where: { name: input.role } });
          await tx.userRole.deleteMany({ where: { userId: target.id } });
          await tx.userRole.create({ data: { userId: target.id, roleId: role.id } });
          target = await tx.user.update({ where: { id: target.id }, data: { active: input.active, version: { increment: 1 } }, select });
        } else target = await tx.user.update({ where: { id: target.id }, data: { passwordHash: passwordHash!, mustChangePassword: true, version: { increment: 1 } }, select });
        await tx.session.deleteMany({ where: { userId: target.id } });
      }
      const command = await tx.staffCommand.create({ data: { requestId: input.requestId, requestHash, actorId: actor.id, kind: input.kind, state: "COMMITTED", resultUserId: target.id, resultVersion: target.version } });
      await tx.auditLog.create({ data: { userId: actor.id, action: `STAFF_${input.kind}`, detail: `Compte ${target.id}, version ${target.version}. ${input.reason}` } });
      return { ...await result(tx, command), temporaryPassword };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") fail("Cette adresse ou référence existe déjà. Récupérez la tentative avant toute autre opération.", 409);
    throw e;
  }
}
export async function recoverStaffOperation(requestId: string, actor: StaffActor) {
  ownerRole(actor);
  return posTransaction(async tx => {
    await owner(tx, actor, false);
    const command = await tx.staffCommand.findUnique({ where: { requestId } });
    if (!command) fail("Tentative encore inconnue. Cela ne prouve pas qu'elle ne peut plus arriver ; abandonnez-la explicitement.", 404);
    matches(command, actor);
    return result(tx, command);
  });
}
export async function abandonStaffOperation(raw: StaffCommandInput, actor: StaffActor) {
  ownerRole(actor);
  const input = normalizeStaffCommand(raw), requestHash = fingerprint(input);
  return posTransaction(async tx => {
    await owner(tx, actor, true);
    const previous = await tx.staffCommand.findUnique({ where: { requestId: input.requestId } });
    if (previous) { matches(previous, actor, requestHash); return result(tx, previous); }
    const command = await tx.staffCommand.create({ data: { requestId: input.requestId, actorId: actor.id, requestHash, kind: input.kind, state: "CANCELLED" } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "STAFF_ABANDONED", detail: `Tentative ${input.kind} abandonnée avant exécution. ${input.reason}` } });
    return result(tx, command);
  });
}
