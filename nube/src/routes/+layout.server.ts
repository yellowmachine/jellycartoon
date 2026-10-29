import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { family, familyMember } from '#lib/server/db/schema.ts';
import { DEFAULT_THEME, isTheme } from 'comun/themes.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';
import { house } from '#lib/server/db/schema.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { canReadReceipts } from '#lib/server/expenses/receipt.ts';
import { isServiceAdmin } from '#lib/server/invitations.ts';

/** Who is in, and their family: null if their account is in none. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user)
		return {
			user: null,
			family: null,
			webUrl: null,
			hasHouse: false,
			receipts: false,
			spendLine: false,
			theme: DEFAULT_THEME
		};
	const user = {
		name: locals.user.name,
		email: locals.user.email,
		/** Who lets families in (/admin/lista-de-espera): ADMIN_EMAIL. */
		serviceAdmin: isServiceAdmin(locals.user.email)
	};
	try {
		const found = await withFamily(locals.user.id, async (tx, m) => {
			const [h] = await tx.select({ webUrl: house.webUrl }).from(house);
			const [f] = await tx
				.select({ name: family.name })
				.from(family)
				.where(eq(family.id, m.familyId));
			const [me] = await tx
				.select({ theme: familyMember.theme, spendLine: familyMember.spendLine })
				.from(familyMember)
				.where(eq(familyMember.userId, locals.user!.id));
			return {
				name: f.name,
				admin: m.role === 'admin',
				webUrl: h?.webUrl ?? null,
				hasHouse: Boolean(h),
				theme: isTheme(me?.theme) ? me.theme : DEFAULT_THEME,
				spendLine: Boolean(me?.spendLine)
			};
		});
		/** A receipt's photo from the bar (Gastos): with the family's AI to read it. */
		const receipts = await canReadReceipts(await kitchenOf(locals.user.id));
		/** jellycartoon's own address, for the bar's sections of the house (nav.ts). */
		return {
			user,
			family: found,
			webUrl: found.webUrl,
			/** A house connected (Ajustes): without one, the bar shows nothing of it (nav.ts). */
			hasHouse: found.hasHouse,
			receipts,
			/** The AI's spending under the header (#193): who asked, with the family's key (as receipts). */
			spendLine: found.spendLine && receipts,
			/** Their colours (Ajustes), painted from the server: no flash of the default. */
			theme: found.theme
		};
	} catch (error) {
		if (error instanceof NoFamily)
			return {
				user,
				family: null,
				webUrl: null,
				hasHouse: false,
				receipts: false,
				spendLine: false,
				theme: DEFAULT_THEME
			};
		throw error;
	}
};
