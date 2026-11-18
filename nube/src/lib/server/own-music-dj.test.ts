import { afterAll, describe, expect, mock, test } from 'bun:test';

/**
 * Modo DJ with a list of «Tu música» (#534): its songs from the list, and what the DJ says, written
 * and read aloud through a pretend OpenRouter, made Opus by the real ffmpeg, heard only by its family.
 */
const list = {
	id: 7,
	name: 'Para el coche',
	items: [
		{ n: 1, mime: 'audio/mpeg' },
		{ n: 2, mime: 'audio/flac' },
		{ n: 3, mime: 'audio/mp4; codecs="alac"' }
	].map(({ n, mime }) => ({
		itemId: n,
		track: {
			id: n,
			albumId: 1,
			title: `Canción ${n}`,
			artist: 'Queen',
			disc: null,
			number: n,
			durationSec: 100,
			mime
		},
		album: { id: 1, title: 'A Night at the Opera', hasCover: false, coverVersion: null }
	}))
};

mock.module('#lib/server/own-music-lists.ts', () => ({
	ownPlaylistOf: async (familyId: string, id: number) =>
		familyId === 'A' && id === 7 ? list : null
}));
mock.module('#lib/server/family-settings.ts', () => ({
	openRouterKey: async (k: { familyId: string }) => (k.familyId === 'A' ? 'sk-or-prueba' : null)
}));
mock.module('#lib/server/voice/settings.ts', () => ({
	voiceSettings: async () => ({ model: 'modelo/prueba' })
}));

const realFetch = globalThis.fetch;
const asked: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
	const url = String(input);
	asked.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
	if (url.endsWith('/chat/completions'))
		return Response.json({
			choices: [
				{ message: { content: JSON.stringify({ texto: 'Eso era Queen. Ahora, más Queen.' }) } }
			]
		});
	if (url.endsWith('/audio/speech'))
		// A second of silence, 16-bit mono at 24 kHz.
		return new Response(new Uint8Array(48_000), {
			headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' }
		});
	return new Response(null, { status: 404 });
}) as typeof fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

const { ownDjTracks, ownDjClip, ownDjClipAudio } = await import('./own-music-dj.ts');
const kitchen = (familyId: string) => ({ familyId }) as never;

describe('the songs', () => {
	test('the list’s in order, without what browsers seldom play (ALAC); another family’s, none', async () => {
		const tracks = await ownDjTracks('A', 7, { inOrder: true, offset: 0, exclude: [] });
		expect(tracks!.slice(0, 4).map((t) => t.id)).toEqual([1, 2, 1, 2]);
		expect(tracks![0]!.src).toBe('/api/music/own/tracks/1');
		expect(await ownDjTracks('B', 7, { inOrder: true, offset: 0, exclude: [] })).toBeNull();
	});
});

describe('what the DJ says', () => {
	test('written with the family’s key and model, read by Gemini, as Opus for its family only', async () => {
		const clip = await ownDjClip(kitchen('A'), {
			playlistId: 7,
			played: [1],
			next: 2,
			lang: 'es',
			voice: 'female',
			playlist: 'Para el coche'
		});
		expect(clip.id).toBeLessThan(0);
		expect(clip.clip?.text).toBe('Eso era Queen. Ahora, más Queen.');
		expect(clip.durationSec).toBe(1);
		const chat = asked.find((a) => a.url.endsWith('/chat/completions'))!;
		expect(chat.body.model).toBe('modelo/prueba');
		expect(JSON.stringify(chat.body.messages)).toContain('«Canción 1», de Queen');
		expect(asked.find((a) => a.url.endsWith('/audio/speech'))!.body.voice).toBe('Laomedeia');
		const id = clip.clip!.id;
		const audio = await ownDjClipAudio('A', id);
		expect(new TextDecoder().decode(audio!.slice(0, 4))).toBe('OggS');
		expect(await ownDjClipAudio('B', id)).toBeNull();
	});

	test('without a key, it cannot speak: the browser goes on without that talk', async () => {
		await expect(
			ownDjClip(kitchen('B'), {
				playlistId: 7,
				played: [],
				next: null,
				lang: 'es',
				voice: 'male',
				playlist: null
			})
		).rejects.toThrow('Sin clave');
	});
});
