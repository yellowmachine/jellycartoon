import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { answer, requestByCode } from '#lib/server/tv-login.ts';
import { avatarOf } from '#lib/server/people.ts';

/**
 * On the phone (#172): the QR of a device of the house, or its notice. Only the person who chose
 * their drawing there can let it in, and it says where.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const code = url.searchParams.get('codigo') ?? '';
	if (!code) error(404, 'Este código no está completo');
	const request = await requestByCode(code);
	if (!request) return { state: 'late' as const };
	if (request.userId !== locals.user!.id)
		return { state: 'not-yours' as const, name: request.name };
	return {
		state: 'ask' as const,
		name: request.name,
		device: request.device,
		avatar: (await avatarOf(locals.user!))?.id ?? null
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const code = url.searchParams.get('codigo') ?? '';
		const yes = (await request.formData()).get('answer') === 'yes';
		const result = await answer(code, locals.user!.id, yes);
		if (result === 'late') return fail(410, { message: 'Este código ya no vale: pídelo otra vez' });
		if (result === 'not-yours') return fail(403, { message: 'Este código no es para ti' });
		return { done: result };
	}
};
