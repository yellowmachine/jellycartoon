import { describe, expect, test } from 'bun:test';
import { gamesOf, hasArcade } from './own-games-index.ts';

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
				fullName: 'Super Mario World (Europe)',
				biosKey: null
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

	test('left out: other folders, deeper files, not games, hidden, outside', () => {
		const games = gamesOf(
			[
				at('Juegos/psx/Crash.bin'),
				at('Juegos/snes/extra/Mario.sfc'),
				at('Juegos/snes/box.png'),
				at('Juegos/snes/.DS_Store'),
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

	const fbneo = {
		mslug: { description: 'Metal Slug - Super Vehicle-001', romof: 'neogeo' },
		mslugx: { description: 'Metal Slug X', romof: 'mslug' },
		sf2: { description: 'Street Fighter II: The World Warrior (World 910522)' },
		neogeo: { description: 'Neo Geo', isBios: true }
	};

	test('arcade games by FBNeo’s list: titles, their BIOS if it is there, the BIOS not a game', () => {
		const games = gamesOf(
			[at('Juegos/ARCADE/neogeo.zip'), at('Juegos/arcade/mslugx.zip'), at('Juegos/arcade/sf2.zip')],
			'Juegos/',
			fbneo
		);
		expect(games.map((g) => [g.file, g.title, g.biosKey])).toEqual([
			['mslugx.zip', 'Metal Slug X', 'Juegos/ARCADE/neogeo.zip'],
			['sf2.zip', 'Street Fighter II: The World Warrior', null]
		]);
	});

	test('arcade games without FBNeo’s list: by their short names', () => {
		const games = gamesOf([at('arcade/neogeo.zip'), at('arcade/mslug.zip')], '');
		expect(games.map((g) => [g.title, g.biosKey])).toEqual([
			['neogeo', null],
			['mslug', null]
		]);
	});

	test('the list is fetched only with an arcade folder', () => {
		expect(hasArcade([at('Juegos/arcade/sf2.zip')], 'Juegos/')).toBe(true);
		expect(hasArcade([at('Juegos/snes/arcade.sfc'), at('arcade/sf2.zip')], 'Juegos/')).toBe(false);
	});
});
