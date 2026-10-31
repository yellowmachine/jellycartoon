import { describe, expect, test } from 'bun:test';
import {
	MAX_TRY,
	prayerQueue,
	prayerRemote,
	speechChunks,
	tryPiece,
	type PrayerView
} from './prayers.ts';

const prayer = (id: number, title: string, audio = true): PrayerView => ({
	id,
	title,
	text: '',
	voiceId: 1,
	status: audio ? 'lista' : 'pendiente',
	durationSec: audio ? 20 : null,
	error: null,
	audioUrl: audio ? `/api/oracion/audio/${id}?v=x` : null,
	audioKey: audio ? 'x' : null
});

describe('a list as the queue', () => {
	test('each text its times, the pause between them, not after the last', () => {
		const { tracks, missing } = prayerQueue(
			{
				id: 1,
				title: 'Rosario',
				pauseSec: 2,
				items: [
					{ prayerId: 1, times: 1 },
					{ prayerId: 2, times: 2 }
				]
			},
			[prayer(1, 'Padre nuestro'), prayer(2, 'Ave María')]
		);
		expect(missing).toBe(0);
		expect(tracks.map((t) => t.title)).toEqual([
			'Padre nuestro',
			'Pausa',
			'Ave María (1/2)',
			'Pausa',
			'Ave María (2/2)'
		]);
		expect(tracks[1].src).toBe('/api/oracion/silencio/2');
		expect(tracks[2].src).toBe('/api/oracion/audio/2?v=x');
		expect(new Set(tracks.map((t) => t.id)).size).toBe(tracks.length);
		expect(tracks.every((t) => t.album === 'Rosario' && !t.hasCover)).toBe(true);
	});

	test('without a pause, none; a text without its voice, left out and counted', () => {
		const { tracks, missing } = prayerQueue(
			{
				id: 1,
				title: 'L',
				pauseSec: 0,
				items: [
					{ prayerId: 1, times: 2 },
					{ prayerId: 2, times: 3 },
					{ prayerId: 9, times: 1 }
				]
			},
			[prayer(1, 'Gloria'), prayer(2, 'Credo', false)]
		);
		expect(tracks.map((t) => t.title)).toEqual(['Gloria (1/2)', 'Gloria (2/2)']);
		expect(missing).toBe(2);
	});
});

describe('a text in pieces', () => {
	test('short, as one', () => {
		expect(speechChunks('Señor, ten piedad.\nCristo, ten piedad.')).toEqual([
			'Señor, ten piedad.\nCristo, ten piedad.'
		]);
	});

	test('by whole lines, up to the most', () => {
		const lines = Array.from({ length: 10 }, (_, i) => `Santa María ${i}, ruega por nosotros.`);
		const chunks = speechChunks(lines.join('\n'), 100);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((c) => c.length <= 100)).toBe(true);
		expect(chunks.join('\n')).toBe(lines.join('\n'));
	});

	test('a line longer than the most, by its sentences; blank lines kept inside', () => {
		const long = 'Uno dos tres. Cuatro cinco seis. Siete ocho nueve.';
		expect(speechChunks(long, 20)).toEqual([
			'Uno dos tres.',
			'Cuatro cinco seis.',
			'Siete ocho nueve.'
		]);
		expect(speechChunks('A\n\nB')).toEqual(['A\n\nB']);
		expect(speechChunks('  \n ')).toEqual([]);
	});
});

test('what is tried of a text: its first whole lines, a few', () => {
	const lines = Array.from({ length: 40 }, (_, i) => `Santa María ${i}, ruega por nosotros.`);
	const piece = tryPiece(lines.join('\n'));
	expect(piece.length).toBeLessThanOrEqual(MAX_TRY);
	expect(piece.startsWith('Santa María 0, ruega por nosotros.\nSanta María 1')).toBe(true);
	expect(piece.endsWith('ruega por nosotros.')).toBe(true);
	expect(tryPiece('')).toBe('');
});

test('a list for the house’s Snapcast: the same order, its addresses, the pauses for mpv', () => {
	const { remote, missing } = prayerRemote(
		{
			id: 1,
			title: 'Rosario',
			pauseSec: 2,
			items: [
				{ prayerId: 1, times: 1 },
				{ prayerId: 2, times: 2 },
				{ prayerId: 3, times: 1 }
			]
		},
		[prayer(1, 'Padre nuestro'), prayer(2, 'Ave María'), prayer(3, 'Credo', false)],
		(id, key) => `https://seilide.app/api/oracion/pase/t/audio/${id}?v=${key}`
	);
	expect(missing).toBe(1);
	expect(remote).toEqual({
		artist: 'Oración',
		album: 'Rosario',
		items: [
			{
				title: 'Padre nuestro',
				src: 'https://seilide.app/api/oracion/pase/t/audio/1?v=x',
				durationSec: 20
			},
			{ pauseSec: 2 },
			{
				title: 'Ave María (1/2)',
				src: 'https://seilide.app/api/oracion/pase/t/audio/2?v=x',
				durationSec: 20
			},
			{ pauseSec: 2 },
			{
				title: 'Ave María (2/2)',
				src: 'https://seilide.app/api/oracion/pase/t/audio/2?v=x',
				durationSec: 20
			}
		]
	});
});
