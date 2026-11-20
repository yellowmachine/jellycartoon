/**
 * The consoles whose games are played (#176), the same in the house (its GAMES_DIR) and in Seilide
 * (the family's bucket, #564): one folder each, with one system of EmulatorJS
 * (https://emulatorjs.org/docs/systems), which picks its default core, the platforms in Wikidata
 * (P400) to look its games up among, and its folder in libretro's thumbnails, for their pictures.
 * Only the light consoles, and the arcade games of FinalBurn Neo: other folders are left out.
 */
export const SYSTEMS: Record<
	string,
	{ name: string; core: string; wikidata: string[]; libretro: string }
> = {
	nes: {
		name: 'NES',
		core: 'nes',
		wikidata: ['Q172742'],
		libretro: 'Nintendo - Nintendo Entertainment System'
	},
	snes: {
		name: 'Super Nintendo',
		core: 'snes',
		wikidata: ['Q183259'],
		libretro: 'Nintendo - Super Nintendo Entertainment System'
	},
	gb: { name: 'Game Boy', core: 'gb', wikidata: ['Q186437'], libretro: 'Nintendo - Game Boy' },
	gbc: {
		name: 'Game Boy Color',
		core: 'gb',
		wikidata: ['Q203992'],
		libretro: 'Nintendo - Game Boy Color'
	},
	gba: {
		name: 'Game Boy Advance',
		core: 'gba',
		wikidata: ['Q188642'],
		libretro: 'Nintendo - Game Boy Advance'
	},
	mastersystem: {
		name: 'Master System',
		core: 'segaMS',
		wikidata: ['Q209868'],
		libretro: 'Sega - Master System - Mark III'
	},
	megadrive: {
		name: 'Mega Drive',
		core: 'segaMD',
		wikidata: ['Q10676'],
		libretro: 'Sega - Mega Drive - Genesis'
	},
	atari2600: {
		name: 'Atari 2600',
		core: 'atari2600',
		wikidata: ['Q206261'],
		libretro: 'Atari - 2600'
	},
	// FinalBurn Neo, EmulatorJS' core for `arcade`: its ROMs as FBNeo names them (fbneo.ts). Arcade
	// games, or Neo-Geo's, in Wikidata.
	arcade: {
		name: 'Recreativas',
		core: 'arcade',
		wikidata: ['Q192851', 'Q1054350'],
		libretro: 'FBNeo - Arcade Games'
	}
};

export const isSystem = (id: string) => Object.hasOwn(SYSTEMS, id);

/** What comes with downloaded collections and is not a game: pictures, lists, databases. */
const NOT_GAMES = new Set([
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.txt',
	'.nfo',
	'.xml',
	'.sqlite',
	'.pdf',
	'.torrent'
]);

/** Whether a file of a console's folder may be a game: not hidden, nor one of NOT_GAMES. */
export function mayBeGame(file: string) {
	if (!file || file.startsWith('.')) return false;
	const dot = file.lastIndexOf('.');
	return dot <= 0 || !NOT_GAMES.has(file.slice(dot).toLowerCase());
}

/** A file's name without its extension: «Super Mario World (Europe).sfc» → «Super Mario World (Europe)». */
export function nameOf(file: string) {
	const dot = file.lastIndexOf('.');
	return dot > 0 ? file.slice(0, dot) : file;
}

/** «Super Mario World (Europe)» → «Super Mario World»: no region or version. */
export const titleOf = (name: string) => name.replace(/(\s*[([][^)\]]*[)\]])+$/, '').trim() || name;

/** libretro's pictures (https://docs.libretro.com/guides/roms-playlists-thumbnails/). */
export const LIBRETRO_PICTURES = {
	titulo: 'Named_Titles',
	captura: 'Named_Snaps',
	caratula: 'Named_Boxarts'
} as const;
export type LibretroPicture = keyof typeof LIBRETRO_PICTURES;

/** libretro's name for a game: its full name, with these characters as `_`. */
const libretroName = (fullName: string) => fullName.replace(/[&*/:`<>?\\|"]/g, '_');

/** Where libretro has that picture of the game, if it has it. */
export const libretroPicture = (system: string, fullName: string, kind: LibretroPicture) =>
	[
		'https://thumbnails.libretro.com',
		encodeURIComponent(SYSTEMS[system].libretro),
		LIBRETRO_PICTURES[kind],
		`${encodeURIComponent(libretroName(fullName))}.png`
	].join('/');
