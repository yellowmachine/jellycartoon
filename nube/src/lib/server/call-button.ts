import { eq } from 'drizzle-orm';
import { familyMember, familyPerson, user } from './db/schema.ts';
import type { AnyDb, Membership } from './family-scope.ts';
import type { FamilyLinks, LinkedFamily } from './family-link-scope.ts';

/**
 * «Botón de llamar siempre a mano» (#330): the big green phone at the bottom right, for
 * grandparents. Each one's, off by default; they or another adult of the family set it (a child
 * cannot: their adults do it for them). Its favorites, up to three of the family's accounts or, for
 * an adult, of the adults of a linked family (#464): one alone is called with a tap; otherwise it
 * opens Llamadas, with them first.
 */
export const MAX_FAVORITES = 3;

type WithFamily = <T>(userId: string, fn: (tx: AnyDb, m: Membership) => Promise<T>) => Promise<T>;

export interface CallButton {
	userId: string;
	on: boolean;
	/** A child: their favorites only of their own family (#464). */
	kid: boolean;
	/** In the order they were chosen; only those they can still call, never themselves. */
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

/** The linked families' adults, by user: whom an adult may also choose. */
const linkedPeople = (families: LinkedFamily[]) =>
	new Map(families.flatMap((f) => f.people.map((p) => [p.userId, p] as const)));

export function callButtonStore(withFamily: WithFamily, links: Pick<FamilyLinks, 'linked'>) {
	return {
		/** Theirs, for every page: off, or on with their favorites' names (layout). */
		async of(userId: string) {
			const mine = await withFamily(userId, async (tx) => {
				const people = await accounts(tx);
				const me = people.find((p) => p.userId === userId);
				return me?.on ? { me, people } : null;
			});
			if (!mine) return null;
			const byId = new Map(
				mine.people.map((p) => [p.userId, { name: p.person ?? p.name, avatar: p.avatar }])
			);
			// Only an adult has someone of a linked family among theirs.
			const wanted = Array.isArray(mine.me.favorites) ? mine.me.favorites : [];
			if (mine.me.role !== 'peque' && wanted.some((f) => !byId.has(f)))
				for (const [id, p] of linkedPeople(await links.linked(userId)))
					if (!byId.has(id)) byId.set(id, { name: p.name, avatar: p.avatar });
			return {
				favorites: cleanFavorites(wanted, userId, new Set(byId.keys())).map((id) => ({
					userId: id,
					...byId.get(id)!
				}))
			};
		},

		/** Everyone's in the family (Ajustes): an adult sees and sets them all. */
		async all(userId: string): Promise<CallButton[]> {
			const people = await withFamily(userId, accounts);
			const own = new Set(people.map((p) => p.userId));
			const withLinked = new Set([...own, ...linkedPeople(await links.linked(userId)).keys()]);
			return people.map((p) => ({
				userId: p.userId,
				on: p.on,
				kid: p.role === 'peque',
				favorites: cleanFavorites(p.favorites, p.userId, p.role === 'peque' ? own : withLinked)
			}));
		},

		/** Set by them or another adult of the family: whether it is on, and who it calls. */
		async set(
			byUserId: string,
			forUserId: string,
			on: boolean,
			favorites: string[]
		): Promise<{ problem: string } | null> {
			const linked = linkedPeople(await links.linked(byUserId));
			return withFamily(byUserId, async (tx, m) => {
				if (m.role === 'peque') return { problem: 'Esto lo cambia alguien mayor de tu familia.' };
				const people = await accounts(tx);
				const whose = people.find((p) => p.userId === forUserId);
				if (!whose) return { problem: 'No está en tu familia.' };
				const there = new Set(people.map((p) => p.userId));
				if (whose.role !== 'peque') for (const id of linked.keys()) there.add(id);
				const chosen = cleanFavorites(favorites, forUserId, there);
				await tx
					.update(familyMember)
					.set({ callButton: on, callFavorites: chosen })
					.where(eq(familyMember.userId, forUserId));
				return null;
			});
		}
	};
}
