import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { askCloud, cloudLink } from '#lib/server/kitchen.ts';
import { log } from '#lib/server/log.ts';
import { today } from '#lib/server/playlist.ts';
import { allGames } from '#lib/server/games.ts';
import { sendWatchLog, tellKeepHistory, type SendWatch } from '#lib/server/watch-log-scope.ts';

/**
 * Seilide's statistics of what is watched and played here (#421): every 10 minutes, what changed; if there is
 * no internet, everything when it comes back. From the first day with Seilide connected, not the
 * history from before. «Seguir viendo» and the children's limits have nothing to do with this.
 */
const EVERY = 10 * 60_000;
const SINCE = 'watch_log_since';

let running = false;

/** The games' names as the games screen shows them (FBNeo's for arcade games), by `system/file`. */
async function gameNames() {
	const systems = await allGames();
	return new Map(systems.flatMap((s) => s.games.map((g) => [`${s.id}/${g.file}`, g.title])));
}

async function send() {
	const link = await cloudLink();
	if (!link) return;
	let since = await getAppSetting(SINCE);
	if (!since) {
		since = today(new Date());
		await setAppSetting(SINCE, since);
	}
	const send: SendWatch = (userId, body) =>
		askCloud<{ known?: boolean }>(link, '/visto', { userId, body });
	await tellKeepHistory(db, send);
	await sendWatchLog(db, since, send, gameNames);
}

/** Now, as when turning off «Guardar lo que veo»; if it is at it, on its next round. */
export async function sendWatchLogNow() {
	if (running) return;
	running = true;
	try {
		await send();
	} catch (error) {
		log.warn('nube', 'No se pudo mandar a Seilide lo visto', { error });
	} finally {
		running = false;
	}
}

export function startSendingWatchLog() {
	void sendWatchLogNow();
	setInterval(sendWatchLogNow, EVERY).unref();
}
