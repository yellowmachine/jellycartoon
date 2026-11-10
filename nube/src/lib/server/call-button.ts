import { eq } from 'drizzle-orm';
import { familyMember, familyPerson, user } from './db/schema.ts';
import type { AnyDb, Membership } from './family-scope.ts';

/**
 * «Botón de llamar siempre a mano» (#330): the big green phone at the bottom right, for
 * grandparents. Each one's, off by default; they or another adult of the family set it (a child
 * cannot: their adults do it for them). Its favorites, up to three of the family's accounts: one
 * alone is called with a tap; otherwise it opens Llamadas, with them first.
 */
export const MAX_FAVORITES = 3;

type WithFamily = <T>(userId: string, fn: (tx: AnyDb, m: Membership) => Promise<T>) => Promise<T>;

export interface CallButton {
	userId: string;
	on: boolean;
	/** In the order they were chosen; only accounts still in the family, never themselves. */
	favorites: string[];
}

/** The family's accounts: who may be a favorite, with their name as the family writes it. */
async function accounts(tx: AnyDb) {
	return tx
		.select({
			userId: familyMember.userId,
			role: familyMember.role,
			on: familyMember.callButton,
			favorites: familyMember.callFavorites,
			name: user.name,
			person: familyPerson.name,
			avatar: familyPerson.avatar
		})
		.from(familyMember)
		.innerJoin(user, eq(user.id, familyMember.userId))
		.leftJoin(familyPerson, eq(familyPerson.userId, familyMember.userId));
}

/** Their favorites that are still there, in order, without themselves nor repeats. */
function cleanFavorites(favorites: unknown, self: string, there: Set<string>) {
	if (!Array.isArray(favorites)) return [];
	const seen = new Set<string>();
	for (const f of favorites)
		if (typeof f === 'string' && f !== self && there.has(f) && !seen.has(f)) seen.add(f);
	return [...seen].slice(0, MAX_FAVORITES);
}

export function callButtonStore(withFamily: WithFamily) {
	return {
		/** Theirs, for every page: off, or on with their favorites' names (layout). */
		async of(userId: string) {
			return withFamily(userId, async (tx) => {
				const people = await accounts(tx);
				const me = people.find((p) => p.userId === userId);
				if (!me?.on) return null;
				const there = new Set(people.map((p) => p.userId));
				const byId = new Map(people.map((p) => [p.userId, p]));
				return {
					favorites: cleanFavorites(me.favorites, userId, there).map((id) => {
						const p = byId.get(id)!;
						return { userId: id, name: p.person ?? p.name, avatar: p.avatar };
					})
				};
			});
		},

		/** Everyone's in the family (Ajustes): an adult sees and sets them all. */
		async all(userId: string): Promise<CallButton[]> {
			return withFamily(userId, async (tx) => {
				const people = await accounts(tx);
				const there = new Set(people.map((p) => p.userId));
				return people.map((p) => ({
					userId: p.userId,
					on: p.on,
					favorites: cleanFavorites(p.favorites, p.userId, there)
				}));
			});
		},

		/** Set by them or another adult of the family: whether it is on, and who it calls. */
		async set(
			byUserId: string,
			forUserId: string,
			on: boolean,
			favorites: string[]
		): Promise<{ problem: string } | null> {
			return withFamily(byUserId, async (tx, m) => {
				if (m.role === 'peque') return { problem: 'Esto lo cambia alguien mayor de tu familia.' };
				const people = await accounts(tx);
				if (!people.some((p) => p.userId === forUserId))
					return { problem: 'No está en tu familia.' };
				const chosen = cleanFavorites(favorites, forUserId, new Set(people.map((p) => p.userId)));
				await tx
					.update(familyMember)
					.set({ callButton: on, callFavorites: chosen })
					.where(eq(familyMember.userId, forUserId));
				return null;
			});
		}
	};
}
