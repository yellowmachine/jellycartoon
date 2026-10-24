import { afterEach, expect, mock, test } from 'bun:test';
import { nextTrack } from './next-track.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
	nextTrack.forget();
	globalThis.fetch = realFetch;
});

const settle = () => new Promise((r) => setTimeout(r, 10));

test('downloaded once, and given once, for that track only', async () => {
	const fetch = mock(async () => new Response('audio'));
	globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
	nextTrack.want('/api/music/track/2');
	nextTrack.want('/api/music/track/2');
	await settle();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(nextTrack.take('/api/music/track/3')).toBeNull();
	const copy = nextTrack.take('/api/music/track/2');
	expect(copy).toStartWith('blob:');
	expect(await (await realFetch(copy!)).text()).toBe('audio');
	expect(nextTrack.take('/api/music/track/2')).toBeNull();
	URL.revokeObjectURL(copy!);
});

test('not whole yet, or failed: nothing, and the track is asked for as before', async () => {
	globalThis.fetch = (async () =>
		new Response('', { status: 502 })) as unknown as typeof globalThis.fetch;
	nextTrack.want('/api/music/track/2');
	await settle();
	expect(nextTrack.take('/api/music/track/2')).toBeNull();
});

test('another one wanted: the first is dropped', async () => {
	const fetch = mock(async (url: string) => new Response(url));
	globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
	nextTrack.want('/api/music/track/2');
	nextTrack.want('/api/music/track/5');
	await settle();
	expect(nextTrack.take('/api/music/track/2')).toBeNull();
	const copy = nextTrack.take('/api/music/track/5');
	expect(await (await realFetch(copy!)).text()).toBe('/api/music/track/5');
	URL.revokeObjectURL(copy!);
});
