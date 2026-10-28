import { parseCoordinates } from 'comun/coordinates.ts';
import type { LngLat } from 'comun/road.ts';

/**
 * A place shared to the app from a map (the manifest's share_target, «Compartir → JellyCartoon» in
 * Google Maps): where it is, and its name if it came with one. Google's short links
 * (maps.app.goo.gl) say nothing until followed, and a place shared from its phone app often has no
 * coordinates even then, only its name and address: those are searched (`search`).
 */
export interface SharedPlace {
	/** Its name, when it came with one: Google's place in the link, or the text before it. */
	name: string | null;
	/** Where it is, when the link or the text said it. */
	at: LngLat | null;
	/** Without `at`: what to search for it, its name and address as Google wrote them. */
	search: string | null;
}

/** Whether what was shared is about a map (and not, say, a recipe's page). */
export function isMapShare(text: string): boolean {
	const link = firstLink(text);
	if (link) return mapLink(link) !== null;
	return /^geo:/i.test(text.trim()) || parseCoordinates(text) !== null;
}

export async function sharedPlace(text: string): Promise<SharedPlace | null> {
	const link = firstLink(text);
	// Plain coordinates, or a `geo:` one, without anything else.
	if (!link) {
		const at = parseCoordinates(text);
		return at ? { name: null, at, search: null } : null;
	}
	const kind = mapLink(link);
	if (!kind) return null;
	const final = kind === 'short' ? await follow(link) : link;
	if (!final) return null;
	// The words before the link («Restaurante Casa Pepe https://maps.app.goo.gl/…»), as the name.
	const before = text.slice(0, text.indexOf(link)).trim().replace(/\s+/g, ' ') || null;
	const named = googlePlaceName(final);
	const name = before ?? named?.split(',')[0]?.trim() ?? null;
	const at = parseCoordinates(final);
	if (at) return { name, at, search: null };
	return named || before ? { name, at: null, search: named ?? before } : null;
}

function firstLink(text: string): string | null {
	return text.match(/https?:\/\/\S+/)?.[0] ?? null;
}

/** `short`: Google's, followed to know where it goes; `map`: one that says it as it is. */
function mapLink(link: string): 'short' | 'map' | null {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^www\./, '');
	if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && url.pathname.startsWith('/maps')))
		return 'short';
	if (isGoogle(host) && (host.startsWith('maps.') || url.pathname.startsWith('/maps')))
		return 'map';
	if (host === 'openstreetmap.org' || host === 'osm.org') return 'map';
	return null;
}

const isGoogle = (host: string) => /^(?:[\w-]+\.)*google\.[a-z.]+$/.test(host);

/**
 * Where a short link goes, by its redirects, one at a time and only between Google's own addresses.
 * From Europe Google may send it to its cookie notice first: the place is in its `continue`.
 */
async function follow(link: string): Promise<string | null> {
	let at = link;
	for (let hop = 0; hop < 5; hop++) {
		const url = new URL(at);
		if (url.hostname === 'consent.google.com') {
			const next = url.searchParams.get('continue');
			return next && mapLink(next) === 'map' ? next : null;
		}
		if (hop > 0 && mapLink(at) === 'map') return at;
		const res = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(8_000) }).catch(
			() => null
		);
		const next = res?.headers.get('location');
		if (!next) return hop > 0 ? at : null;
		at = new URL(next, at).href;
		const host = new URL(at).hostname;
		if (!isGoogle(host) && host !== 'goo.gl' && host !== 'maps.app.goo.gl') return null;
	}
	return null;
}

/** «/maps/place/Casa+Pepe,+Calle+Mayor,+5,+Toledo/…»: «Casa Pepe, Calle Mayor, 5, Toledo». */
function googlePlaceName(link: string): string | null {
	const piece = new URL(link).pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
	if (!piece) return null;
	const name = decodeURIComponent(piece.replace(/\+/g, ' ')).trim();
	return name && !parseCoordinates(name) ? name : null;
}
