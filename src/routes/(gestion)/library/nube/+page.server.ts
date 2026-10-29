import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { forgetUnsent, resendUnsent, unsentAiCosts } from '#lib/server/cloud-ai-costs.ts';

/** Gestión → Nube: what the cloud did not get, to send again (#193). */
export const load: PageServerLoad = async () => ({ unsent: await unsentAiCosts() });

export const actions: Actions = {
	resend: async () => {
		const result = await resendUnsent();
		return result.error ? fail(502, result) : result;
	},
	forget: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: 'Gasto no válido' });
		await forgetUnsent(id);
	}
};
