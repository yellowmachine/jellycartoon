import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { family, familyMember } from '#lib/server/db/schema.ts';
import { DEFAULT_THEME, isTheme } from 'comun/themes.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';
import { house } from '#lib/server/db/schema.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { aiBlockOf } from '#lib/server/family-settings.ts';
import { canReadReceipts } from '#lib/server/expenses/receipt.ts';
import { isServiceAdmin } from '#lib/server/invitations.ts';
import { isGuardian } from '#lib/server/kid-login.ts';

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
			theme: DEFAULT_THEME,
			guardian: false,
			aiBlocked: null
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
				/** A child's account (#303): its bar has only what it may open (nav.ts). */
				kid: m.role === 'peque',
				webUrl: h?.webUrl ?? null,
				hasHouse: Boolean(h),
				theme: isTheme(me?.theme) ? me.theme : DEFAULT_THEME,
				spendLine: Boolean(me?.spendLine)
			};
		});
		const k = await kitchenOf(locals.user.id);
		/** A receipt's photo from the bar (Gastos): with the family's AI to read it. */
		const receipts = !found.kid && (await canReadReceipts(k));
		/** An adult who lets children in (#303): asked on any page, and «Pasar a…» in the menu. */
		const guardian = !found.kid && (await isGuardian(k));
		/** The family's AI stopped (ai-block.ts): the banner, with «Ya he recargado», for who runs it. */
		const aiBlocked = found.admin ? await aiBlockOf(k) : null;
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
			theme: found.theme,
			guardian,
			aiBlocked: aiBlocked && { why: aiBlocked.why, at: aiBlocked.at.toISOString() }
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
				theme: DEFAULT_THEME,
				guardian: false,
				aiBlocked: null
			};
		throw error;
	}
};
