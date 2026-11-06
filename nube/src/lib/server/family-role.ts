import { eq, inArray } from 'drizzle-orm';
import { family, familyMember, user } from './db/schema.ts';
import type { familyScope } from './family-scope.ts';

export type HandedOver =
	| { ok: true; name: string; email: string; fromName: string; familyName: string }
	| { ok: false; problem: string };

/**
 * The administration of the family, from whoever has it to another of its adults (#315): at once,
 * no accepting. The two rows locked, in the same order whoever asks, and looked at again locked: two
 * doing it at the same time go one after the other, and the family never ends up with no one.
 * Someone of another family is not there to be found, by row-level security.
 */
export function handOverAdmin(
	withFamily: ReturnType<typeof familyScope>,
	from: string,
	to: string
): Promise<HandedOver> {
	return withFamily(from, async (tx, membership) => {
		const rows = await tx
			.select({ userId: familyMember.userId, role: familyMember.role })
			.from(familyMember)
			.where(inArray(familyMember.userId, [from, to]))
			.orderBy(familyMember.userId)
			.for('update');
		const me = rows.find((r) => r.userId === from);
		const them = from === to ? undefined : rows.find((r) => r.userId === to);
		if (me?.role !== 'admin') return { ok: false, problem: 'Solo quien administra la familia' };
		if (them?.role !== 'member')
			return { ok: false, problem: 'Solo a un adulto de la familia que no la administre' };

		await tx.update(familyMember).set({ role: 'admin' }).where(eq(familyMember.userId, to));
		await tx.update(familyMember).set({ role: 'member' }).where(eq(familyMember.userId, from));

		const names = await tx
			.select({ id: user.id, name: user.name, email: user.email })
			.from(user)
			.where(inArray(user.id, [from, to]));
		const [f] = await tx
			.select({ name: family.name })
			.from(family)
			.where(eq(family.id, membership.familyId));
		const target = names.find((n) => n.id === to)!;
		return {
			ok: true,
			name: target.name,
			email: target.email,
			fromName: names.find((n) => n.id === from)!.name,
			familyName: f.name
		};
	});
}

/** The family's adults, by what they are: who administers, and who it can be handed over to. */
export async function adminsAndAdults(
	withFamily: ReturnType<typeof familyScope>,
	userId: string
): Promise<{ admins: { id: string; name: string }[]; others: { id: string; name: string }[] }> {
	const rows = await withFamily(userId, (tx) =>
		tx
			.select({ id: user.id, name: user.name, role: familyMember.role })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.orderBy(user.name)
	);
	const person = ({ id, name }: { id: string; name: string }) => ({ id, name });
	return {
		admins: rows.filter((r) => r.role === 'admin').map(person),
		others: rows.filter((r) => r.role === 'member').map(person)
	};
}
