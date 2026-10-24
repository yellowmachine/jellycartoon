import { error, fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { invitationByToken } from '#lib/server/invitations.ts';
import { avatarOf } from '#lib/server/people.ts';
import { log } from '#lib/server/log.ts';

/**
 * An adult the administrator added chooses their password (#157), with the link or QR they were
 * given: the first time, or after forgetting it. Then they are in.
 */

async function personOf(token: string) {
	const link = await invitationByToken(token);
	if (link.state !== 'valid') return { state: link.state };
	const [person] = await db
		.select({ id: user.id, name: user.name, email: user.email, role: user.role })
		.from(user)
		.where(eq(user.id, link.userId));
	if (!person) return { state: 'gone' as const };
	return { state: 'valid' as const, person };
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const token = url.searchParams.get('token') ?? '';
	if (!token) error(404, 'Este enlace no está completo');
	const found = await personOf(token);
	if (found.state !== 'valid') return { state: found.state };
	const drawing = await avatarOf(found.person);
	return {
		state: found.state,
		name: found.person.name,
		email: found.person.email,
		avatar: drawing?.id ?? null,
		/** Someone else is in on this device: choosing the password changes who. */
		signedInAs: locals.user && locals.user.id !== found.person.id ? locals.user.name : null
	};
};

export const actions: Actions = {
	default: async ({ request, url, locals }) => {
		const token = url.searchParams.get('token') ?? '';
		const password = String((await request.formData()).get('password') ?? '');
		const found = await personOf(token);
		if (found.state !== 'valid') return fail(400, { message: 'Este enlace ya no vale' });
		try {
			await auth.api.resetPassword({ body: { newPassword: password, token } });
		} catch (err) {
			if (!(err instanceof APIError)) throw err;
			const tooShort = err.body?.code === 'PASSWORD_TOO_SHORT';
			return fail(400, {
				message: tooShort
					? 'La contraseña, de 8 caracteres o más'
					: 'No se pudo guardar la contraseña'
			});
		}
		log.info('cuentas', `Contraseña elegida con su enlace: ${found.person.name}`);
		// This device was someone else's: out, before entering as this person.
		if (locals.session) await auth.api.signOut({ headers: request.headers });
		const result = await auth.api.signInEmail({
			body: { email: found.person.email, password },
			headers: request.headers
		});
		// With a second step already (a forgotten password): the code, on the login page.
		if ('twoFactorRedirect' in result && result.twoFactorRedirect) redirect(303, '/login?cambiada');
		redirect(303, '/ajustes?seccion=cuenta&bienvenida');
	}
};
