import { describe, expect, test } from 'bun:test';
import { parseRemote, remoteTracks, silenceUrl } from './remote-snapcast.ts';

/** Seilide's on the house's Snapcast (#339): only its own addresses, and the pauses made here. */
const cloud = 'https://seilide.app';
const audio = (id: number) => `https://seilide.app/api/oracion/pase/abc.def/audio/${id}?v=1`;

describe('parseRemote', () => {
	test('its addresses and pauses, as sent', () => {
		expect(
			parseRemote(
				{
					artist: 'Oración',
					album: 'Rosario',
					items: [
						{ title: 'Padre nuestro', src: audio(1), durationSec: 20.5 },
						{ pauseSec: 3 },
						{ title: '', src: audio(2), durationSec: null }
					]
				},
				cloud
			)
		).toEqual({
			artist: 'Oración',
			album: 'Rosario',
			items: [
				{ title: 'Padre nuestro', src: audio(1), durationSec: 20.5 },
				{ pauseSec: 3 },
				{ title: 'Sin título', src: audio(2), durationSec: null }
			]
		});
	});

	test('not an address of another site, nor anything mpv would open otherwise', () => {
		for (const src of [
			'https://otro.example/audio.ogg',
			'http://seilide.app/api/oracion/pase/x/audio/1',
			'file:///etc/passwd',
			'av://lavfi:anullsrc',
			'nada'
		])
			expect(parseRemote({ items: [{ title: 'x', src }] }, cloud)).toBeNull();
	});

	test('nothing, too much, or a pause out of bounds: not one', () => {
		expect(parseRemote({ items: [] }, cloud)).toBeNull();
		expect(parseRemote(null, cloud)).toBeNull();
		expect(parseRemote({ items: [{ pauseSec: 0 }] }, cloud)).toBeNull();
		expect(parseRemote({ items: [{ pauseSec: 31 }] }, cloud)).toBeNull();
		expect(parseRemote({ items: Array(1001).fill({ pauseSec: 1 }) }, cloud)).toBeNull();
	});
});

test('as the queue has them: the pauses as mpv’s own silence, each its id', () => {
	const tracks = remoteTracks({
		artist: 'Oración',
		album: 'Rosario',
		items: [{ title: 'Ave María', src: audio(2), durationSec: 18 }, { pauseSec: 2 }]
	});
	expect(tracks.map((t) => t.path)).toEqual([audio(2), silenceUrl(2)]);
	expect(tracks[0].track).toMatchObject({
		id: -1,
		title: 'Ave María',
		album: 'Rosario',
		src: audio(2)
	});
	expect(tracks[1].track).toMatchObject({
		id: -2,
		title: 'Pausa',
		durationSec: 2,
		hasCover: false
	});
	expect(silenceUrl(2)).toBe('av://lavfi:anullsrc=r=48000:cl=mono:d=2');
});
