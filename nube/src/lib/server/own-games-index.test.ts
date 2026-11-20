import { describe, expect, test } from 'bun:test';
import { gamesOf } from './own-games-index.ts';

const at = (key: string, size = 1) => ({ key, size });

describe('«Tus juegos»: which keys are games (#564)', () => {
	test('a file right inside a console folder, with its title and full name', () => {
		expect(gamesOf([at('Juegos/snes/Super Mario World (Europe).sfc', 512)], 'Juegos/')).toEqual([
			{
				system: 'snes',
				file: 'Super Mario World (Europe).sfc',
				key: 'Juegos/snes/Super Mario World (Europe).sfc',
				size: 512,
				title: 'Super Mario World',
				fullName: 'Super Mario World (Europe)'
			}
		]);
	});

	test('the folder in any case, the bucket root as the folder too', () => {
		const games = gamesOf([at('SNES/Zelda.zip'), at('Gba/Metroid.gba')], '');
		expect(games.map((g) => [g.system, g.key])).toEqual([
			['snes', 'SNES/Zelda.zip'],
			['gba', 'Gba/Metroid.gba']
		]);
	});

	test('left out: other folders, deeper files, not games, hidden, arcade (phase 2), outside', () => {
		const games = gamesOf(
			[
				at('Juegos/psx/Crash.bin'),
				at('Juegos/snes/extra/Mario.sfc'),
				at('Juegos/snes/box.png'),
				at('Juegos/snes/.DS_Store'),
				at('Juegos/arcade/mslug.zip'),
				at('Juegos/nes.zip'),
				at('Musica/snes/Mario.sfc'),
				at('Juegos/nes/Tetris.nes')
			],
			'Juegos/'
		);
		expect(games.map((g) => g.key)).toEqual(['Juegos/nes/Tetris.nes']);
	});

	test('the same file in two cases of a folder: once', () => {
		expect(gamesOf([at('snes/Mario.sfc'), at('SNES/Mario.sfc')], '')).toHaveLength(1);
	});
});
