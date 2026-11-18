import { afterEach, describe, expect, test } from 'bun:test';
import { findCover } from './musicbrainz.ts';

/** «Tu música» (#534): covers from MusicBrainz and the Cover Art Archive, with a pretend web. */
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function pretend(answers: (url: string) => Response) {
	const asked: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		asked.push(url);
		return answers(url);
	}) as typeof fetch;
	return asked;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

describe('a cover', () => {
	test('the release group’s when the release has none; titles that do not match, skipped', async () => {
		const asked = pretend((url) => {
			if (url.startsWith('https://musicbrainz.org/'))
				return Response.json({
					releases: [
						{ id: 'otro', title: 'Greatest Hits', score: 100 },
						{ id: 'r1', title: 'A Night at the Opera', score: 100, 'release-group': { id: 'g1' } }
					]
				});
			if (url.endsWith('/release-group/g1/front-500')) return new Response(JPEG);
			return new Response(null, { status: 404 });
		});
		expect(await findCover('A Night at the Opera', 'Queen')).toEqual(JPEG);
		expect(decodeURIComponent(asked[0]!)).toContain('artist:"Queen"');
		expect(asked.some((u) => u.includes('/release/otro/'))).toBe(false);
	});

	test('a compilation is searched by title alone; nothing found, null', async () => {
		const asked = pretend((url) =>
			url.startsWith('https://musicbrainz.org/')
				? Response.json({ releases: [] })
				: new Response(null, { status: 404 })
		);
		expect(await findCover('Éxitos 1990', 'Varios artistas')).toBeNull();
		expect(asked.length).toBeGreaterThan(0);
		expect(asked.every((u) => !decodeURIComponent(u).includes('artist:'))).toBe(true);
	});

	test('without a known artist, not searched: a title alone finds any record', async () => {
		const asked = pretend(() => Response.json({ releases: [] }));
		expect(await findCover('Suelto', 'Desconocido')).toBeNull();
		expect(asked).toEqual([]);
	});
});
