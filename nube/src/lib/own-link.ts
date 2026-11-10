/**
 * A Seilide link shared to Seilide itself (Compartir → Seilide): the page it points at, to open it
 * here, or null for anything else. On an iPhone, a link from WhatsApp always opens in Safari; shared
 * to the app, «Vincular» (#464), an invitation or a walk open in it instead of landing in Recetas.
 * Only this same origin, so it can never send anyone elsewhere.
 */
export function ownPath(shared: string, origin: string): string | null {
	let link: URL;
	try {
		link = new URL(shared);
	} catch {
		return null;
	}
	if (link.origin !== origin) return null;
	const path = link.pathname + link.search + link.hash;
	return path.startsWith('/') && !path.startsWith('//') ? path : null;
}
