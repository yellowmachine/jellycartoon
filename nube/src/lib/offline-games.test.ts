import { expect, test } from 'bun:test';
import { EJS_DATA, emulatorFiles, gameFiles, offlineGameHref } from './offline-games.ts';
import type { PlayerData } from 'comun/games.ts';

const player = (over: Partial<PlayerData> = {}) =>
	({
		title: 'Super Mario World',
		core: 'snes',
		rom: '/api/juegos/snes/Super%20Mario%20World.sfc',
		bios: null,
		gameId: 1,
		backdrop: '/api/fondo/juego/1',
		cartridge: '/api/juegos/cartucho/1',
		controls: {},
		shader: { own: null, inherited: 'disabled' },
		...over
	}) as PlayerData;

test("a console's core, with WebGL 2 and without, from EmulatorJS' pinned version", () => {
	const files = emulatorFiles('snes')!;
	expect(files).toContain(`${EJS_DATA}cores/snes9x-wasm.data`);
	expect(files).toContain(`${EJS_DATA}cores/snes9x-legacy-wasm.data`);
	expect(files).toContain(`${EJS_DATA}cores/reports/snes9x.json`);
	expect(files).toContain(`${EJS_DATA}loader.js`);
	expect(files).toContain(`${EJS_DATA}localization/es-ES.json`);
	expect(files.every((f) => f.startsWith('https://cdn.emulatorjs.org/4.2.3/data/'))).toBe(true);
});

test("every console of the house has its core (jellycartoon's SYSTEMS)", () => {
	for (const core of ['nes', 'snes', 'gb', 'gba', 'segaMS', 'segaMD', 'atari2600', 'arcade'])
		expect(emulatorFiles(core)).not.toBeNull();
	expect(emulatorFiles('psx')).toBeNull();
});

test("a game's files: the game, its BIOS and its box, those it has", () => {
	expect(gameFiles({ player: player(), cover: null })).toEqual([
		'/api/juegos/snes/Super%20Mario%20World.sfc'
	]);
	expect(
		gameFiles({
			player: player({
				core: 'arcade',
				rom: '/api/juegos/arcade/mslug.zip',
				bios: '/api/juegos/arcade/neogeo.zip'
			}),
			cover: '/api/juegos/imagen/3/caratula?v=1'
		})
	).toEqual([
		'/api/juegos/arcade/mslug.zip',
		'/api/juegos/arcade/neogeo.zip',
		'/api/juegos/imagen/3/caratula?v=1'
	]);
});

test('its page on the device, escaped', () => {
	expect(offlineGameHref('snes', 'Mario & Luigi.sfc')).toBe(
		'/juegos/aqui/snes/Mario%20%26%20Luigi.sfc'
	);
});
