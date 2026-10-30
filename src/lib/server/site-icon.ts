import { fetchPublic, fetchPublicBytes } from '#lib/server/public-fetch.ts';

/**
 * A site's own icon, big enough for the TV (#327): the one its page declares for phones' home
 * screens (its web app manifest's, or `apple-touch-icon`), not the favicon, blurry at that size.
 * Only PNG, JPEG and WebP: an SVG served from the house's address could run its scripts there.
 */

/** Smaller ones look blurry on the TV's tiles. */
const MIN_SIZE = 96;
const PAGE_MAX = 2_000_000;
const ICON_MAX = 1_000_000;
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; JellyCartoon)' };

export interface IconCandidate {
	url: string;
	/** Its declared width; 0 if it does not say. */
	size: number;
}

/** An `<link …>` or tag's attributes, lowercase names. */
function attributes(tag: string) {
	const found = new Map<string, string>();
	for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
		found.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
	return found;
}

/** «192x192 512x512» → 512; «any» (a vector) or nothing → 0. */
function largest(sizes: string | undefined) {
	return Math.max(
		0,
		...(sizes ?? '').split(/\s+/).map((s) => Number(/^(\d+)x\d+$/i.exec(s)?.[1] ?? 0))
	);
}

/** What its page declares: the manifest's address, and its touch and big icons. */
export function pageIcons(html: string, base: string) {
	const icons: IconCandidate[] = [];
	let manifest: string | null = null;
	const resolve = (href: string) => {
		try {
			return new URL(href, base).href;
		} catch {
			return null;
		}
	};
	for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
		const a = attributes(tag);
		const rel = (a.get('rel') ?? '').toLowerCase().split(/\s+/);
		const href = a.get('href') && resolve(a.get('href')!);
		if (!href) continue;
		if (rel.includes('manifest')) manifest ??= href;
		else if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed'))
			// Without sizes, Apple's own: 180 px.
			icons.push({ url: href, size: largest(a.get('sizes')) || 180 });
		else if (rel.includes('icon')) icons.push({ url: href, size: largest(a.get('sizes')) });
	}
	return { manifest, icons };
}

/** A web app manifest's icons (https://developer.mozilla.org/docs/Web/Manifest/icons). */
export function manifestIcons(json: unknown, base: string): IconCandidate[] {
	const icons = (json as { icons?: unknown })?.icons;
	if (!Array.isArray(icons)) return [];
	return icons.flatMap((i: { src?: unknown; sizes?: unknown; purpose?: unknown }) => {
		if (typeof i?.src !== 'string') return [];
		// One colour only, for the system to paint: not a picture.
		if (typeof i.purpose === 'string' && /^\s*monochrome\s*$/.test(i.purpose)) return [];
		try {
			return [
				{
					url: new URL(i.src, base).href,
					size: largest(typeof i.sizes === 'string' ? i.sizes : undefined)
				}
			];
		} catch {
			return [];
		}
	});
}

/** The biggest first, of those big enough. */
export const bestFirst = (icons: IconCandidate[]) =>
	icons.filter((i) => i.size >= MIN_SIZE).sort((a, b) => b.size - a.size);

/** Its kind by its first bytes, not by what the site says it is. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
	const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
	if (at(0, 0xff, 0xd8, 0xff)) return 'jpg';
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
	return null;
}

/** The site's best icon, downloaded; null if it has none big enough or does not let us in. */
export async function findSiteIcon(site: string) {
	const page = await fetchPublic(site, { headers: HEADERS, maxBytes: PAGE_MAX, timeoutMs: 10_000 });
	const { manifest, icons } = pageIcons(page.body, page.url);
	if (manifest) {
		const json = await fetchPublic(manifest, {
			headers: HEADERS,
			maxBytes: PAGE_MAX,
			timeoutMs: 10_000
		}).catch(() => null);
		if (json) {
			try {
				icons.push(...manifestIcons(JSON.parse(json.body), json.url));
			} catch {
				// Not JSON: the page's own icons.
			}
		}
	}
	// Where Apple looks when the page says nothing.
	icons.push({ url: new URL('/apple-touch-icon.png', page.url).href, size: 180 });
	for (const icon of bestFirst(icons)) {
		const got = await fetchPublicBytes(icon.url, {
			headers: HEADERS,
			maxBytes: ICON_MAX,
			timeoutMs: 10_000
		}).catch(() => null);
		const kind = got && imageKind(got.bytes);
		if (kind) return { bytes: got.bytes, kind };
	}
	return null;
}
