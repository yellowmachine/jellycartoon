import { describe, expect, test } from 'bun:test';
import {
	groupByArtist,
	masterVolume,
	parseDjOptions,
	parseQueueSave,
	scaleVolumes,
	type MusicAlbum,
	type Speaker
} from './music.ts';

const album = (id: number, artist: string): MusicAlbum => ({
	id,
	title: `Álbum ${id}`,
	artist,
	hasCover: false,
	tracks: []
});

describe('groupByArtist', () => {
	test('one artist however it is written, named as it first comes', () => {
		const artists = groupByArtist([
			album(1, 'Héroes del Silencio'),
			album(2, 'Blur'),
			album(3, 'heroes del silencio')
		]);
		expect(artists.map((a) => [a.name, a.albums.map((x) => x.id)])).toEqual([
			['Héroes del Silencio', [1, 3]],
			['Blur', [2]]
		]);
	});
});

const speaker = (id: string, volume: number, connected = true): Speaker => ({
	id,
	name: id,
	hostName: id,
	connected,
	volume,
	muted: false,
	groupId: 'g',
	groupMuted: false
});

describe('master volume', () => {
	const speakers = [speaker('a', 20), speaker('b', 60), speaker('off', 100, false)];

	test('the average of the speakers that are on', () => {
		expect(masterVolume(speakers)).toBe(40);
	});

	test('down, each loses the same share of what it has', () => {
		// 40 → 20 is half: 20 → 10, 60 → 30.
		expect(scaleVolumes(speakers, 20)).toEqual([
			{ id: 'a', volume: 10 },
			{ id: 'b', volume: 30 }
		]);
	});

	test('up, each gains the same share of what it lacks', () => {
		// 40 → 70 is half of the 60 left: 20 → 60, 60 → 80.
		expect(scaleVolumes(speakers, 70)).toEqual([
			{ id: 'a', volume: 60 },
			{ id: 'b', volume: 80 }
		]);
	});

	test('0 and 100 take them all there, and the same value leaves them', () => {
		expect(scaleVolumes(speakers, 0).map((v) => v.volume)).toEqual([0, 0]);
		expect(scaleVolumes(speakers, 100).map((v) => v.volume)).toEqual([100, 100]);
		expect(scaleVolumes([speaker('a', 100)], 100)).toEqual([{ id: 'a', volume: 100 }]);
	});
});

describe('parseQueueSave', () => {
	const queue = {
		trackIds: [3, 1, 2],
		index: 1,
		positionSec: 42.5,
		shuffle: true,
		repeat: false,
		single: false,
		radio: null,
		podcast: null,
		changedBy: 'la TV'
	};

	test('a queue as the page sends it, as it is', () => {
		expect(parseQueueSave(queue)).toEqual(queue);
	});

	test('the index within the queue, and no position before the start', () => {
		expect(parseQueueSave({ ...queue, index: 7 })?.index).toBe(2);
		expect(parseQueueSave({ ...queue, index: -1 })?.index).toBe(0);
		expect(parseQueueSave({ ...queue, positionSec: -3 })?.positionSec).toBe(0);
	});

	test('a station, without tracks', () => {
		expect(parseQueueSave({ ...queue, trackIds: [], index: 0, radio: 'abc' })).toMatchObject({
			trackIds: [],
			index: 0,
			radio: 'abc'
		});
	});

	test('a podcast episode, without tracks', () => {
		expect(parseQueueSave({ ...queue, trackIds: [], index: 0, podcast: 7 })).toMatchObject({
			trackIds: [],
			podcast: 7
		});
		expect(parseQueueSave({ ...queue, podcast: 'x' })).toBeNull();
	});

	test('nothing to save, or not well formed: nothing', () => {
		expect(parseQueueSave({ ...queue, trackIds: [] })).toBeNull();
		expect(parseQueueSave({ ...queue, trackIds: [1, 'x'] })).toBeNull();
		expect(parseQueueSave({ ...queue, index: 1.5 })).toBeNull();
		expect(parseQueueSave({ ...queue, positionSec: Number.NaN })).toBeNull();
		expect(parseQueueSave({ ...queue, changedBy: '  ' })).toBeNull();
		expect(parseQueueSave({ ...queue, radio: 3 })).toBeNull();
		expect(parseQueueSave(null)).toBeNull();
	});
});

describe('parseDjOptions', () => {
	const options = { artists: ['Mecano'], lang: 'es', every: 3 };

	test('takes well-formed options, the whole library with no artists', () => {
		// Saved before there was a choice of voice: a man's.
		expect(parseDjOptions(options)).toEqual({
			artists: ['Mecano'],
			lang: 'es',
			every: 3,
			voice: 'male'
		});
		expect(parseDjOptions({ ...options, voice: 'female' })?.voice).toBe('female');
		expect(parseDjOptions({ ...options, artists: [], lang: 'en' })?.artists).toEqual([]);
	});

	test('refuses a language, a frequency or artists it does not know', () => {
		expect(parseDjOptions({ ...options, lang: 'fr' })).toBeNull();
		expect(parseDjOptions({ ...options, voice: 'robot' })).toBeNull();
		expect(parseDjOptions({ ...options, every: 0 })).toBeNull();
		expect(parseDjOptions({ ...options, every: 9 })).toBeNull();
		expect(parseDjOptions({ ...options, every: 2.5 })).toBeNull();
		expect(parseDjOptions({ ...options, artists: [1] })).toBeNull();
		expect(parseDjOptions({ ...options, artists: 'Mecano' })).toBeNull();
		expect(parseDjOptions(null)).toBeNull();
	});
});
