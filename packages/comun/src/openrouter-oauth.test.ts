import { describe, expect, test } from 'bun:test';
import { openRouterAuth, pendingAuth } from './openrouter-oauth.ts';

describe('openRouterAuth', () => {
	test('PKCE S256: the challenge is the verifier hashed, with the way back and a state', async () => {
		const { url, verifier, state } = openRouterAuth(
			'https://casa.example/ajustes/openrouter',
			'JellyCartoon'
		);
		const link = new URL(url);
		expect(link.origin + link.pathname).toBe('https://openrouter.ai/auth');
		expect(link.searchParams.get('callback_url')).toBe('https://casa.example/ajustes/openrouter');
		expect(link.searchParams.get('code_challenge_method')).toBe('S256');
		expect(link.searchParams.get('state')).toBe(state);
		expect(link.searchParams.get('key_label')).toBe('JellyCartoon');
		const hash = new Uint8Array(
			await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
		);
		expect(link.searchParams.get('code_challenge')).toBe(Buffer.from(hash).toString('base64url'));
	});
});

test('pendingAuth: what the cookie says, or nothing', () => {
	expect(pendingAuth('{"verifier":"v","state":"s"}')).toEqual({ verifier: 'v', state: 's' });
	expect(pendingAuth(undefined)).toEqual({});
	expect(pendingAuth('no')).toEqual({});
	expect(pendingAuth('null')).toEqual({});
});
