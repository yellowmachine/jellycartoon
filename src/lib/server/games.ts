import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { dataRoot, gamesRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { normalize, pick, queries } from '#lib/server/cinema/match.ts';
import { describeGames, gameDetails, searchGames } from '#lib/server/cinema/wikidata.ts';

/**
 * The folders of GAMES_DIR that are played (#176), each with one system of EmulatorJS
 * (https://emulatorjs.org/docs/systems), which picks its default core, and the console in Wikidata,
 * to look its games up. Only the light consoles: other folders are left out.
 */
export const SYSTEMS: Record<string, { name: string; core: string; wikidata: string }> = {
	nes: { name: 'NES', core: 'nes', wikidata: 'Q172742' },
	snes: { name: 'Super Nintendo', core: 'snes', wikidata: 'Q183259' },
	gb: { name: 'Game Boy', core: 'gb', wikidata: 'Q186437' },
	gbc: { name: 'Game Boy Color', core: 'gb', wikidata: 'Q203992' },
	gba: { name: 'Game Boy Advance', core: 'gba', wikidata: 'Q188642' },
	mastersystem: { name: 'Master System', core: 'segaMS', wikidata: 'Q209868' },
	megadrive: { name: 'Mega Drive', core: 'segaMD', wikidata: 'Q10676' }
};

export type Game = { system: string; file: string; title: string };

/** «Super Mario World (Europe).7z» → «Super Mario World»: no extension, no region or version. */
const titleOf = (file: string) =>
	path
		.parse(file)
		.name.replace(/(\s*[([][^)\]]*[)\]])+$/, '')
		.trim() || file;

/** The games of a system's folder, by title; none if there is no folder. Read each time. */
async function gamesIn(system: string): Promise<Game[]> {
	const entries = await readdir(path.join(gamesRoot!, system), { withFileTypes: true }).catch(
		() => []
	);
	return entries
		.filter((e) => e.isFile() && !e.name.startsWith('.'))
		.map((e) => ({ system, file: e.name, title: titleOf(e.name) }))
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

/** Looks the game up in Wikidata, unless that is already being done. */
export function lookUpGame(row: GameRow) {
	let lookup = running.get(row.id);
	if (!lookup) {
		lookup = identifyGame(row).finally(() => running.delete(row.id));
		running.set(row.id, lookup);
	}
	return lookup;
}

/** By its title, among the games of its console: No-Intro names are clean enough without the AI. */
async function identifyGame(row: GameRow): Promise<GameRow> {
	const known = { title: titleOf(row.file), year: null, minutes: null };
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
 * The image behind the top of its page: a capture of the game, taken while playing (the remote's
 * Play/Pause), shown without smoothing: big pixels, as on the console.
 */
export const gameBackdropFile = (gameId: number) =>
	path.join(dataRoot, 'fondo', `juego-${gameId}.png`);

/** When it was taken, to ask for the new one; null if there is none. */
export const gameBackdropTime = (gameId: number) =>
	stat(gameBackdropFile(gameId)).then(
		(info) => info.mtimeMs,
		() => null
	);

export async function saveGameBackdrop(gameId: number, png: Uint8Array) {
	const file = gameBackdropFile(gameId);
	await mkdir(path.dirname(file), { recursive: true });
	// Whole or not at all: the page may be asking for it at the same time.
	await writeFile(`${file}.part`, png);
	await rename(`${file}.part`, file);
}
