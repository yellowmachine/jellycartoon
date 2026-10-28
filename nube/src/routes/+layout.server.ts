import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { family } from '#lib/server/db/schema.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';
import { house } from '#lib/server/db/schema.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { canReadReceipts } from '#lib/server/expenses/receipt.ts';

/** Who is in, and their family: null if their account is in none. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null, family: null, webUrl: null, receipts: false };
	const user = { name: locals.user.name, email: locals.user.email };
	try {
		const found = await withFamily(locals.user.id, async (tx, m) => {
			const [h] = await tx.select({ webUrl: house.webUrl }).from(house);
			const [f] = await tx
				.select({ name: family.name })
				.from(family)
				.where(eq(family.id, m.familyId));
			return { name: f.name, admin: m.role === 'admin', webUrl: h?.webUrl ?? null };
		});
		/** A receipt's photo from the bar (Gastos): with the family's AI to read it. */
		const receipts = await canReadReceipts(await kitchenOf(locals.user.id));
		/** jellycartoon's own address, for the bar's sections of the house (nav.ts). */
		return { user, family: found, webUrl: found.webUrl, receipts };
	} catch (error) {
		if (error instanceof NoFamily) return { user, family: null, webUrl: null, receipts: false };
		throw error;
	}
};
