import { describe, expect, test } from 'bun:test';
import { audioType, changes, folderCovers, mimeOf, trackInfo } from './own-music-index.ts';

/** «Tu música» (#534): what is pure of reading the family's bucket. */

describe('audios', () => {
	test('by their extension, any case; pictures, hidden files and others are not', () => {
		expect(audioType('Música/Queen/01 One.MP3')).toBe('audio/mpeg');
		expect(audioType('a/b.flac')).toBe('audio/flac');
		expect(audioType('a/b.opus')).toBe('audio/ogg; codecs="opus"');
		expect(audioType('a/cover.jpg')).toBeNull();
		expect(audioType('a/.DS_Store')).toBeNull();
		expect(audioType('a/._01.mp3')).toBeNull();
		expect(audioType('a/LEEME')).toBeNull();
	});

	test('an .m4a with Apple Lossless is asked about as such', () => {
		expect(mimeOf('a/b.m4a', 'ALAC')).toBe('audio/mp4; codecs="alac"');
		expect(mimeOf('a/b.m4a', 'MPEG-4/AAC')).toBe('audio/mp4');
	});
});

describe('covers', () => {
	test('cover.jpg before folder.jpg; the only picture of a folder; several unnamed, none', () => {
		const covers = folderCovers([
			'm/A/01.mp3',
			'm/A/folder.jpg',
			'm/A/Cover.JPG',
			'm/B/01.mp3',
			'm/B/scan.png',
			'm/C/01.mp3',
			'm/C/back.jpg',
			'm/C/inside.jpg'
		]);
		expect(covers.get('m/A/')).toBe('m/A/Cover.JPG');
		expect(covers.get('m/B/')).toBe('m/B/scan.png');
		expect(covers.has('m/C/')).toBe(false);
	});
});

describe('what a file is', () => {
	test('by its tags', () => {
		expect(
			trackInfo('m/x/y.mp3', 'm/', {
				title: ' Bohemian  Rhapsody ',
				artist: 'Queen',
				album: 'A Night at the Opera',
				year: 1975,
				track: { no: 11 },
				disk: { no: 1 }
			})
		).toEqual({
			title: 'Bohemian Rhapsody',
			artist: 'Queen',
			album: 'A Night at the Opera',
			albumArtist: 'Queen',
			year: 1975,
			number: 11,
			disc: 1
		});
	});

	test('untagged, by its name and its folders', () => {
		expect(trackInfo('m/Queen/A Night/03 - Love of My Life.mp3', 'm/', {})).toMatchObject({
			title: 'Love of My Life',
			artist: 'Queen',
			album: 'A Night',
			number: 3
		});
		expect(trackInfo('m/suelta.mp3', 'm/', {})).toMatchObject({
			title: 'suelta',
			artist: 'Desconocido',
			album: 'Sin álbum',
			number: null
		});
	});

	test('a compilation keeps its album artist apart from each track’s', () => {
		const info = trackInfo('m/x.mp3', 'm/', {
			title: 'Uno',
			artist: 'Alguien',
			albumartist: 'Varios',
			album: 'Éxitos'
		});
		expect(info.artist).toBe('Alguien');
		expect(info.albumArtist).toBe('Varios');
	});
});

describe('what changed', () => {
	test('new and changed (ETag or size) are read; gone ones go; the rest stay', () => {
		const indexed = [
			{ id: 1, key: 'a.mp3', etag: 'e1', size: 10 },
			{ id: 2, key: 'b.mp3', etag: 'e2', size: 20 },
			{ id: 3, key: 'c.mp3', etag: 'e3', size: 30 },
			{ id: 4, key: 'd.mp3', etag: 'e4', size: 40 }
		];
		const listed = [
			{ key: 'a.mp3', etag: 'e1', size: 10 },
			{ key: 'b.mp3', etag: 'otro', size: 20 },
			{ key: 'c.mp3', etag: 'e3', size: 31 },
			{ key: 'e.mp3', etag: 'e5', size: 50 }
		];
		const { read, gone } = changes(listed, indexed);
		expect(read.map((r) => r.key)).toEqual(['b.mp3', 'c.mp3', 'e.mp3']);
		expect(gone).toEqual([4]);
	});
});
