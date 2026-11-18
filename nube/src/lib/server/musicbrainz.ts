import { searchTitles, titlesMatch } from 'comun/album-titles.ts';

/**
 * Album covers for «Tu música» (#534), as the house finds its own (music/covers.ts): the release in
 * MusicBrainz (https://musicbrainz.org/doc/MusicBrainz_API) by title and artist, and its front in
 * the Cover Art Archive (https://musicbrainz.org/doc/Cover_Art_Archive/API). Both public, no key.
 * MusicBrainz asks each client to say who it is and for one request a second at most, from the
 * whole of Seilide (all the families share its address): one queue for all, here.
 */

const USER_AGENT = 'Seilide/1.0 (https://seilide.app)';
const INTERVAL_MS = 1100;
/** Busy, it answers 503 and asks to try again later: this many times more. */
const RETRIES = 3;

/** Compilations: searched by title alone. */
const NO_ARTIST = /^(varios( artistas)?|various( artists)?|va)$/i;
/**
 * No artist known (a file without tags, «Desconocido» from own-music-index.ts): not searched, as a
 * title alone (often its folder's name) finds any record called the same.
 */
const UNKNOWN = /^(desconocido|unknown( artist)?)$/i;

interface Release {
	id: string;
	title: string;
	score?: number;
	'release-group'?: { id: string };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The queue: each request after the one before, a second apart. */
let queue: Promise<unknown> = Promise.resolve();
let last = 0;

function paced<T>(work: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		const wait = last + INTERVAL_MS - Date.now();
		if (wait > 0) await sleep(wait);
		last = Date.now();
		return work();
	});
	queue = run.catch(() => {});
	return run;
}

async function musicBrainz(pathAndQuery: string): Promise<{ releases?: Release[] } | null> {
	for (let attempt = 0; ; attempt++) {
		const res = await paced(() =>
			fetch(`https://musicbrainz.org/ws/2/${pathAndQuery}&fmt=json`, {
				headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
				signal: AbortSignal.timeout(20_000)
			})
		);
		if (res.status === 503 && attempt < RETRIES) {
			const after = Number(res.headers.get('retry-after'));
			await sleep((after > 0 ? after : 2 ** (attempt + 1)) * 1000);
			continue;
		}
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`MusicBrainz respondió ${res.status}`);
		return res.json();
	}
}

const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`;
/** Lucene's special characters out: the words alone. */
const words = (value: string) => `(${value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim()})`;

/** The releases that are this album, best first: by title as a phrase, then by its words. */
export async function releasesOf(title: string, artist: string) {
	const by = artist && !NO_ARTIST.test(artist) ? ` AND artist:${quote(artist)}` : '';
	for (const t of searchTitles(title)) {
		for (const release of [quote(t), words(t)]) {
			const found = await musicBrainz(
				`release?limit=10&query=${encodeURIComponent(`release:${release}${by}`)}`
			);
			const good =
				found?.releases?.filter((r) => (r.score ?? 0) >= 90 && titlesMatch(t, r.title)) ?? [];
			if (good.length) return good;
		}
	}
	return [];
}

/** The 500 px front (a JPEG) of a release or a release group; null, it has none. */
async function front(kind: 'release' | 'release-group', id: string) {
	const res = await fetch(`https://coverartarchive.org/${kind}/${id}/front-500`, {
		headers: { 'User-Agent': USER_AGENT },
		signal: AbortSignal.timeout(30_000)
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`Cover Art Archive respondió ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}

/**
 * An album's cover, by its title and artist: the first release with one, or another edition of it
 * (many releases have no art of their own, and their release group does). Null, none found.
 */
export async function findCover(title: string, artist: string) {
	if (UNKNOWN.test(artist.trim())) return null;
	const groups = new Set<string>();
	for (const release of await releasesOf(title, artist)) {
		const own = await front('release', release.id);
		if (own) return own;
		const group = release['release-group']?.id;
		if (group && !groups.has(group)) {
			groups.add(group);
			const theirs = await front('release-group', group);
			if (theirs) return theirs;
		}
	}
	return null;
}
