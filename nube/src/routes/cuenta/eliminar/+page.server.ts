import { error, fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { accountDeletion } from '#lib/server/account-deletion.ts';
import { auth } from '#lib/server/auth.ts';
import { isServiceAdmin } from '#lib/server/invitations.ts';

/**
 * The last step of «Eliminar mi cuenta» (#315), from the email's link. A page and not Better Auth's
 * own GET: something that opens links in an email (a mail server's scanner) would delete the
 * account. Only here, with its word written.
 */
const WORD = 'BORRAR';

export const load: PageServerLoad = async ({ url, locals }) => {
	const token = url.searchParams.get('token');
	if (!token) error(404, 'Este enlace no vale');
	return { token, word: WORD, state: await accountDeletion.stateOf(locals.user!.id) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		if (
			String(form.get('word') ?? '')
				.trim()
				.toUpperCase() !== WORD
		)
			return fail(400, { problem: `Escribe ${WORD} para confirmarlo` });
		if (isServiceAdmin(locals.user!.email))
			return fail(400, { problem: 'Eres quien administra el servicio: esa cuenta no se elimina' });
		// The token is spent on using it: what would stop it, said before.
		if ((await accountDeletion.stateOf(locals.user!.id)).kind === 'handOverFirst')
			return fail(400, { problem: 'Antes, pasa la administración a otro adulto' });
		try {
			await auth.api.deleteUserCallback({
				query: { token: String(form.get('token') ?? '') },
				headers: request.headers
			});
		} catch (err) {
			if (err instanceof APIError)
				return fail(400, {
					problem: 'Este enlace ya no vale. Pide otro correo desde Ajustes → Cuenta'
				});
			throw err;
		}
		redirect(303, '/cuenta/eliminada');
	}
};
