import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { auth } from '#lib/server/auth.ts';
import {
	familyMember,
	familyPerson,
	kidAccount,
	kidGuardian,
	user
} from '#lib/server/db/schema.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { encrypt } from '#lib/server/secret-box.ts';

/**
 * Children's accounts (#303): one of the family's people without an account (Ajustes → Familia →
 * Personas) given one by its administrator, with the role `peque`. No email of its own nor a
 * password it knows: an inner email nobody sees, and a credential only the server keeps
 * (kid_account), to sign it in when one of its adults (kid_guardian) lets it in. What it sees here
 * is limited by the server (`kidMayOpen`), not hidden by the pages.
 */

/** Its inner email: never sent anything (`.invalid`, RFC 2606). */
const kidEmail = () => `peque-${randomUUID()}@peques.invalid`;

/** The family's adults: who may let its children in. */
export function familyAdults(k: Kitchen) {
	return k.run((tx) =>
		tx
			.select({ id: user.id, name: user.name })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.where(ne(familyMember.role, 'peque'))
			.orderBy(asc(user.name))
	);
}

/** Its children with an account: their person and who lets each in. */
export async function familyKids(k: Kitchen) {
	return k.run(async (tx) => {
		const kids = await tx
			.select({ id: familyMember.userId, personId: familyPerson.id })
			.from(familyMember)
			.innerJoin(familyPerson, eq(familyPerson.userId, familyMember.userId))
			.where(eq(familyMember.role, 'peque'));
		const guardians = kids.length
			? await tx
					.select()
					.from(kidGuardian)
					.where(
						inArray(
							kidGuardian.kidId,
							kids.map((kid) => kid.id)
						)
					)
			: [];
		return kids.map((kid) => ({
			...kid,
			guardians: guardians.filter((g) => g.kidId === kid.id).map((g) => g.guardianId)
		}));
	});
}

/** Only the family's adults: anyone else asked for is left out. */
async function onlyAdults(k: Kitchen, ids: string[]) {
	const adults = new Set((await familyAdults(k)).map((a) => a.id));
	return [...new Set(ids)].filter((id) => adults.has(id));
}

/**
 * That person, without an account yet, a child's: its name and drawing stay its person's. False
 * if it is not one of the family's without an account.
 */
export async function giveKidAccount(k: Kitchen, personId: number, guardians: string[]) {
	const [person] = await k.run((tx) =>
		tx
			.select({ name: familyPerson.name })
			.from(familyPerson)
			.where(and(eq(familyPerson.id, personId), isNull(familyPerson.userId)))
	);
	if (!person) return false;
	const allowed = await onlyAdults(k, guardians);
	// Better Auth's own user and credential, as its sign-up makes them, without signing in here.
	const ctx = await auth.$context;
	const credential = randomBytes(32).toString('base64url');
	const created = await ctx.internalAdapter.createUser(
		{ email: kidEmail(), name: person.name, emailVerified: false },
		{ method: 'email-password' }
	);
	try {
		await ctx.internalAdapter.linkAccount({
			userId: created.id,
			providerId: 'credential',
			accountId: created.id,
			password: await ctx.password.hash(credential)
		});
		await k.run(async (tx) => {
			await tx
				.insert(familyMember)
				.values({ userId: created.id, familyId: k.familyId, role: 'peque' });
			await tx
				.insert(kidAccount)
				.values({ userId: created.id, familyId: k.familyId, secret: encrypt(credential) });
			if (allowed.length)
				await tx
					.insert(kidGuardian)
					.values(
						allowed.map((guardianId) => ({ familyId: k.familyId, kidId: created.id, guardianId }))
					);
			await tx
				.update(familyPerson)
				.set({ userId: created.id })
				.where(eq(familyPerson.id, personId));
		});
	} catch (err) {
		await ctx.internalAdapter.deleteUser(created.id).catch(() => {});
		throw err;
	}
	kids.delete(created.id);
	return true;
}

/** Who lets it in, now: only one of the family's children. */
export async function setGuardians(k: Kitchen, kidId: string, guardians: string[]) {
	if (!(await familyKids(k)).some((kid) => kid.id === kidId)) return false;
	const allowed = await onlyAdults(k, guardians);
	await k.run(async (tx) => {
		await tx.delete(kidGuardian).where(eq(kidGuardian.kidId, kidId));
		if (allowed.length)
			await tx
				.insert(kidGuardian)
				.values(allowed.map((guardianId) => ({ familyId: k.familyId, kidId, guardianId })));
	});
	return true;
}

/**
 * Its account gone, it is a person without one again: its name, drawing and agenda stay (the
 * person's row lets go of the account, family_person.userId).
 */
export async function takeKidAccount(k: Kitchen, kidId: string) {
	if (!(await familyKids(k)).some((kid) => kid.id === kidId)) return false;
	// Its name, kept in its person: the account's was shown while it had one.
	const [account] = await k.run((tx) =>
		tx.select({ name: user.name }).from(user).where(eq(user.id, kidId))
	);
	if (account)
		await k.run((tx) =>
			tx.update(familyPerson).set({ name: account.name }).where(eq(familyPerson.userId, kidId))
		);
	const ctx = await auth.$context;
	await ctx.internalAdapter.deleteUser(kidId);
	kids.delete(kidId);
	return true;
}

/** Whether each account is a child's: by user, as it does not change while it exists. */
const kids = new Map<string, boolean>();

export async function isKidAccount(userId: string) {
	let kid = kids.get(userId);
	if (kid === undefined) {
		try {
			kid = await withFamily(userId, async (_, m) => m.role === 'peque');
		} catch (err) {
			if (!(err instanceof NoFamily)) throw err;
			kid = false;
		}
		kids.set(userId, kid);
	}
	return kid;
}

/**
 * What a child may open here: its agenda (only to look at, not its alarms), the fridge, homework,
 * series and music (#303; the house gives it only what is for children, media-api.ts), and its own
 * way out. Not the DJ: the grown-ups' (the house refuses it too).
 */
const KID_PAGES = ['/', '/agenda'];
const KID_SECTIONS = ['/nevera', '/deberes', '/series', '/watch', '/musica', '/logout'];
const KID_APIS = [
	'/api/auth',
	'/api/nevera',
	'/api/avisos',
	'/api/push',
	'/api/health',
	'/api/series',
	'/api/musica',
	'/api/music/playlists',
	'/api/subtitulos',
	// Its answers (#142); the grown-ups' homework APIs refuse a child themselves.
	'/api/deberes'
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export const kidMayOpen = (path: string, method: string) =>
	(KID_PAGES.includes(path) && (path !== '/agenda' || method === 'GET')) ||
	[...KID_SECTIONS, ...KID_APIS].some((prefix) => under(path, prefix));
