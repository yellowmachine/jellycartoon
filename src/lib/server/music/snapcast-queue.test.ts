import { describe, expect, test } from 'bun:test';
import type { MusicTrack } from 'comun/music.ts';
import { moveIndexes, queueOf, type KnownEntry } from './snapcast-queue.ts';

const song = (id: number, title: string): MusicTrack => ({
	id,
	title,
	artist: 'Queen',
	number: 1,
	durationSec: 200,
	albumId: 1,
	album: 'Disco',
	hasCover: true
});

const playlist = [
	{ id: 10, filename: '/musica/a.flac' },
	{ id: 11, filename: '/musica/b.flac', current: true },
	{ id: 12, filename: 'https://radio/x' },
	{ id: 13, filename: '/musica/Otra%20Cosa.mp3' }
];

describe('Snapcast queue as Cola shows it', () => {
	test('songs, a station, and one the app does not know, with the one on', () => {
		const known = new Map<number, KnownEntry>([
			[10, { track: song(1, 'Una') }],
			[11, { track: song(2, 'Dos') }],
			[
				12,
				{
					radio: { uuid: 'u', name: 'Radio 3', country: 'ES', favicon: null, url: '', hls: false }
				}
			]
		]);
		const queue = queueOf(playlist, (id) => known.get(id), false);
		expect(queue.index).toBe(1);
		expect(queue.items.map((i) => [i.itemId, i.track.title])).toEqual([
			[10, 'Una'],
			[11, 'Dos'],
			[12, 'Radio 3'],
			[13, 'Otra Cosa']
		]);
		// Not songs of the library: not saved in a list.
		expect(queue.items[2]!.track.src).toBeTruthy();
		expect(queue.items[0]!.track.src).toBeUndefined();
	});

	test('nothing on', () => {
		expect(queueOf([{ id: 1, filename: 'a' }], () => undefined, false).index).toBe(-1);
	});
});

describe('dragged in mpv’s playlist', () => {
	test('before another, up or down, and to the end', () => {
		expect(moveIndexes(playlist, 13, 10)).toEqual([3, 0]);
		expect(moveIndexes(playlist, 10, 13)).toEqual([0, 3]);
		expect(moveIndexes(playlist, 10, null)).toEqual([0, 4]);
	});

	test('where it already is, or unknown: nothing', () => {
		expect(moveIndexes(playlist, 10, 11)).toBeNull();
		expect(moveIndexes(playlist, 13, null)).toBeNull();
		expect(moveIndexes(playlist, 12, 12)).toBeNull();
		expect(moveIndexes(playlist, 99, 10)).toBeNull();
	});
});
