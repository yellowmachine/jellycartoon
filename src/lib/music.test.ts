import { describe, expect, test } from 'bun:test';
import {
	groupByArtist,
	masterVolume,
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
