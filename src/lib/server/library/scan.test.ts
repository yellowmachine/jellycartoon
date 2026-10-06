import { describe, expect, mock, test } from 'bun:test';

mock.module('#lib/server/db/index.ts', () => ({ db: {} }));
mock.module('./worker.ts', () => ({ wakeWorker() {} }));
mock.module('./paths.ts', () => ({ mediaRoot: '/' }));
const { parseEpisode, noiseSegments } = await import('./scan.ts');

// Names shaped like a real YouTube playlist downloaded with yt-dlp (Fleischer's Superman shorts,
// public domain): the show and channel repeat, the episode title moves around.
const playlist = [
	'Temporada 1/S01E01 - The Mad Scientist： FULL EPISODE ｜ Superman ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E07 - Superman ｜ Billion Dollar Limited ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E08 - Superman ｜ The Arctic Giant ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E09 - Superman ｜ The Bulleteers ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E66 - Superman ｜ The Magnetic Telescope ｜ Clip ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E86 - Volcano ｜ Superman： FULL EPISODE ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E88 - Electric Earthquake： FULL EPISODE ｜ Superman ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E94 - Terror on the Midway ｜ Superman｜ Classic Cartoon.mp4',
	'Temporada 1/S01E70 - Superman ｜ Japoteurs  ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E10 - Animated Cat Adventure.mp4',
	'Temporada 1/S01E62 - Superman ｜ Superman vs. The Mechanical Monsters ｜ Classic Cartoons.mp4',
	'Temporada 1/S01E76 - Superman ｜ Secret Agent？ ｜ Classic Cartoons.mp4',
	...Array.from(
		{ length: 20 },
		(_, i) => `Temporada 1/S01E${20 + i} - Superman ｜ Ep ${i} ｜ Classic Cartoons.mp4`
	)
];

describe('parseEpisode', () => {
	test('YouTube titles drop the show, channel and "FULL EPISODE"', () => {
		const noise = noiseSegments(playlist);
		expect(playlist.slice(0, 12).map((f) => parseEpisode(f, noise).title)).toEqual([
			'The Mad Scientist',
			'Billion Dollar Limited',
			'The Arctic Giant',
			'The Bulleteers',
			'The Magnetic Telescope',
			'Volcano',
			'Electric Earthquake',
			'Terror on the Midway',
			'Japoteurs',
			'Animated Cat Adventure',
			'Superman vs. The Mechanical Monsters',
			'Secret Agent?'
		]);
		expect(parseEpisode(playlist[1], noise)).toMatchObject({ season: 1, number: 7 });
	});

	test('DVD rips without episode numbers are left for file-order numbering', () => {
		const parsed = parseEpisode('Temporada 1/MY SHOW DISC 1-C1_t01.mkv');
		expect(parsed).toMatchObject({ season: 1, number: null });
	});

	test('other conventions', () => {
		expect(parseEpisode('Temporada 2/Conference [aB3dE5fG7hI].webm')).toEqual({
			season: 2,
			number: null,
			title: 'Conference'
		});
		expect(parseEpisode('Temporada 1/Serie S01E03 - El fin.mkv')).toMatchObject({
			number: 3,
			title: 'El fin'
		});
		expect(parseEpisode('02 - Segundo corto.webm')).toMatchObject({
			season: 1,
			number: 2,
			title: 'Segundo corto'
		});
		expect(parseEpisode('Season 3/Show.3x07.The_Title.mp4')).toMatchObject({
			season: 3,
			number: 7,
			title: 'The Title'
		});
	});
});
