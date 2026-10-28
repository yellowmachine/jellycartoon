import { fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import QRCode from 'qrcode';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { withFamily } from '#lib/server/family.ts';
import {
	askHouse,
	forgetHouse,
	houseLink,
	HouseProblem,
	houseUrl,
	saveHouse
} from '#lib/server/house.ts';

export const load: PageServerLoad = async ({ locals }) => ({
	house: await houseLink(locals.user!.id),
	twoFactor: Boolean(locals.user!.twoFactorEnabled)
});

/** Only the family's administrator connects its house. */
async function requireAdmin(userId: string) {
	const admin = await withFamily(userId, async (_, m) => m.role === 'admin');
	if (!admin) return fail(403, { houseProblem: 'Solo quien administra la familia' });
	return null;
}

export const actions: Actions = {
	/** Its address (jellycartoon's MEDIA_HOST) and the key made in its Ajustes → Casa → «La nube». */
	saveHouse: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id);
		if (denied) return denied;
		const form = await request.formData();
		const url = houseUrl(String(form.get('url') ?? ''));
		if (!url) return fail(400, { houseProblem: 'La dirección, con https://, sin nada detrás' });
		const key = String(form.get('key') ?? '').trim() || null;
		if (!key && !(await houseLink(locals.user!.id)))
			return fail(400, { houseProblem: 'Falta la clave' });
		await saveHouse(locals.user!.id, url, key);
		return { saved: 'house' };
	},
	forgetHouse: async ({ locals }) => {
		const denied = await requireAdmin(locals.user!.id);
		if (denied) return denied;
		await forgetHouse(locals.user!.id);
		return { saved: 'house' };
	},
	/** The house asked in this person's name: its series, as the road mode will. */
	testHouse: async ({ locals }) => {
		try {
			const { series } = await askHouse<{ series: unknown[] }>(
				locals.user!.id,
				locals.user!.email,
				'/series'
			);
			return { houseOk: `La casa contesta: ${series.length} series para ti` };
		} catch (error) {
			if (error instanceof HouseProblem) return fail(502, { houseProblem: error.message });
			throw error;
		}
	},
	/** The second step: the password, then its QR and recovery codes, then a code to turn it on. */
	enableTwoFactor: async ({ request }) => {
		const password = String((await request.formData()).get('password') ?? '');
		try {
			const result = await auth.api.enableTwoFactor({
				body: { password },
				headers: request.headers
			});
			// Codes by an app (TOTP): the plugin's default, as configured in auth.ts.
			if (result.method !== 'totp') throw new Error('Se esperaba TOTP');
			const { totpURI, backupCodes } = result;
			return { totpQr: await QRCode.toDataURL(totpURI), totpURI, backupCodes };
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { twoFactorProblem: 'Contraseña incorrecta' });
			throw error;
		}
	},
	confirmTwoFactor: async ({ request }) => {
		const code = String((await request.formData()).get('code') ?? '').replace(/\s+/g, '');
		try {
			await auth.api.verifyTOTP({ body: { code }, headers: request.headers });
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { twoFactorProblem: 'Ese código no vale: mira el de ahora en tu app' });
			throw error;
		}
		return { saved: 'twoFactor' };
	},
	disableTwoFactor: async ({ request }) => {
		const password = String((await request.formData()).get('password') ?? '');
		try {
			await auth.api.disableTwoFactor({ body: { password }, headers: request.headers });
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { twoFactorProblem: 'Contraseña incorrecta' });
			throw error;
		}
		return { saved: 'twoFactor' };
	}
};
