import { describe, expect, mock, test } from 'bun:test';

mock.module('#lib/server/db/index.ts', () => ({ db: {} }));
mock.module('./worker.ts', () => ({ wakeWorker() {} }));
mock.module('./paths.ts', () => ({ mediaRoot: '/' }));
const { parseEpisode, noiseSegments } = await import('./scan.ts');

// Real names from a YouTube playlist downloaded with yt-dlp.
const dexter = [
	"Temporada 1/S01E01 - Game Over： FULL EPISODE ｜ Dexter's Laboratory ｜ Cartoon Cartoons.mp4",
	"Temporada 1/S01E07 - Dexter's Laboratory ｜ Survival of the Fittest ｜ Cartoon Network.mp4",
	"Temporada 1/S01E08 - Dexter's Laboratory ｜ Crazy Man ｜ Cartoon Network.mp4",
	"Temporada 1/S01E09 - Dexter's Laboratory ｜ Cool New Fad ｜ Cartoon Network.mp4",
	"Temporada 1/S01E66 - Dexter's Laboratory ｜ Figure Not Included ｜ Clip ｜ Cartoon Network.mp4",
	"Temporada 1/S01E86 - Changes ｜ Dexter's Laboratory： FULL EPISODE ｜ Cartoon Cartoons.mp4",
	"Temporada 1/S01E88 - Old Man Dexter： FULL EPISODE ｜ Dexter's Laboratory ｜ Cartoon Cartoons.mp4",
	"Temporada 1/S01E94 - Grandpa Dexter ｜ Dexter's Laboratory｜ Cartoons Cartoons.mp4",
	"Temporada 1/S01E70 - Dexter's Laboratory ｜ Rat-man Begins  ｜ Cartoon Network.mp4",
	'Temporada 1/S01E10 - Animated Cat Adventure.mp4',
	"Temporada 1/S01E62 - Dexter's Laboratory ｜ Dexter vs. Santa ｜ Cartoon Network.mp4",
	"Temporada 1/S01E76 - Dexter's Laboratory ｜ Two Deedees？ ｜ Cartoon Network.mp4",
	...Array.from(
		{ length: 20 },
		(_, i) => `Temporada 1/S01E${20 + i} - Dexter's Laboratory ｜ Ep ${i} ｜ Cartoon Network.mp4`
	)
];

describe('parseEpisode', () => {
	test('YouTube titles drop the show, channel and "FULL EPISODE"', () => {
		const noise = noiseSegments(dexter);
		expect(dexter.slice(0, 12).map((f) => parseEpisode(f, noise).title)).toEqual([
			'Game Over',
			'Survival of the Fittest',
			'Crazy Man',
			'Cool New Fad',
			'Figure Not Included',
			'Changes',
			'Old Man Dexter',
			'Grandpa Dexter',
			'Rat-man Begins',
			'Animated Cat Adventure',
			'Dexter vs. Santa',
			'Two Deedees?'
		]);
		expect(parseEpisode(dexter[1], noise)).toMatchObject({ season: 1, number: 7 });
	});

	test('DVD rips without episode numbers are left for file-order numbering', () => {
		const parsed = parseEpisode('Temporada 1/MAGILLA GORILLA DISC 1-C1_t01.mkv');
		expect(parsed).toMatchObject({ season: 1, number: null });
	});

	test('other conventions', () => {
		expect(parseEpisode('Temporada 2/Conference [KXyRzBhm4Jw].webm')).toEqual({
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
