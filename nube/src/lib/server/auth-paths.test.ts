import { describe, expect, test } from 'bun:test';
import { betterAuth } from 'better-auth/minimal';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { DISABLED_PATHS } from './auth-paths.ts';

/**
 * Signing up only from an invitation's page (#287): with Seilide's closed paths, over HTTP it is
 * not there, even for an email with an invitation; from the server (the page's action), it is.
 */
const store: Record<string, Record<string, unknown>[]> = {
	user: [],
	session: [],
	account: [],
	verification: []
};
const mailed: string[] = [];
const auth = betterAuth({
	baseURL: 'http://localhost:3000',
	secret: 'una-clave-de-pruebas-de-mas-de-32-caracteres',
	database: memoryAdapter(store),
	emailAndPassword: {
		enabled: true,
		sendResetPassword: async ({ token }) => {
			mailed.push(token);
		}
	},
	disabledPaths: DISABLED_PATHS
});

const body = { email: 'invitada@ejemplo.es', password: 'una-contraseña-larga', name: 'Invitada' };

describe('a forgotten password', () => {
	const post = (path: string, payload: object) =>
		auth.handler(
			new Request(`http://localhost:3000/api/auth${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
				body: JSON.stringify(payload)
			})
		);

	test('over HTTP, neither asking nor changing it is there', async () => {
		expect((await post('/request-password-reset', { email: body.email })).status).toBe(404);
		expect(
			(await post('/reset-password', { newPassword: 'otra-muy-larga', token: 'x' })).status
		).toBe(404);
	});

	test('from the server, as its pages do: the new one enters, and the link is spent', async () => {
		await auth.api.signUpEmail({ body: { ...body, email: 'olvida@ejemplo.es' } });
		await auth.api.requestPasswordReset({ body: { email: 'olvida@ejemplo.es' } });
		expect(mailed).toHaveLength(1);
		const token = mailed[0]!;
		await auth.api.resetPassword({ body: { newPassword: 'otra-muy-larga', token } });
		const entered = await auth.api.signInEmail({
			body: { email: 'olvida@ejemplo.es', password: 'otra-muy-larga' }
		});
		expect(entered.user.email).toBe('olvida@ejemplo.es');
		await expect(
			auth.api.resetPassword({ body: { newPassword: 'y-otra-mas-larga', token } })
		).rejects.toThrow();
	});
});

describe('signing up', () => {
	test('over HTTP, not there', async () => {
		const res = await auth.handler(
			new Request('http://localhost:3000/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
				body: JSON.stringify(body)
			})
		);
		expect(res.status).toBe(404);
		expect(store.user.some((u) => u.email === body.email)).toBe(false);
	});

	test('from the server, as the invitation page does', async () => {
		const created = await auth.api.signUpEmail({ body });
		expect(created.user.email).toBe(body.email);
		expect(store.user.some((u) => u.email === body.email)).toBe(true);
	});
});
