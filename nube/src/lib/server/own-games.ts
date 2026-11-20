import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, isNull, lt, max, notInArray, or, sql, sum } from 'drizzle-orm';
import type {
	ConsoleCard,
	ConsoleGame,
	GameInfo,
	GameSave,
	GameSummary,
	PlayerData
} from 'comun/games.ts';
import { lookUpGameInfo, type GameLookup } from 'comun/wikidata/game-lookup.ts';
import { libretroPicture, SYSTEMS, type LibretroPicture } from 'comun/game-systems.ts';
import { asFamily } from './family.ts';
import { openFor, sealFor } from './family-secret.ts';
import {
	familyMember,
	gameSource,
	ownGame,
	ownGameCartridge,
	ownGameSave,
	ownGameSession
} from './db/schema.ts';
import { bucketOf as musicBucketOf, testSource } from './own-music.ts';
import { listAll } from './own-music-read.ts';
import { gamesOf, hasArcade } from './own-games-index.ts';
import { arcadeGames } from './fbneo.ts';
import { ownPlace, putFile, readFile, removeFile } from './storage.ts';
import { addPlayed } from './watch-log.ts';
import { bucketProblem, labelOf, type Bucket } from './storage-bucket.ts';

/**
 * «Tus juegos» (#564): the games a family keeps in its own bucket (S3, R2, Backblaze…), one folder
 * per console as the house's GAMES_DIR, for Juegos in Seilide, with or without a house. Seilide
 * lists the bucket and keeps that list; the ROM, when the emulator asks for it, goes from the
 * bucket through Seilide (EmulatorJS fetches it: a presigned address would need CORS on the
 * bucket). What each person keeps of a game (cartridge, saved games, time played) is kept here.
 */

/** Where the player asks for the rest (comun's PlayerData.api). */
export const OWN_API = '/api/juegos/propios';
/** In the family's storage (storage.ts): the cartridges, and the saved games with their pictures. */
const CARTRIDGES = 'juegos-cartuchos';
const SAVES = 'juegos-partidas';
/** A listing that has said nothing for this long is taken as dead (a restart). */
const STALE_MS = 30 * 60_000;
/** «Usar el de Tu música»: its bucket, with this folder for the games. */
export const GAMES_FOLDER = 'Juegos/';
/** A key's file name, after its last `/`. */
const fileOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);

/** Tiles in each console's mosaic: 3 × 2, as the house's. */
const MOSAIC = 6;
/** How many boxes are asked libretro for at a time, and at most each time a console is opened. */
const AT_ONCE = 4;
const MOST_ASKED = 120;

const sourceOf = (familyId: string) =>
	asFamily(familyId, async (tx) => (await tx.select().from(gameSource))[0] ?? null);

/** The family's bucket, opened, a while: every file asked for would otherwise open it again. */
const buckets = new Map<string, { at: number; bucket: Promise<Bucket | null> }>();
const BUCKET_MS = 60_000;

export async function bucketOf(familyId: string) {
	const cached = buckets.get(familyId);
	if (cached && Date.now() - cached.at < BUCKET_MS) return cached.bucket;
	const bucket = (async () => {
		const row = await sourceOf(familyId);
		if (!row) return null;
		const text = await openFor(familyId, row.bucket);
		return text ? (JSON.parse(text) as Bucket) : null;
	})();
	bucket.catch(() => buckets.delete(familyId));
	buckets.set(familyId, { at: Date.now(), bucket });
	return bucket;
}

/** How it is, for Ajustes and Juegos: without the bucket's keys. */
export async function sourceView(familyId: string) {
	const row = await sourceOf(familyId);
	if (!row) return null;
	return {
		label: row.label,
		canWrite: row.canWrite,
		scanning: Boolean(row.scanningSince && Date.now() - row.scanningSince.getTime() < STALE_MS),
		indexedAt: row.indexedAt,
		games: row.games,
		problem: row.problem
	};
}

export type GameSourceView = NonNullable<Awaited<ReturnType<typeof sourceView>>>;

/** Saved after trying it, and the listing begins. What is wrong, or null. */
export async function saveSource(familyId: string, b: Bucket) {
	const tried = await testSource(b);
	if ('problem' in tried) return tried.problem;
	const sealed = await sealFor(familyId, JSON.stringify(b));
	const set = { bucket: sealed, label: labelOf(b), canWrite: tried.canWrite, problem: null };
	await asFamily(familyId, (tx) =>
		tx
			.insert(gameSource)
			.values({ familyId, ...set })
			.onConflictDoUpdate({ target: gameSource.familyId, set })
	);
	buckets.delete(familyId);
	void indexGames(familyId);
	return null;
}

/** «Usar el de Tu música»: the same bucket and keys, with GAMES_FOLDER. What is wrong, or null. */
export async function useMusicBucket(familyId: string) {
	const music = await musicBucketOf(familyId);
	if (!music) return 'La familia no tiene Tu música';
	return saveSource(familyId, { ...music, prefix: GAMES_FOLDER });
}

/**
 * «Quitar»: its keys go, and its games are taken as gone; their rows stay, with what each one saved
 * of them, for when the bucket comes back. The bucket, as it is.
 */
export async function removeSource(familyId: string) {
	await asFamily(familyId, async (tx) => {
		await tx.update(ownGame).set({ present: false });
		await tx.delete(gameSource);
	});
	buckets.delete(familyId);
}

/** The listings running in this server: never two for a family. */
const running = new Set<string>();

/** The bucket listed again: new games in, gone ones out. One at a time per family. */
export async function indexGames(familyId: string) {
	if (running.has(familyId)) return;
	running.add(familyId);
	try {
		// Taken in the database too: another server (or this one before a restart) may be on it.
		const now = new Date();
		const taken = await asFamily(familyId, (tx) =>
			tx
				.update(gameSource)
				.set({ scanningSince: now, problem: null })
				.where(
					or(
						isNull(gameSource.scanningSince),
						lt(gameSource.scanningSince, new Date(now.getTime() - STALE_MS))
					)
				)
				.returning({ familyId: gameSource.familyId })
		);
		if (!taken.length) return;
		await scan(familyId).catch(async (err) => {
			const problem = bucketProblem(err);
			console.warn('[tus juegos] No se pudo leer el bucket', { familyId, problem });
			await asFamily(familyId, (tx) => tx.update(gameSource).set({ scanningSince: null, problem }));
		});
	} finally {
		running.delete(familyId);
	}
}

/** Rows written at a time. */
const BATCH = 500;

async function scan(familyId: string) {
	const b = await bucketOf(familyId);
	if (!b) throw new Error('No se pudo abrir el bucket');
	const keys = await listAll(await ownPlace(b).client(), b);
	// The arcade games' titles and BIOS by FBNeo's list; without it, by their short names.
	const arcade = hasArcade(keys, b.prefix)
		? await arcadeGames().catch((problem) => {
				console.warn('[tus juegos] Sin la lista de recreativas de FBNeo', String(problem));
				return null;
			})
		: null;
	const listed = gamesOf(keys, b.prefix, arcade);
	await asFamily(familyId, async (tx) => {
		for (let i = 0; i < listed.length; i += BATCH)
			await tx
				.insert(ownGame)
				.values(listed.slice(i, i + BATCH).map((g) => ({ familyId, ...g, present: true })))
				.onConflictDoUpdate({
					target: [ownGame.familyId, ownGame.system, ownGame.file],
					set: {
						key: sql`excluded.key`,
						size: sql`excluded.size`,
						title: sql`excluded.title`,
						fullName: sql`excluded.full_name`,
						biosKey: sql`excluded.bios_key`,
						present: true
					}
				});
		const seen = new Set(listed.map((g) => `${g.system}/${g.file}`));
		const kept = (
			await tx.select({ id: ownGame.id, system: ownGame.system, file: ownGame.file }).from(ownGame)
		)
			.filter((r) => seen.has(`${r.system}/${r.file}`))
			.map((r) => r.id);
		await tx
			.update(ownGame)
			.set({ present: false })
			.where(kept.length ? notInArray(ownGame.id, kept) : undefined);
		await tx
			.update(gameSource)
			.set({ scanningSince: null, indexedAt: new Date(), games: listed.length, problem: null });
	});
}

/** Every family with a bucket for its games, listed again (the daily clock). */
export async function indexAll(familyIds: string[]) {
	for (const familyId of familyIds)
		if (await sourceOf(familyId).catch(() => null)) await indexGames(familyId);
}

// Pages.

const pictureUrl = (id: number, kind: LibretroPicture) => `${OWN_API}/imagen/${id}/${kind}`;

type Row = typeof ownGame.$inferSelect;

const presentGames = (familyId: string, system?: string) =>
	asFamily(familyId, (tx) =>
		tx
			.select()
			.from(ownGame)
			.where(and(eq(ownGame.present, true), system ? eq(ownGame.system, system) : undefined))
			.orderBy(asc(ownGame.title))
	);

const byTitle = (a: Row, b: Row) => a.title.localeCompare(b.title, 'es');

/** One per console with games, as the house's, with the boxes already known. */
export async function ownConsoles(familyId: string): Promise<ConsoleCard[]> {
	const rows = (await presentGames(familyId)).sort(byTitle);
	return Object.entries(SYSTEMS).flatMap(([id, { name }]) => {
		const games = rows.filter((r) => r.system === id);
		if (!games.length) return [];
		const images = games
			.filter((g) => g.cover === 'si')
			.slice(0, MOSAIC)
			.map((g) => pictureUrl(g.id, 'caratula'));
		return [{ id, name, count: games.length, images }];
	});
}

/** A console's games. */
export async function ownConsoleGames(familyId: string, system: string) {
	if (!Object.hasOwn(SYSTEMS, system)) error(404, 'No hay juegos de esa consola');
	const rows = (await presentGames(familyId, system)).sort(byTitle);
	if (!rows.length) error(404, 'No hay juegos de esa consola');
	const games: ConsoleGame[] = rows.map(({ file, title }) => ({ file, title }));
	return { name: SYSTEMS[system].name, games };
}

/** Whether libretro has that picture of the game: asked once, its answer kept. */
async function libretroHas(row: Row, kind: 'caratula' | 'titulo') {
	const res = await fetch(libretroPicture(row.system, row.fullName, kind), {
		method: 'HEAD',
		signal: AbortSignal.timeout(20_000)
	});
	if (res.status === 404) return 'no' as const;
	// Anything else, asked again next time.
	if (!res.ok) throw new Error(`thumbnails.libretro.com: ${res.status}`);
	return 'si' as const;
}

/** The boxes of a console's games, by file name: those not asked yet, asked libretro first. */
export async function ownCovers(familyId: string, system: string) {
	const rows = await presentGames(familyId, system);
	const unknown = rows.filter((r) => r.cover === null).slice(0, MOST_ASKED);
	for (let i = 0; i < unknown.length; i += AT_ONCE)
		await Promise.all(
			unknown.slice(i, i + AT_ONCE).map(async (r) => {
				const cover = await libretroHas(r, 'caratula').catch(() => null);
				if (!cover) return;
				r.cover = cover;
				await asFamily(familyId, (tx) =>
					tx.update(ownGame).set({ cover }).where(eq(ownGame.id, r.id))
				);
			})
		);
	return Object.fromEntries(
		rows.filter((r) => r.cover === 'si').map((r) => [r.file, pictureUrl(r.id, 'caratula')])
	);
}

/** A game of the family's bucket by its folder and file, as the URL has them. */
async function findGame(familyId: string, system: string, file: string) {
	const [row] = await asFamily(familyId, (tx) =>
		tx
			.select()
			.from(ownGame)
			.where(and(eq(ownGame.system, system), eq(ownGame.file, file), eq(ownGame.present, true)))
	);
	if (!row) error(404, 'Juego no encontrado');
	return row;
}

/** One of the family's games by its id, still in the bucket. */
export async function gameById(familyId: string, id: number) {
	const [row] = Number.isSafeInteger(id)
		? await asFamily(familyId, (tx) => tx.select().from(ownGame).where(eq(ownGame.id, id)))
		: [];
	if (!row) error(404, 'Juego no encontrado');
	return row;
}

/** What the page says at once: which game, and the person's with it. */
export async function ownGameSummary(
	familyId: string,
	userId: string,
	system: string,
	file: string
): Promise<GameSummary> {
	const row = await findGame(familyId, system, file);
	return {
		title: row.title,
		system: SYSTEMS[row.system].name,
		saves: await savesOf(familyId, userId, row.id),
		played: await gameTotals(familyId, userId, row.id)
	};
}

/** Its title screen behind the top of its page, if libretro has it; no card yet (phase 2). */
export async function ownGameDetails(familyId: string, system: string, file: string) {
	const row = await findGame(familyId, system, file);
	let has = row.titleScreen;
	if (!has) {
		has = await libretroHas(row, 'titulo').catch(() => null);
		if (has)
			await asFamily(familyId, (tx) =>
				tx.update(ownGame).set({ titleScreen: has }).where(eq(ownGame.id, row.id))
			);
	}
	return { backdrop: has === 'si' ? pictureUrl(row.id, 'titulo') : null };
}

/** Lookups in progress, so opening the page twice does not look the game up twice. */
const lookingUp = new Map<number, Promise<GameLookup>>();

/** The card as the game's page shows it (comun's GameInfo), as the house's. */
function cardOf(found: GameLookup): GameInfo {
	if (found.status !== 'found')
		return {
			status: found.status,
			year: null,
			developers: [],
			genres: [],
			modes: [],
			composers: [],
			synopsis: null
		};
	const d = found.details;
	return {
		status: 'found',
		year: d.year,
		developers: d.developers,
		genres: d.genres,
		modes: d.modes,
		composers: d.composers,
		synopsis: d.synopsis
	};
}

/**
 * Its card from Wikidata, by its title among its console's games (#564, phase 2): looked up the
 * first time its page is opened, and kept with the game (also when it leaves the bucket).
 */
export async function ownGameInfo(familyId: string, system: string, file: string) {
	const row = await findGame(familyId, system, file);
	if (row.info) return cardOf(row.info);
	let lookup = lookingUp.get(row.id);
	if (!lookup) {
		lookup = lookUpGameInfo(row.title, SYSTEMS[row.system].wikidata)
			.then(async (found) => {
				await asFamily(familyId, (tx) =>
					tx.update(ownGame).set({ info: found }).where(eq(ownGame.id, row.id))
				);
				return found;
			})
			.finally(() => lookingUp.delete(row.id));
		lookingUp.set(row.id, lookup);
	}
	return cardOf(await lookup);
}

/**
 * A game to carry on a device without coverage (games-offline.ts): what its player needs, its box if
 * libretro has it, and what its files take (the game's, and its BIOS's asked to the bucket).
 */
export async function ownCarry(familyId: string, system: string, file: string) {
	const row = await findGame(familyId, system, file);
	let biosBytes = 0;
	const b = row.biosKey ? await bucketOf(familyId) : null;
	if (b && row.biosKey) {
		const s3 = await ownPlace(b).client();
		const head = await s3
			.send(new HeadObjectCommand({ Bucket: b.bucket, Key: row.biosKey }))
			.catch(() => null);
		biosBytes = head?.ContentLength ?? 0;
	}
	return {
		title: row.title,
		consoleName: SYSTEMS[row.system].name,
		cover: row.cover === 'si' ? pictureUrl(row.id, 'caratula') : null,
		player: await ownPlayer(familyId, system, file),
		bytes: row.size + biosBytes
	};
}

/** What the player needs (comun's GamePlayer.svelte), with the rest asked at OWN_API. */
export async function ownPlayer(
	familyId: string,
	system: string,
	file: string
): Promise<PlayerData> {
	const row = await findGame(familyId, system, file);
	return {
		title: row.title,
		core: SYSTEMS[row.system].core,
		// Its name at the end, as the house's: EmulatorJS looks at it.
		rom: `${OWN_API}/rom/${row.id}/${encodeURIComponent(row.file)}`,
		// An arcade game's BIOS, in its folder: asked by its name, as the house's.
		bios: row.biosKey
			? `${OWN_API}/rom/${row.id}/${encodeURIComponent(fileOf(row.biosKey))}`
			: null,
		gameId: row.id,
		// The remote's Play/Pause capture is the house's TV's: none here.
		backdrop: '',
		cartridge: `${OWN_API}/cartucho/${row.id}`,
		// EmulatorJS' own buttons: choosing others is at the house (/juegos/mando).
		controls: {},
		// In the browser, no shader (GamePlayer's `web`).
		shader: { own: null, inherited: 'disabled' },
		api: OWN_API
	};
}

/** One of libretro's pictures of a game, as it gives it. */
export async function libretroImage(familyId: string, id: number, kind: LibretroPicture) {
	const row = await gameById(familyId, id);
	const res = await fetch(libretroPicture(row.system, row.fullName, kind), {
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) error(res.status === 404 ? 404 : 502, 'Sin imagen');
	return new Response(res.body, {
		headers: {
			'content-type': 'image/png',
			// It does not change: kept by the browser a month.
			'cache-control': 'private, max-age=2592000'
		}
	});
}

/** The ROM, from the bucket as the emulator asks for it (a range, or whole). */
/**
 * A game's file (`file`, as the address ends), or its BIOS (an arcade game's, by its name): nothing
 * else of the bucket.
 */
export async function romResponse(
	familyId: string,
	id: number,
	file: string,
	range: string | null
) {
	const row = await gameById(familyId, id);
	const b = await bucketOf(familyId);
	if (!b || !row.present) error(404, 'Juego no encontrado');
	const key = row.biosKey && file === fileOf(row.biosKey) ? row.biosKey : row.key;
	const s3 = await ownPlace(b).client();
	const valid = range && /^bytes=\d*-\d*$/.test(range) ? range : undefined;
	let got;
	try {
		got = await s3.send(new GetObjectCommand({ Bucket: b.bucket, Key: key, Range: valid }));
	} catch (err) {
		console.warn('[tus juegos] No se pudo leer la ROM', {
			familyId,
			id,
			problem: bucketProblem(err)
		});
		error(502, bucketProblem(err));
	}
	const headers = new Headers({
		'content-type': 'application/octet-stream',
		'accept-ranges': 'bytes',
		'cache-control': 'private, max-age=86400'
	});
	if (got.ContentLength !== undefined) headers.set('content-length', String(got.ContentLength));
	if (got.ContentRange) headers.set('content-range', got.ContentRange);
	if (got.LastModified) headers.set('last-modified', got.LastModified.toUTCString());
	return new Response(got.Body!.transformToWebStream(), {
		status: got.ContentRange ? 206 : 200,
		headers
	});
}

// What each person keeps of a game.

/** A person's cartridge save of a game, gzipped; or whether nobody in the family has one. */
export async function cartridgeOf(familyId: string, userId: string, gameId: number) {
	const rows = await asFamily(familyId, (tx) =>
		tx
			.select({ id: ownGameCartridge.id, userId: ownGameCartridge.userId })
			.from(ownGameCartridge)
			.where(eq(ownGameCartridge.gameId, gameId))
	);
	const own = rows.find((r) => r.userId === userId);
	const bytes = own ? await readFile(familyId, CARTRIDGES, `${own.id}.srm.gz`) : null;
	return { bytes, nobody: !rows.length };
}

export async function saveCartridge(
	familyId: string,
	userId: string,
	gameId: number,
	gzipped: Uint8Array
) {
	const [row] = await asFamily(familyId, (tx) =>
		tx
			.insert(ownGameCartridge)
			.values({ familyId, userId, gameId })
			.onConflictDoUpdate({
				target: [ownGameCartridge.userId, ownGameCartridge.gameId],
				set: { updatedAt: new Date() }
			})
			.returning({ id: ownGameCartridge.id })
	);
	await putFile(familyId, CARTRIDGES, `${row.id}.srm.gz`, gzipped, 'application/gzip');
}

/** A person's saved games of a game, the newest first. */
export async function savesOf(
	familyId: string,
	userId: string,
	gameId: number
): Promise<GameSave[]> {
	const rows = await asFamily(familyId, (tx) =>
		tx
			.select()
			.from(ownGameSave)
			.where(and(eq(ownGameSave.userId, userId), eq(ownGameSave.gameId, gameId)))
			.orderBy(desc(ownGameSave.createdAt))
	);
	return rows.map((r) => ({
		id: r.id,
		createdAt: r.createdAt.toISOString(),
		picture: r.hasPicture ? `${OWN_API}/partida/${r.id}/imagen` : null
	}));
}

/** One of the person's saved games; 404 if it is not theirs. */
export async function ownSave(familyId: string, userId: string, saveId: number) {
	const [row] = Number.isSafeInteger(saveId)
		? await asFamily(familyId, (tx) =>
				tx
					.select()
					.from(ownGameSave)
					.where(and(eq(ownGameSave.id, saveId), eq(ownGameSave.userId, userId)))
			)
		: [];
	if (!row) error(404, 'Partida no encontrada');
	return row;
}

export async function addSave(
	familyId: string,
	userId: string,
	gameId: number,
	state: Uint8Array,
	png: Uint8Array | null
) {
	const [row] = await asFamily(familyId, (tx) =>
		tx
			.insert(ownGameSave)
			.values({ familyId, userId, gameId, hasPicture: Boolean(png) })
			.returning({ id: ownGameSave.id })
	);
	try {
		await putFile(familyId, SAVES, `${row.id}.state`, state, 'application/octet-stream');
		if (png) await putFile(familyId, SAVES, `${row.id}.png`, png, 'image/png');
	} catch (err) {
		// Without its state it is nothing: the row goes too.
		await removeSave(familyId, row.id);
		throw err;
	}
	return row.id;
}

export async function removeSave(familyId: string, saveId: number) {
	await asFamily(familyId, (tx) => tx.delete(ownGameSave).where(eq(ownGameSave.id, saveId)));
	await removeFile(familyId, SAVES, `${saveId}.state`).catch(() => {});
	await removeFile(familyId, SAVES, `${saveId}.png`).catch(() => {});
}

export const saveState = (familyId: string, saveId: number) =>
	readFile(familyId, SAVES, `${saveId}.state`);
export const savePicture = (familyId: string, saveId: number) =>
	readFile(familyId, SAVES, `${saveId}.png`);

/** A new session; null with «Guardar lo que veo» off, as the house's keeps nothing then. */
export async function startSession(familyId: string, userId: string, gameId: number) {
	return asFamily(familyId, async (tx) => {
		const [me] = await tx
			.select({ keep: familyMember.keepHistory })
			.from(familyMember)
			.where(eq(familyMember.userId, userId));
		if (!me?.keep) return null;
		const [row] = await tx
			.insert(ownGameSession)
			.values({ familyId, userId, gameId })
			.returning({ id: ownGameSession.id });
		return row.id;
	});
}

/** Some seconds more: never more than the time that went by since the last report. */
export async function reportSession(
	familyId: string,
	userId: string,
	sessionId: number,
	seconds: number
) {
	if (!Number.isSafeInteger(sessionId)) return false;
	return asFamily(familyId, async (tx) => {
		const [row] = await tx
			.select({ endedAt: ownGameSession.endedAt, gameId: ownGame.id, title: ownGame.title })
			.from(ownGameSession)
			.innerJoin(ownGame, eq(ownGame.id, ownGameSession.gameId))
			.where(and(eq(ownGameSession.id, sessionId), eq(ownGameSession.userId, userId)));
		if (!row) return false;
		const now = new Date();
		const gone = (now.getTime() - row.endedAt.getTime()) / 1000 + 5;
		const played = Math.round(Math.max(0, Math.min(seconds, gone)));
		await tx
			.update(ownGameSession)
			.set({ seconds: sql`${ownGameSession.seconds} + ${played}`, endedAt: now })
			.where(eq(ownGameSession.id, sessionId));
		// Estadísticas → Jugar (#421), beside the house's (`j<id>`): `pj<id>`, the bucket's game.
		const what = {
			item: `pj${row.gameId}`,
			kind: 'juego',
			seriesTitle: null,
			title: row.title
		} as const;
		await addPlayed(tx, familyId, userId, what, played, now);
		return true;
	});
}

/** What a person has played of one game: in all, and the last time. */
async function gameTotals(familyId: string, userId: string, gameId: number) {
	const [row] = await asFamily(familyId, (tx) =>
		tx
			.select({
				seconds: sum(ownGameSession.seconds).mapWith(Number),
				last: max(ownGameSession.endedAt)
			})
			.from(ownGameSession)
			.where(and(eq(ownGameSession.userId, userId), eq(ownGameSession.gameId, gameId)))
	);
	return { seconds: row?.seconds ?? 0, last: row?.last?.toISOString() ?? null };
}
