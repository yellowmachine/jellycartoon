import { sql } from 'drizzle-orm';
import { localDay, localTime } from 'comun/agenda.ts';
import { db } from '#lib/server/db/index.ts';
import { houseKitchen } from '#lib/server/fridge.ts';
import { newDay, sendDue } from '#lib/server/agenda/agenda.ts';
import { ringDue } from '#lib/server/alarms/alarms.ts';
import { sendDueDoses } from '#lib/server/medication.ts';
import { companionTick } from '#lib/server/companion.ts';
import { forgetOver } from '#lib/server/memory.ts';
import { forgetOldChat } from '#lib/server/chat.ts';
import { fuelAlerts } from '#lib/server/energy/fuel.ts';
import { checkTimedRules } from '#lib/server/rules.ts';
import { warnKeyExpiring } from '#lib/server/ai-stopped.ts';
import { learnPending, proposeRules, SUMMARY_AT, summarizeLearned } from '#lib/server/learn.ts';
import { hasBot, startBot } from '#lib/server/telegram/bot.ts';
import { refreshAll, REFRESH_HOURS } from '#lib/server/podcasts/podcasts.ts';
import { cleanupCopies } from '#lib/server/storage-move.ts';
import { indexAll } from '#lib/server/own-music.ts';
import { indexAll as indexAllGames } from '#lib/server/own-games.ts';
import { syncFamily } from '#lib/server/banks/bank.ts';
import { visits } from '#lib/server/section-visits.ts';
import { summarizeOldPositions } from '#lib/server/owntracks/retention.ts';

/**
 * The cloud's own clock (#253): every few seconds, each family's alarms whose time has come; every
 * minute, its agenda's notices, its medication's doses (#308), «Compañía» (#469) and its rules (#331); in the evening,
 * what the voice learned that day and the rules it proposes (#331); each morning, whether its
 * OpenRouter key is about to expire and whether their butane or pellet runs out (#513); at midnight,
 * the fridges' «Hoy», what the voice remembered until yesterday (#331) and Preguntar's messages
 * over a month old (#470); every few hours, its
 * podcasts' feeds; every hour, the payments of each one's bank (#502). At startup, the families' Telegram bots. The families come from a function of
 * the database's owner that gives only their ids (migration 0007): each is then looked at within
 * its own family, as everything else.
 */

/** How late an alarm may ring: a few seconds after its minute. */
const TICK_MS = 10_000;
const NOTICES_MS = 60_000;
/** When the families' OpenRouter keys are looked at, to say that one is about to expire. */
const KEY_CHECK_AT = '10:00';

async function families() {
	const rows = await db.execute<{ id: string }>(sql`select family_ids() as id`);
	return [...rows].map((r) => r.id);
}

async function eachFamily(what: string, work: (familyId: string) => Promise<void>) {
	for (const familyId of await families())
		await work(familyId).catch((error) =>
			console.error(`[reloj] ${what}, familia ${familyId}`, error)
		);
}

let started = false;

export function startScheduler() {
	if (started) return;
	started = true;
	void eachFamily('Telegram', async (id) => {
		if (await hasBot(id)) await startBot(id);
	});
	// A few minutes after starting, not to add to its load; then every REFRESH_HOURS.
	const podcasts = () => void eachFamily('Podcasts', refreshAll);
	setTimeout(podcasts, 5 * 60_000).unref();
	setInterval(podcasts, REFRESH_HOURS * 60 * 60_000).unref();
	// Dinero's bank (#502): what bunq's calls missed, every hour, a while after starting.
	const banks = () => void eachFamily('Banco', syncFamily);
	setTimeout(banks, 10 * 60_000).unref();
	setInterval(banks, 60 * 60_000).unref();
	let day = localDay();
	let summarized = '';
	let keysChecked = '';
	let lastNotices = 0;
	let busy = false;
	setInterval(async () => {
		if (busy) return;
		busy = true;
		try {
			await eachFamily('Alarmas', (id) => ringDue(houseKitchen(id)));
			if (Date.now() - lastNotices >= NOTICES_MS) {
				lastNotices = Date.now();
				await eachFamily('Avisos de la agenda', (id) => sendDue(houseKitchen(id)));
				await eachFamily('Tomas de medicación', (id) => sendDueDoses(houseKitchen(id)));
				// «Compañía» (#469): ask, ask again, or tell the linked families.
				await eachFamily('Compañía', (id) => companionTick(id));
				await eachFamily('Reglas', checkTimedRules);
				// What was said, learned from once the voice is quiet (#331, phase 6).
				await eachFamily('Aprender de lo hablado', learnPending);
				// Once a day; again after a restart only replaces the notice (its tag).
				if (localTime() >= KEY_CHECK_AT && keysChecked !== localDay()) {
					keysChecked = localDay();
					await eachFamily('Caducidad de la clave de IA', warnKeyExpiring);
					// Butane or pellet about to run out with the cold to come (#513).
					await eachFamily('Butano y pellet', fuelAlerts);
				}
				// «Hoy he aprendido» (#331, phase 6), once a day; again after a restart only replaces it.
				if (localTime() >= SUMMARY_AT && summarized !== localDay()) {
					summarized = localDay();
					await eachFamily('Lo aprendido hoy', summarizeLearned);
					await eachFamily('Reglas propuestas', proposeRules);
				}
			}
			if (localDay() !== day) {
				day = localDay();
				newDay();
				// What the voice was to remember until yesterday (#331).
				await eachFamily('Lo que ya no hay que recordar', async (id) => {
					await forgetOver(houseKitchen(id));
				});
				// Preguntar's messages over CHAT_DAYS old (#470); the reports stay.
				await eachFamily('Conversaciones antiguas', async (id) => {
					await forgetOldChat(houseKitchen(id));
				});
				// Which sections each one opened, over 90 days ago (/admin, «Qué usa»).
				await visits
					.forgetOld()
					.catch((error) => console.error('[reloj] Secciones usadas antiguas', error));
				// OwnTracks' positions over 90 days old (#593): each day summed up, then forgotten.
				await eachFamily('Posiciones de OwnTracks antiguas', summarizeOldPositions);
				// «Tu música» (#534): each family's bucket read again, not waited for (it takes long).
				void families()
					.then(indexAll)
					.catch((error) => console.error('[reloj] Tu música', error));
				// «Tus juegos» (#564): the same, each family's games' bucket listed again.
				void families()
					.then(indexAllGames)
					.catch((error) => console.error('[reloj] Tus juegos', error));
				// Their copies in Seilide's storage, a week after moving to their own (#480).
				await cleanupCopies().catch((error) =>
					console.error('[reloj] Copias de ficheros en Seilide', error)
				);
			}
		} catch (error) {
			console.error('[reloj] No se pudo mirar', error);
		} finally {
			busy = false;
		}
	}, TICK_MS).unref();
}
