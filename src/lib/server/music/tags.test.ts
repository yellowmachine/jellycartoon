import { describe, expect, test } from 'bun:test';
import {
	albumArtist,
	discIdFromToc,
	isDownload,
	normalizeTags,
	searchTitles,
	titlesMatch,
	trackNumber
} from './tags.ts';

describe('isDownload', () => {
	test('yt-dlp names, not CD rips', () => {
		expect(isDownload('dance90/Pet Shop Boys - Love etc. [InBiaRBUjUs].flac')).toBe(true);
		expect(isDownload('ballads80/Sting - Fields Of Gold [KLVq0IAzh1A].flac')).toBe(true);
		expect(
			isDownload('Queen/Queen - 2011 - Greatest Hits I (CD1)/01 - Queen - Bohemian Rhapsody.flac')
		).toBe(false);
		expect(
			isDownload('Nirvana - MTV Unplugged in New York [DGCD-24727]/01 - About a Girl.flac')
		).toBe(false);
	});
});

test('normalizeTags: keys in any case and with underscores', () => {
	expect(
		normalizeTags({ ARTIST: 'Hombres G', album_artist: 'Hombres G', track: '01', GENRE: ' ' })
	).toEqual({
		artist: 'Hombres G',
		albumartist: 'Hombres G',
		track: '01'
	});
});

test('trackNumber', () => {
	expect(trackNumber('01')).toBe(1);
	expect(trackNumber('3/12')).toBe(3);
	expect(trackNumber(undefined)).toBeNull();
	expect(trackNumber('x')).toBeNull();
});

describe('discIdFromToc', () => {
	// The example in https://musicbrainz.org/doc/Disc_ID_Calculation: 6 tracks, lead-out 95462.
	test('the MusicBrainz documentation example', () => {
		const toc = [6, 150, 15363, 32314, 46592, 63414, 80489, 95462]
			.map((n) => n.toString(16))
			.join('+');
		expect(discIdFromToc(toc)).toBe('49HHV7Eb8UKF3aQiNmu1GR8vKTY-');
	});

	test('malformed', () => {
		expect(discIdFromToc(undefined)).toBeNull();
		expect(discIdFromToc('3+96+100')).toBeNull();
		expect(discIdFromToc('zz')).toBeNull();
	});
});

test('searchTitles: without year, disc or catalogue numbers', () => {
	expect(searchTitles('2011 - Greatest Hits I - The Platinum Collection (CD1)')).toEqual([
		'Greatest Hits I - The Platinum Collection'
	]);
	expect(searchTitles('Del Rosa Al Amarillo - CD 1')).toEqual(['Del Rosa Al Amarillo']);
	expect(searchTitles('Urban Hymns [Super Deluxe Disc 1]')).toEqual(['Urban Hymns']);
	expect(searchTitles('Greatest Hits (Japan, UICY-90894)')).toEqual([
		'Greatest Hits (Japan, UICY-90894)',
		'Greatest Hits'
	]);
	expect(searchTitles('The Wall (CD One)')).toEqual(['The Wall']);
});

describe('albumArtist', () => {
	test('the tag when there is one', () => {
		expect(albumArtist([{ artist: 'Passengers', albumArtist: 'Various Artists' }])).toBe(
			'Various Artists'
		);
	});
	test('the one artist of every track', () => {
		expect(
			albumArtist([
				{ artist: 'Queen', albumArtist: null },
				{ artist: 'Queen', albumArtist: null }
			])
		).toBe('Queen');
	});
	test('several', () => {
		expect(
			albumArtist([
				{ artist: 'Alaska', albumArtist: null },
				{ artist: 'Nacha Pop', albumArtist: null }
			])
		).toBe('Varios artistas');
	});
});

test('titlesMatch: the same album with other words around, not another one', () => {
	expect(
		titlesMatch(
			'Greatest Hits I - The Platinum Collection',
			'Greatest Hits I, II & III: The Platinum Collection'
		)
	).toBe(true);
	expect(titlesMatch('Héroes del Silencio', 'Heroes del silencio')).toBe(true);
	expect(titlesMatch('Del Rosa Al Amarillo', 'Historia del bikini')).toBe(false);
});
