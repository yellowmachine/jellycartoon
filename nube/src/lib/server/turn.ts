import { createHmac } from 'node:crypto';

/**
 * The servers a call's browser asks for its way to the other (#330): the VPS's coturn, as STUN
 * (where it is seen from outside) and as TURN (the sound through it, when there is no other way).
 * TURN's password is coturn's REST API one (`use-auth-secret`,
 * https://github.com/coturn/coturn/wiki/turnserver#turn-rest-api): the user is when it expires and
 * who, the password its HMAC-SHA1 with the shared secret, so nothing is kept per person and it is
 * no good after a day. A day: coturn checks it again while the call lasts.
 */
export const TURN_TTL_SECONDS = 24 * 60 * 60;

export interface IceServer {
	urls: string[];
	username?: string;
	credential?: string;
}

export function iceServers(
	userId: string,
	{ host, secret, now = Date.now() }: { host?: string; secret?: string; now?: number }
): IceServer[] {
	if (!host) return [];
	const stun: IceServer = { urls: [`stun:${host}:3478`] };
	if (!secret) return [stun];
	const username = `${Math.floor(now / 1000) + TURN_TTL_SECONDS}:${userId}`;
	const credential = createHmac('sha1', secret).update(username).digest('base64');
	return [
		stun,
		{
			urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`],
			username,
			credential
		}
	];
}
