import { readdir, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { parse } from '@node-steam/vdf';
import { sql } from 'drizzle-orm';
import { STEAM_SOCKET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { steamGame } from '#lib/server/db/schema.ts';
import { steamRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';

/**
 * Steam's games on the PC with the screen: those installed, read from its own files, and launched
 * there with its `steam://rungameid/<appid>` URL by a systemd service (deploy/jellycartoon-steam.socket),
 * in Big Picture. Only Steam's main library (its `steamapps`): other disks' are not mounted.
 */

/** A game's pictures in Steam's library cache, by the name each has there. */
const PICTURES = {
	// The vertical one, as in Steam's library: `library_capsule.jpg` in the newer games.
	caratula: ['library_600x900.jpg', 'library_capsule.jpg'],
	fondo: ['library_hero.jpg'],
	logo: ['logo.png']
} as const;
export type SteamPicture = keyof typeof PICTURES;
export const isSteamPicture = (kind: string): kind is SteamPicture => Object.hasOwn(PICTURES, kind);

export type SteamGame = {
	appid: number;
	name: string;
	/** Its pictures' files, relative to its folder in the library cache. */
	pictures: Partial<Record<SteamPicture, string>>;
};

/** Set in a manifest's StateFlags once the game is downloaded whole. */
const FULLY_INSTALLED = 4;

/**
 * Its pictures, as Steam keeps them for its library: in the app's folder or, in the newer ones, in
 * a subfolder named by a hash.
 */
async function picturesOf(appid: number) {
	const files = await readdir(path.join(steamRoot!, 'appcache', 'librarycache', String(appid)), {
		recursive: true
	}).catch(() => []);
	const pictures: SteamGame['pictures'] = {};
	for (const [kind, names] of Object.entries(PICTURES) as [SteamPicture, readonly string[]][]) {
		pictures[kind] = names.flatMap((name) => files.filter((f) => path.basename(f) === name))[0];
	}
	return pictures;
}

/**
 * The games installed, by name; none without STEAM_DIR. Read each time. Proton and Steam's runtimes
 * are installed as apps too, but have no cover for the library: that leaves them out.
 */
export async function steamGames(): Promise<SteamGame[]> {
	if (!steamRoot) return [];
	const apps = path.join(steamRoot, 'steamapps');
	const manifests = (await readdir(apps).catch(() => [])).filter((f) =>
		/^appmanifest_\d+\.acf$/.test(f)
	);
	const games = await Promise.all(
		manifests.map(async (file): Promise<SteamGame | null> => {
			try {
				const { AppState: app } = parse(await readFile(path.join(apps, file), 'utf8'));
				if (!(Number(app.StateFlags) & FULLY_INSTALLED)) return null;
				const appid = Number(app.appid);
				const pictures = await picturesOf(appid);
				return pictures.caratula ? { appid, name: String(app.name), pictures } : null;
			} catch (problem) {
				log.warn('juegos', 'No se pudo leer un juego de Steam', { file, error: problem });
				return null;
			}
		})
	);
	return games.filter((g) => g !== null).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Saves them as they are listed, with the name they have now (steamGame in the schema). */
export async function saveSteamGames(games: SteamGame[]) {
	if (!games.length) return;
	await db
		.insert(steamGame)
		.values(games.map(({ appid, name }) => ({ appid, name })))
		.onConflictDoUpdate({
			target: steamGame.appid,
			set: { name: sql`excluded.name`, updatedAt: sql`now()` }
		});
}

/** A game's picture, as a path; null if it has none. */
export async function steamPictureFile(appid: number, kind: SteamPicture) {
	if (!steamRoot) return null;
	const file = (await picturesOf(appid))[kind];
	return file ? path.join(steamRoot, 'appcache', 'librarycache', String(appid), file) : null;
}

export const steamPictureUrl = (appid: number, kind: SteamPicture) =>
	`/api/juegos/steam/${appid}/${kind}`;

/** Whether games can be launched: the service's socket is set up. */
export const steamLaunchEnabled = Boolean(STEAM_SOCKET);

/** Asks the service on the PC with the screen to open the game: its appid, on a line. */
export const launchSteamGame = (appid: number) => tellSteamService(String(appid));

/** Only Big Picture, with no game: Steam's library and store on the TV. */
export const openBigPicture = () => tellSteamService('bigpicture');

/** A line to the service (deploy/jellycartoon-steam.sh): an appid, or `bigpicture`. */
function tellSteamService(line: string) {
	return new Promise<void>((resolve, reject) => {
		const socket = net.createConnection(STEAM_SOCKET!, () => socket.end(`${line}\n`));
		socket.setTimeout(3000, () => socket.destroy(new Error('El servicio de Steam no contesta')));
		socket.once('error', reject);
		socket.once('close', (failed) => failed || resolve());
	});
}
