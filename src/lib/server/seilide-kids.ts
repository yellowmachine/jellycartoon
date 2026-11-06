import { randomBytes } from 'node:crypto';
import { and, eq, like, sql } from 'drizzle-orm';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { account, kidGuardian, kidProfile, session, user } from '#lib/server/db/schema.ts';
import { forgetByApproval } from '#lib/server/kid-login.ts';
import { isKid } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { cloudKid } from '#lib/server/media-api.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { parseSeilideKids, type SeilideKid } from '#lib/seilide-account.ts';
import { avatar } from 'comun/avatars.ts';

/**
 * Seilide says who the family's children are (#279, #303): the house keeps them, for its «¿Quién
 * eres?» and their rules (the «infantil» tag, schedule and limit, which stay here). Each enters as
 * those of the house do, with permission, with a password only the server knows.
 */
/** A password only the server knows, and its row, unless it has one that still opens. */
async function credentialFor(kidId: string, secret: string | null) {
	if (secret && decrypt(secret)) return secret;
	const ctx = await auth.$context;
	const credential = randomBytes(32).toString('base64url');
	await db
		.delete(account)
		.where(and(eq(account.userId, kidId), eq(account.providerId, 'credential')));
	await ctx.internalAdapter.linkAccount({
		userId: kidId,
		providerId: 'credential',
		accountId: kidId,
		password: await ctx.password.hash(credential)
	});
	return encrypt(credential);
}

/** Who lets it in: the adults of the house among Seilide's. With none, its administrator. */
async function guardianIds(emails: string[]) {
	if (!emails.length) return [];
	const wanted = new Set(emails.map((e) => e.trim().toLowerCase()));
	const people = await db.select({ id: user.id, email: user.email, role: user.role }).from(user);
	return people.filter((p) => !isKid(p) && wanted.has(p.email.toLowerCase())).map((p) => p.id);
}

async function keepKid(kid: SeilideKid) {
	const [found] = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(sql`lower(${user.email})`, kid.email));
	if (found && !isKid(found)) {
		log.error('peques', 'Un peque de Seilide es aquí una cuenta de adulto: no se toca', {
			email: kid.email
		});
		return;
	}
	const { id } = await cloudKid(kid.email, kid.name);
	const [before] = await db.select().from(kidProfile).where(eq(kidProfile.userId, id));
	const row = {
		avatar: avatar(kid.avatar).id,
		byApproval: true,
		secret: await credentialFor(id, before?.secret ?? null)
	};
	const guardians = await guardianIds(kid.guardians);
	await db.transaction(async (tx) => {
		await tx
			.insert(kidProfile)
			.values({ userId: id, ...row })
			.onConflictDoUpdate({ target: kidProfile.userId, set: row });
		await tx.delete(kidGuardian).where(eq(kidGuardian.kidId, id));
		if (guardians.length)
			await tx
				.insert(kidGuardian)
				.values(guardians.map((guardianId) => ({ kidId: id, guardianId })));
	});
	forgetByApproval(id);
}

/** No longer a child of Seilide's: off «¿Quién eres?», without a session. Its history stays. */
async function dropGone(here: SeilideKid[]) {
	const emails = new Set(here.map((k) => k.email));
	const known = await db
		.select({ id: user.id, email: user.email })
		.from(kidProfile)
		.innerJoin(user, eq(user.id, kidProfile.userId))
		.where(like(user.email, '%@peques.invalid'));
	for (const kid of known) {
		if (emails.has(kid.email.toLowerCase())) continue;
		await db.delete(session).where(eq(session.userId, kid.id));
		await db.delete(kidProfile).where(eq(kidProfile.userId, kid.id));
		forgetByApproval(kid.id);
		log.info('peques', 'Ya no es un peque de Seilide', { kidId: kid.id });
	}
}

/** Only with an answer that is a list: without one (an older Seilide, say), nothing changes. */
export async function keepSeilideKids(list: unknown) {
	if (!Array.isArray(list)) return;
	const kids = parseSeilideKids(list);
	for (const kid of kids) await keepKid(kid);
	await dropGone(kids);
}
