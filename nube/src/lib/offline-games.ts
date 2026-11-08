import type { PlayerData } from 'comun/games.ts';

/**
 * Games without coverage: the house's games carried on a device, such as the car's tablet, the
 * same devices as the routes' maps (#164) and the music (#350), and in the same 2 GB as its music
 * (MAX_OFFLINE_BYTES). What the server and the pages share; the work itself, games-offline.ts on
 * the server and offline-games.svelte.ts on the device.
 */

/** The browser's cache that keeps them: each game's files, the player's page and the list. */
export const GAMES_CACHE = 'juegos-sin-conexion';
/** EmulatorJS' files from its CDN (comun's emulador.html), the version it is pinned at. */
export const EJS_DATA = 'https://cdn.emulatorjs.org/4.2.3/data/';
export const EJS_CACHE = 'emulatorjs-4.2.3';
/** The games the device keeps, as last told: to play them with nobody to ask. */
export const MANIFEST_KEY = '/juegos/aqui/lista.json';
/** The player's page, without its address' parameters. */
export const PLAYER_PAGE = '/juegos/emulador.html';

/**
 * EmulatorJS' cores for each of its systems, the first being the one it uses: its getCores() in
 * 4.2.3, for the consoles the house has (SYSTEMS in jellycartoon's games.ts).
 */
const CORES: Record<string, string> = {
	nes: 'fceumm',
	snes: 'snes9x',
	gb: 'gambatte',
	gba: 'mgba',
	segaMS: 'smsplus',
	segaMD: 'genesis_plus_gx',
	atari2600: 'stella2014',
	arcade: 'fbneo'
};

/**
 * What EmulatorJS 4.2.3 asks its CDN for to play a game of this system (the player's `core`, its
 * EJS_core; its loader.js and emulator.min.js): its code, Spanish, the core's report and the core
 * itself, with WebGL 2 and without (it chooses as it starts; threads only where the page is
 * isolated, and ours is not), and what unpacks a zipped game. Null, a system it is not known for.
 */
export function emulatorFiles(system: string): string[] | null {
	const core = CORES[system];
	if (!core) return null;
	return [
		'loader.js',
		'emulator.min.js',
		'emulator.min.css',
		'localization/es-ES.json',
		`cores/reports/${core}.json`,
		`cores/${core}-wasm.data`,
		`cores/${core}-legacy-wasm.data`,
		'compression/extractzip.js',
		'compression/extract7z.js'
	].map((file) => EJS_DATA + file);
}

/** A game's own files at the house: the game, its BIOS and its box. */
export const gameFiles = (order: Pick<OfflineGameOrder, 'player' | 'cover'>) =>
	[order.player.rom, order.player.bios, order.cover].filter((f): f is string => Boolean(f));

/** What the device is told to keep, in order: the first ordered first, if not all fit. */
export interface OfflineGameOrder {
	system: string;
	file: string;
	title: string;
	/** Its console's name, for the list on the device. */
	consoleName: string;
	/** Its box, at the house, if it has one. */
	cover: string | null;
	/** What the player needs, as the house said it when ordered (GamePlayer.svelte). */
	player: PlayerData;
}

/** What the device says of one game. */
export interface OfflineGameReport {
	system: string;
	file: string;
	state: 'downloading' | 'ready' | 'failed';
	bytes: number;
	problem?: string;
}

export interface OfflineGamesView {
	devices: { id: string; name: string; lastSeenAt: Date }[];
	games: {
		system: string;
		file: string;
		deviceId: string;
		title: string;
		state: 'pending' | 'downloading' | 'ready' | 'failed';
		bytes: number;
		problem: string | null;
		updatedAt: Date;
	}[];
}

/** Its page on the device, without coverage. */
export const offlineGameHref = (system: string, file: string) =>
	`/juegos/aqui/${encodeURIComponent(system)}/${encodeURIComponent(file)}`;
