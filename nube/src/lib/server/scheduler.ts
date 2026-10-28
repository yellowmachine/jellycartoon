import { sql } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import { db } from '#lib/server/db/index.ts';
import { houseKitchen } from '#lib/server/fridge.ts';
import { newDay, sendDue } from '#lib/server/agenda/agenda.ts';
import { ringDue } from '#lib/server/alarms/alarms.ts';
import { hasBot, startBot } from '#lib/server/telegram/bot.ts';

/**
 * The cloud's own clock (#253): every few seconds, each family's alarms whose time has come; every
 * minute, its agenda's notices; at midnight, the fridges' «Hoy». At startup, the families' Telegram
 * bots. The families come from a function
 * of the database's owner that gives only their ids (migration 0007): each is then looked at within
 * its own family, as everything else.
 */

/** How late an alarm may ring: a few seconds after its minute. */
const TICK_MS = 10_000;
const NOTICES_MS = 60_000;

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
	let day = localDay();
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
			}
			if (localDay() !== day) {
				day = localDay();
				newDay();
			}
		} catch (error) {
			console.error('[reloj] No se pudo mirar', error);
		} finally {
			busy = false;
		}
	}, TICK_MS).unref();
}
