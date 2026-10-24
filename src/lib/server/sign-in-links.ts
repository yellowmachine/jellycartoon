/**
 * Better Auth's magic links (#172), never sent: made and spent by the server in the same request,
 * when an adult let a device of the house in from their phone (tv-login.ts). Its plugin hands each
 * one to `sendMagicLink` (auth.ts), which leaves it here for that request to take.
 */
const issued = new Map<string, string>();

export function keepSignInLink(email: string, token: string) {
	issued.set(email.toLowerCase(), token);
}

/** The token just made for this email, once. */
export function takeSignInLink(email: string) {
	const token = issued.get(email.toLowerCase());
	issued.delete(email.toLowerCase());
	return token;
}
