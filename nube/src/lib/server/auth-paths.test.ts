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
const auth = betterAuth({
	baseURL: 'http://localhost:3000',
	secret: 'una-clave-de-pruebas-de-mas-de-32-caracteres',
	database: memoryAdapter(store),
	emailAndPassword: { enabled: true },
	disabledPaths: DISABLED_PATHS
});

const body = { email: 'invitada@ejemplo.es', password: 'una-contraseña-larga', name: 'Invitada' };

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
		expect(store.user).toHaveLength(0);
	});

	test('from the server, as the invitation page does', async () => {
		const created = await auth.api.signUpEmail({ body });
		expect(created.user.email).toBe(body.email);
		expect(store.user).toHaveLength(1);
	});
});
