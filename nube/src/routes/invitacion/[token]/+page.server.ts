import { error, fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '#lib/server/auth.ts';
import { invitations } from '#lib/server/invitations.ts';

/** What the link invites to, and who is looking: anyone with it, as svelte-thinking's. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const invitation = await invitations.byToken(params.token);
	if (!invitation) error(404, 'Esta invitación no existe: puede que te la hayan mandado de nuevo');
	return {
		invitation,
		me: locals.user ? { email: locals.user.email, name: locals.user.name } : null
	};
};

/** Better Auth's reasons for not making the account, as they are said here. */
const SIGN_UP_PROBLEMS: Record<string, string> = {
	USER_ALREADY_EXISTS: 'Ese email ya tiene cuenta: entra con ella para aceptar la invitación',
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
		'Ese email ya tiene cuenta: entra con ella para aceptar la invitación',
	PASSWORD_TOO_SHORT: 'La contraseña, de 10 caracteres por lo menos',
	PASSWORD_TOO_LONG: 'Esa contraseña es demasiado larga'
};

const familyNameOf = (form: FormData) =>
	String(form.get('familyName') ?? '')
		.trim()
		.slice(0, 60);

export const actions: Actions = {
	/** A new account, with the invitation's email, and in at once. */
	signUp: async ({ params, request }) => {
		const invitation = await invitations.byToken(params.token);
		if (!invitation || invitation.status !== 'pending')
			return fail(400, { message: 'Esta invitación ya no vale' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '')
			.trim()
			.slice(0, 60);
		const familyName = familyNameOf(form);
		if (!name) return fail(400, { message: 'Escribe tu nombre' });
		if (!invitation.familyName && !familyName)
			return fail(400, { message: 'Ponle un nombre a tu familia' });
		let created;
		try {
			created = await auth.api.signUpEmail({
				body: { email: invitation.email, password: String(form.get('password') ?? ''), name },
				headers: request.headers
			});
		} catch (err) {
			if (err instanceof APIError)
				return fail(400, {
					message: SIGN_UP_PROBLEMS[String(err.body?.code ?? '')] ?? err.message
				});
			throw err;
		}
		const accepted = await invitations.accept(params.token, created.user, familyName);
		if (!accepted.ok) return fail(400, { message: accepted.problem });
		redirect(303, '/');
	},
	/** With the account already in: into the family. */
	accept: async ({ params, request, locals }) => {
		if (!locals.user) redirect(303, `/login?next=/invitacion/${params.token}`);
		const accepted = await invitations.accept(
			params.token,
			locals.user,
			familyNameOf(await request.formData())
		);
		if (!accepted.ok) return fail(400, { message: accepted.problem });
		redirect(303, '/');
	}
};
