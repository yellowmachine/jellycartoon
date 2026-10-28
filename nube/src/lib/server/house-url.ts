/** The house's address (house.ts), apart to be tested. */

/** Without its trailing slash, and only https: the key goes with each request. */
export function houseUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.pathname !== '/' || url.search) return null;
	return url.origin;
}
