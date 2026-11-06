/**
 * What may be mailed for a forgotten password. A child's account has an address nobody reads and a
 * password of its own that the app keeps (kids.ts): never reset. And one email every few minutes
 * for each address: anyone can ask for anyone's, and `auth.api`, from the server, has no rate limit.
 */
export const KID_EMAIL_DOMAIN = 'peques.invalid';

const WAIT_MS = 5 * 60_000;
const lastMailed = new Map<string, number>();

export function mayMailReset(email: string, now = Date.now()) {
	const address = email.toLowerCase();
	if (address.endsWith(`@${KID_EMAIL_DOMAIN}`)) return false;
	for (const [known, at] of lastMailed) if (now - at >= WAIT_MS) lastMailed.delete(known);
	if (lastMailed.has(address)) return false;
	lastMailed.set(address, now);
	return true;
}
