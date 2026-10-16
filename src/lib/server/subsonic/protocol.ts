import { createHash, timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { APP_VERSION } from '$app/env/private';

/**
 * The Subsonic protocol (https://www.subsonic.org/pages/api.jsp, and OpenSubsonic's additions,
 * https://opensubsonic.netlify.app), what music apps such as Tempus speak (#27). Only JSON: it is
 * what they ask for (`f=json`).
 */

export const API_VERSION = '1.16.1';

/** Its error codes. */
export const ERROR = {
	generic: 0,
	missingParameter: 10,
	wrongCredentials: 40,
	notAuthorized: 50,
	notFound: 70
} as const;

const envelope = (body: Record<string, unknown>) => ({
	'subsonic-response': {
		version: API_VERSION,
		type: 'jellycartoon',
		serverVersion: APP_VERSION,
		openSubsonic: true,
		...body
	}
});

/** An answer: what the method returns, inside the envelope. */
export const ok = (payload: Record<string, unknown> = {}) =>
	json(envelope({ status: 'ok', ...payload }));

/** A failure: with HTTP 200, as the protocol does, and its code. */
export const failed = (code: number, message: string) =>
	json(envelope({ status: 'failed', error: { code, message } }));

/** The password the app sent as `p`: as is, or hex after `enc:`. */
export function plainPassword(p: string) {
	return p.startsWith('enc:') ? Buffer.from(p.slice(4), 'hex').toString('utf8') : p;
}

const same = (a: string, b: string) => {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Whether the app knows `password`: `t` = md5(password + `s`) (the usual way, the password never
 * travels), or the password itself in `p`.
 */
export function passwordMatches(
	password: string,
	params: { t?: string | null; s?: string | null; p?: string | null }
) {
	if (params.t && params.s) {
		const expected = createHash('md5')
			.update(password + params.s)
			.digest('hex');
		return same(expected, params.t.toLowerCase());
	}
	if (params.p) return same(password, plainPassword(params.p));
	return false;
}
