import { describe, expect, test } from 'bun:test';
import { FAMILY_CLAIM, idTokenAnswer } from './oidc-claims.ts';

const base = ['openid', 'profile', 'email'];

describe('a house', () => {
	const house = { familyId: 'f1' };
	test('its family gets in, with the family', () =>
		expect(idTokenAnswer('f1', base, house)).toEqual({
			ok: true,
			claims: { [FAMILY_CLAIM]: 'f1' }
		}));
	test('another family does not', () => expect(idTokenAnswer('f2', base, house).ok).toBe(false));
	test('nor someone of no family', () => expect(idTokenAnswer(null, base, house).ok).toBe(false));
});

describe('an app', () => {
	const app = { app: true };
	test('of anyone (Librarian): no family in the token', () => {
		expect(idTokenAnswer('f1', base, app)).toEqual({ ok: true, claims: {} });
		expect(idTokenAnswer(null, base, app)).toEqual({ ok: true, claims: {} });
	});
	test('of families (Langua): theirs with the scope', () =>
		expect(idTokenAnswer('f2', [...base, 'family'], app)).toEqual({
			ok: true,
			claims: { [FAMILY_CLAIM]: 'f2' }
		}));
	test('and not to someone of no family', () =>
		expect(idTokenAnswer(null, [...base, 'family'], app).ok).toBe(false));
});
