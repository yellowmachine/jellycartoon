import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { dataRoot, gamesRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { normalize, pick, queries } from '#lib/server/cinema/match.ts';
import { describeGames, gameDetails, searchGames } from '#lib/server/cinema/wikidata.ts';
import { arcadeGames, biosOf, type ArcadeGame } from '#lib/server/fbneo.ts';

/**
 * The folders of GAMES_DIR that are played (#176), each with one system of EmulatorJS
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
	// FinalBurn Neo, EmulatorJS' core for `arcade`: its ROMs as FBNeo names them (fbneo.ts). Arcade
	// games, or Neo-Geo's, in Wikidata.
	arcade: {
		name: 'Recreativas',
		core: 'arcade',
		wikidata: ['Q192851', 'Q1054350'],
		libretro: 'FBNeo - Arcade Games'
	}
};

export type Game = {
	system: string;
	file: string;
	title: string;
	/** Its full name, as libretro's pictures are named: No-Intro's, or FBNeo's for arcade games. */
	fullName: string;
	/** The BIOS's file it needs (`neogeo.zip`), when it is in the folder too. */
	bios: string | null;
};

/** «Super Mario World (Europe)» → «Super Mario World»: no region or version. */
const titleOf = (name: string) => name.replace(/(\s*[([][^)\]]*[)\]])+$/, '').trim() || name;

/** FBNeo's list, or none if it cannot be had now: the short names then. */
const arcadeList = () =>
	arcadeGames().catch((problem): Record<string, ArcadeGame> => {
		log.warn('juegos', 'No se pudo leer la lista de recreativas de FBNeo', { error: problem });
		return {};
	});

/** The games of a system's folder, by title; none if there is no folder. Read each time. */
async function gamesIn(system: string): Promise<Game[]> {
	const entries = await readdir(path.join(gamesRoot!, system), { withFileTypes: true }).catch(
		() => []
	);
	const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
	const arcade = system === 'arcade' && files.length ? await arcadeList() : null;
	return files
		.flatMap((file): Game[] => {
			const name = path.parse(file).name;
			if (!arcade) return [{ system, file, title: titleOf(name), fullName: name, bios: null }];
			const known = arcade[name];
			// A BIOS is not a game: it goes with the games that need it.
			if (known?.isBios) return [];
			const bios = biosOf(arcade, name);
			return [
				{
					system,
					file,
					title: known ? titleOf(known.description) : name,
					fullName: known?.description ?? name,
					bios: bios && files.includes(`${bios}.zip`) ? `${bios}.zip` : null
				}
			];
		})
		.sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

/** Every system with games, in SYSTEMS' order. */
export async function allGames() {
	const systems = await Promise.all(
		Object.entries(SYSTEMS).map(async ([id, { name }]) => ({ id, name, games: await gamesIn(id) }))
	);
	return systems.filter((s) => s.games.length > 0);
}

/**
 * A game by its folder and file name, as the URL has them: only a file that is there, so nothing
 * outside GAMES_DIR can be asked for.
 */
export async function findGame(system: string, file: string) {
	if (!gamesRoot || !Object.hasOwn(SYSTEMS, system)) return null;
	const found = (await gamesIn(system)).find((g) => g.file === file);
	return found && { ...found, path: path.join(gamesRoot, system, found.file) };
}

/** A game's file, or a BIOS one of the folder's games needs: what the emulator may ask for. */
export async function romFile(system: string, file: string) {
	if (!gamesRoot || !Object.hasOwn(SYSTEMS, system)) return null;
	const games = await gamesIn(system);
	return games.some((g) => g.file === file || g.bios === file)
		? path.join(gamesRoot, system, file)
		: null;
}

export type GameRow = typeof game.$inferSelect;

/** The game's row, made the first time its page is opened. */
export async function gameRow(system: string, file: string): Promise<GameRow> {
	await db.insert(game).values({ system, file }).onConflictDoNothing();
	const [row] = await db
		.select()
		.from(game)
		.where(and(eq(game.system, system), eq(game.file, file)));
	return row;
}

/** Lookups in progress, so opening the page twice does not look the game up twice. */
const running = new Map<number, Promise<GameRow>>();

/** Looks the game up in Wikidata by its title, unless that is already being done. */
export function lookUpGame(row: GameRow, title: string) {
	let lookup = running.get(row.id);
	if (!lookup) {
		lookup = identifyGame(row, title).finally(() => running.delete(row.id));
		running.set(row.id, lookup);
	}
	return lookup;
}

/** By its title, among the games of its console: No-Intro names are clean enough without the AI. */
async function identifyGame(row: GameRow, title: string): Promise<GameRow> {
	const known = { title, year: null, minutes: null };
	const platform = SYSTEMS[row.system].wikidata;
	const ids = [
		...new Set((await Promise.all(queries(known).map((q) => searchGames(q, platform)))).flat())
	];
	const candidates = await describeGames(ids);
	const { match: likely, ranked } = pick(candidates, known);
	// Without a year to compare, the films' rule doubts too much: a game with exactly that name, if
	// it is the only one, is it («Super Mario World», not «Super Mario World 2: Yoshi's Island»).
	const exact = candidates.filter((c) =>
		c.names.some((n) => normalize(n) === normalize(known.title))
	);
	const match = likely ?? (exact.length === 1 ? exact[0] : null);
	log.info(
		'juegos',
		`Ficha del juego «${known.title}»: ${match ? `${match.title} (${match.year})` : ranked.length ? `${ranked.length} candidatos` : 'no encontrado'}`,
		{ gameId: row.id, candidates: ranked.map((c) => c.id) }
	);
	if (match) return chooseGame(row.id, match.id);
	return save(row.id, {
		status: ranked.length ? 'ambiguous' : 'not_found',
		candidates: ranked.map(({ id, title, year, description }) => ({ id, title, year, description }))
	});
}

/** The game is this Wikidata item: its details, saved. */
export async function chooseGame(gameId: number, wikidataId: string): Promise<GameRow> {
	const details = await gameDetails(wikidataId);
	return save(gameId, { status: 'found', ...details, candidates: [] });
}

async function save(gameId: number, values: Partial<typeof game.$inferInsert>) {
	const [saved] = await db
		.update(game)
		// Every column, so a new lookup does not keep anything from the previous one.
		.set({
			wikidataId: null,
			title: null,
			year: null,
			developers: [],
			publishers: [],
			genres: [],
			modes: [],
			composers: [],
			synopsis: null,
			wikipediaUrl: null,
			candidates: [],
			...values,
			updatedAt: new Date()
		})
		.where(eq(game.id, gameId))
		.returning();
	return saved;
}

/**
 * The pictures of a game, in DATA_DIR/juegos/<id>: libretro's title screen, screenshot and box
 * (https://docs.libretro.com/guides/roms-playlists-thumbnails/), and the one taken while playing
 * (the remote's Play/Pause).
 */
export const PICTURES = ['titulo', 'captura', 'caratula', 'mia'] as const;
export type Picture = (typeof PICTURES)[number];
const LIBRETRO = { titulo: 'Named_Titles', captura: 'Named_Snaps', caratula: 'Named_Boxarts' };
type LibretroPicture = keyof typeof LIBRETRO;

const gameDir = (gameId: number) => path.join(dataRoot, 'juegos', String(gameId));
export const pictureFile = (gameId: number, kind: Picture) =>
	path.join(gameDir(gameId), `${kind}.png`);
/** Asked libretro for and it has none: not asked again. */
const missingMark = (gameId: number, kind: LibretroPicture) =>
	path.join(gameDir(gameId), `.sin-${kind}`);

const exists = (file: string) =>
	stat(file).then(
		() => true,
		() => false
	);

/** Whole or not at all: the page may be asking for it at the same time. */
async function writeWhole(file: string, write: (part: string) => Promise<void>) {
	await mkdir(path.dirname(file), { recursive: true });
	await write(`${file}.part`);
	await rename(`${file}.part`, file);
}

/** A game with its row, to fetch its pictures. */
type Target = { id: number; system: string; fullName: string; title: string };

/** libretro's name for a game: its full name, with these characters as `_`. */
const libretroName = (fullName: string) => fullName.replace(/[&*/:`<>?\\|"]/g, '_');

/** One of libretro's pictures of the game, unless it is here already or libretro has none. */
async function fetchPicture(row: Target, kind: LibretroPicture) {
	const file = pictureFile(row.id, kind);
	if ((await exists(file)) || (await exists(missingMark(row.id, kind)))) return;
	const url = [
		'https://thumbnails.libretro.com',
		encodeURIComponent(SYSTEMS[row.system].libretro),
		LIBRETRO[kind],
		`${encodeURIComponent(libretroName(row.fullName))}.png`
	].join('/');
	const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	if (res.status === 404) {
		await mkdir(gameDir(row.id), { recursive: true });
		await writeFile(missingMark(row.id, kind), '');
		return;
	}
	// Anything else, asked again next time.
	if (!res.ok) throw new Error(`thumbnails.libretro.com: ${res.status} ${res.statusText}`);
	const png = new Uint8Array(await res.arrayBuffer());
	await writeWhole(file, (part) => writeFile(part, png));
}

/** Without stopping at a failure: logged, and asked again next time. */
const tryFetch = (row: Target, kind: LibretroPicture) =>
	fetchPicture(row, kind).catch((problem) =>
		log.warn('juegos', `No se pudo bajar de libretro una imagen de «${row.title}»`, {
			gameId: row.id,
			kind,
			error: problem
		})
	);

/**
 * The game's page: libretro's pictures the first time, and one as its background while it has
 * none (the one taken while playing, else the title screen, else the screenshot).
 */
export async function fetchPictures(row: GameRow, found: Game) {
	const target = { ...found, id: row.id };
	await Promise.all((['titulo', 'captura', 'caratula'] as const).map((k) => tryFetch(target, k)));
	if (await exists(gameBackdropFile(row.id))) return;
	for (const kind of ['mia', 'titulo', 'captura'] as const)
		if (await exists(pictureFile(row.id, kind))) return chooseGameBackdrop(row.id, kind);
}

/** The pictures there are of the game, and which one is its background. */
export async function gamePictures(gameId: number) {
	const shown = await readFile(gameBackdropFile(gameId)).catch(() => null);
	const pictures = await Promise.all(
		PICTURES.map(async (kind) => {
			const file = pictureFile(gameId, kind);
			const [data, info] = await Promise.all([
				readFile(file).catch(() => null),
				stat(file).catch(() => null)
			]);
			return data && info
				? {
						kind,
						url: `/api/juegos/imagen/${gameId}/${kind}?v=${Math.round(info.mtimeMs)}`,
						chosen: Boolean(shown?.equals(data))
					}
				: null;
		})
	);
	return pictures.filter((p) => p !== null);
}

/**
 * The image behind the top of its page: a copy of one of its pictures, so choosing another is
 * copying it here. Shown without smoothing: big pixels, as on the console.
 */
export const gameBackdropFile = (gameId: number) =>
	path.join(dataRoot, 'fondo', `juego-${gameId}.png`);

/** Its address, changed when another is chosen; null if there is none. */
export const gameBackdropUrl = (gameId: number) =>
	stat(gameBackdropFile(gameId)).then(
		(info) => `/api/fondo/juego/${gameId}?v=${Math.round(info.mtimeMs)}`,
		() => null
	);

/** That picture as its background; false if there is no such picture. */
export async function chooseGameBackdrop(gameId: number, kind: Picture) {
	const source = pictureFile(gameId, kind);
	if (!(await exists(source))) return false;
	await writeWhole(gameBackdropFile(gameId), (part) => copyFile(source, part));
	return true;
}

/** Taken while playing: its own picture, and its background from now on. */
export async function saveGameBackdrop(gameId: number, png: Uint8Array) {
	await writeWhole(pictureFile(gameId, 'mia'), (part) => writeFile(part, png));
	await chooseGameBackdrop(gameId, 'mia');
}

/** How many games' boxes are asked libretro for at a time. */
const AT_ONCE = 4;

/**
 * The boxes of a console's games, by file name, for their tiles: those missing are fetched from
 * libretro first, unless `fetch` is false.
 */
export async function systemCovers(system: string, games: Game[], fetch = true) {
	const files = games.map((g) => g.file);
	if (fetch && files.length)
		await db
			.insert(game)
			.values(files.map((file) => ({ system, file })))
			.onConflictDoNothing();
	const rows = await db
		.select({ id: game.id, file: game.file })
		.from(game)
		.where(eq(game.system, system));
	const byFile = new Map(games.map((g) => [g.file, g]));
	const wanted = rows.flatMap((r) => {
		const found = byFile.get(r.file);
		return found ? [{ ...found, id: r.id }] : [];
	});
	if (fetch)
		for (let i = 0; i < wanted.length; i += AT_ONCE)
			await Promise.all(wanted.slice(i, i + AT_ONCE).map((r) => tryFetch(r, 'caratula')));
	const covers: Record<string, string> = {};
	await Promise.all(
		wanted.map(async (r) => {
			const info = await stat(pictureFile(r.id, 'caratula')).catch(() => null);
			if (info)
				covers[r.file] = `/api/juegos/imagen/${r.id}/caratula?v=${Math.round(info.mtimeMs)}`;
		})
	);
	return covers;
}
