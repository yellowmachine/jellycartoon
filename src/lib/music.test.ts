import { describe, expect, test } from 'bun:test';
import { groupByArtist, type MusicAlbum } from './music.ts';

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
