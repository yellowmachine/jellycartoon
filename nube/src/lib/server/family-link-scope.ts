import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import {
	family,
	familyLink,
	familyMember,
	familyPerson,
	pushSubscription,
	user
} from './db/schema.ts';
import { familyOnlyScope, familyScope, type AnyDb } from './family-scope.ts';
import { invitationExpiry } from '../invitation.ts';
import { newToken } from './invitation-scope.ts';

/**
 * Linked families (#464, family.schema.ts `family_link`): two families, in pairs, each still closed.
 * An adult of one makes a link (7 days, one use), an adult of the other accepts it, and from then
 * on their adults call each other (#330). Either removes it. Children take no part: they neither
 * make nor accept one, nor are seen by the other family. Apart from the app's database, to be tested
 * on PGlite as family-scope.ts; the app's are family-links.ts.
 */

/** An adult of a linked family, as their own family writes them. */
export interface LinkedPerson {
	userId: string;
	name: string;
	avatar: string | null;
	/** Whether any of their devices gets Seilide's notices. */
	notices: boolean;
}

export interface LinkedFamily {
	linkId: string;
	familyId: string;
	familyName: string;
	since: Date;
	people: LinkedPerson[];
}

/** A link of the family that waits for the other to accept it. */
export interface WaitingLink {
	id: string;
	token: string;
	expiresAt: Date;
	expired: boolean;
}

/** What a link's address invites to, for its page. */
export type FoundLink =
	| { kind: 'none' }
	| { kind: 'blocked'; problem: string; familyName?: string }
	| { kind: 'canAccept'; familyName: string; inviterName: string | null; expiresAt: Date };

export type LinkResult = { ok: true; familyName: string } | { ok: false; problem: string };

const ADULT_ONLY = 'Esto lo hace alguien mayor de tu familia.';

export function familyLinkScope(db: AnyDb, { role }: { role?: string } = {}) {
	const withFamily = familyScope(db, { role });
	const asFamily = familyOnlyScope(db, { role });

	/** Its name and its adults, read as that family: only what the link shares. */
	const familyOf = (familyId: string) =>
		asFamily(familyId, async (tx) => {
			const [f] = await tx.select({ name: family.name }).from(family);
			const adults = await tx
				.select({
					userId: familyMember.userId,
					account: user.name,
					person: familyPerson.name,
					avatar: familyPerson.avatar
				})
				.from(familyMember)
				.innerJoin(user, eq(user.id, familyMember.userId))
				.leftJoin(familyPerson, eq(familyPerson.userId, familyMember.userId))
				.where(ne(familyMember.role, 'peque'));
			const subscribed = new Set(
				(await tx.selectDistinct({ userId: pushSubscription.userId }).from(pushSubscription)).map(
					(r) => r.userId
				)
			);
			return {
				name: f?.name ?? 'Otra familia',
				people: adults
					.map((p) => ({
						userId: p.userId,
						name: p.person ?? p.account,
						avatar: p.avatar ?? null,
						notices: subscribed.has(p.userId)
					}))
					.sort((a, b) => a.name.localeCompare(b.name, 'es'))
			};
		});

	/**
	 * The link behind an address, as someone with an account sees it, inside a transaction where
	 * Postgres knows the token and their family. Null family: they have none.
	 */
	const withToken = <T>(
		token: string,
		userId: string,
		fn: (tx: AnyDb, mine: { familyId: string; role: string } | null) => Promise<T>
	) =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
			await tx.execute(sql`select set_config('app.link_token', ${token}, true)`);
			const [mine] = await tx
				.select({ familyId: familyMember.familyId, role: familyMember.role })
				.from(familyMember)
				.where(eq(familyMember.userId, userId));
			if (mine) await tx.execute(sql`select set_config('app.family_id', ${mine.familyId}, true)`);
			return fn(tx as unknown as AnyDb, mine ?? null);
		});

	/** Why this person cannot accept it; null, they can. */
	async function whyNot(
		tx: AnyDb,
		link: typeof familyLink.$inferSelect | undefined,
		mine: { familyId: string; role: string } | null
	) {
		if (!link) return 'Ese enlace no es de ningún vínculo, o ya se usó';
		if (link.toFamilyId) return 'Este enlace ya se usó';
		if (link.expiresAt <= new Date()) return 'Este enlace caducó: pide que te manden otro';
		if (!mine) return 'Para vincular tu familia, primero tienes que estar en una';
		if (mine.role === 'peque') return ADULT_ONLY;
		if (mine.familyId === link.fromFamilyId) return 'Es un enlace de tu propia familia';
		const [already] = await tx
			.select({ id: familyLink.id })
			.from(familyLink)
			.where(
				and(
					isNotNull(familyLink.toFamilyId),
					or(
						eq(familyLink.fromFamilyId, link.fromFamilyId),
						eq(familyLink.toFamilyId, link.fromFamilyId)
					)
				)
			);
		if (already) return 'Vuestras familias ya están vinculadas';
		return null;
	}

	/** The inviting family's name, read as it (the other family sees nothing else of it). */
	async function nameOf(tx: AnyDb, familyId: string, back: string | null) {
		await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
		const [f] = await tx.select({ name: family.name }).from(family);
		await tx.execute(sql`select set_config('app.family_id', ${back ?? ''}, true)`);
		return f?.name ?? 'Otra familia';
	}

	return {
		/** A new link to send to another family: its token. Only an adult. */
		async invite(
			userId: string
		): Promise<{ ok: true; token: string } | { ok: false; problem: string }> {
			return withFamily(userId, async (tx, m) => {
				if (m.role === 'peque') return { ok: false, problem: ADULT_ONLY };
				const token = newToken();
				await tx.insert(familyLink).values({
					id: randomUUID(),
					fromFamilyId: m.familyId,
					token,
					invitedBy: userId,
					expiresAt: invitationExpiry()
				});
				return { ok: true, token };
			});
		},

		/** The family's links: those accepted, with the other family, and those still waiting. */
		async ofFamily(userId: string): Promise<{ linked: LinkedFamily[]; waiting: WaitingLink[] }> {
			const { rows, familyId, kid } = await withFamily(userId, async (tx, m) => ({
				rows: await tx.select().from(familyLink),
				familyId: m.familyId,
				kid: m.role === 'peque'
			}));
			if (kid) return { linked: [], waiting: [] };
			const now = new Date();
			const waiting = rows
				.filter((r) => !r.toFamilyId && r.fromFamilyId === familyId && r.token)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.map((r) => ({
					id: r.id,
					token: r.token!,
					expiresAt: r.expiresAt,
					expired: r.expiresAt <= now
				}));
			const linked = await Promise.all(
				rows
					.filter((r) => r.toFamilyId)
					.map(async (r) => {
						const other = r.fromFamilyId === familyId ? r.toFamilyId! : r.fromFamilyId;
						const f = await familyOf(other);
						return {
							linkId: r.id,
							familyId: other,
							familyName: f.name,
							since: r.acceptedAt ?? r.createdAt,
							people: f.people
						};
					})
			);
			linked.sort((a, b) => a.familyName.localeCompare(b.familyName, 'es'));
			return { linked, waiting };
		},

		/**
		 * The adults of the families linked with theirs, whom they may call: none for a child. The
		 * same for every adult of the family: the link is the family's.
		 */
		async linked(userId: string): Promise<LinkedFamily[]> {
			return (await this.ofFamily(userId)).linked;
		},

		/** What a link's address invites to, as this person would accept it. */
		async byToken(token: string, userId: string): Promise<FoundLink> {
			return withToken(token, userId, async (tx, mine) => {
				const [link] = await tx.select().from(familyLink).where(eq(familyLink.token, token));
				if (!link) return { kind: 'none' };
				const familyName = await nameOf(tx, link.fromFamilyId, mine?.familyId ?? null);
				const problem = await whyNot(tx, link, mine);
				if (problem) return { kind: 'blocked', problem, familyName };
				const [inviter] = link.invitedBy
					? await tx.select({ name: user.name }).from(user).where(eq(user.id, link.invitedBy))
					: [];
				return {
					kind: 'canAccept',
					familyName,
					inviterName: inviter?.name ?? null,
					expiresAt: link.expiresAt
				};
			});
		},

		/** Accepted by an adult of another family: from now on, linked. */
		async accept(token: string, userId: string): Promise<LinkResult> {
			try {
				return await withToken(token, userId, async (tx, mine) => {
					const [link] = await tx
						.select()
						.from(familyLink)
						.where(eq(familyLink.token, token))
						.for('update');
					const problem = await whyNot(tx, link, mine);
					if (problem) return { ok: false, problem };
					const familyName = await nameOf(tx, link.fromFamilyId, mine!.familyId);
					await tx
						.update(familyLink)
						.set({
							toFamilyId: mine!.familyId,
							token: null,
							acceptedBy: userId,
							acceptedAt: new Date()
						})
						.where(and(eq(familyLink.id, link.id), isNull(familyLink.toFamilyId)));
					return { ok: true, familyName };
				});
			} catch (error) {
				// Accepted twice at once, or both families invited each other: the pair is unique.
				if (isUniqueViolation(error))
					return { ok: false, problem: 'Vuestras familias ya están vinculadas' };
				throw error;
			}
		},

		/** A link of the family removed, waiting or accepted: it stops at once. Only an adult. */
		async remove(userId: string, id: string): Promise<{ problem: string } | null> {
			return withFamily(userId, async (tx, m) => {
				if (m.role === 'peque') return { problem: ADULT_ONLY };
				await tx.delete(familyLink).where(eq(familyLink.id, id));
				return null;
			});
		},

		/**
		 * Whether this adult may call that one of a linked family: its family, or null. Both adults,
		 * the families linked now.
		 */
		async linkedFamilyOf(userId: string, otherId: string): Promise<LinkedFamily | null> {
			const families = await this.linked(userId);
			return families.find((f) => f.people.some((p) => p.userId === otherId)) ?? null;
		}
	};
}

export type FamilyLinks = ReturnType<typeof familyLinkScope>;

/** Postgres' «unique_violation» (23505), as postgres-js and PGlite give it, perhaps wrapped. */
function isUniqueViolation(error: unknown): boolean {
	for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as never)
		if (e.code === '23505') return true;
	return false;
}
