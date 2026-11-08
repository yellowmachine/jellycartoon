import { eq } from 'drizzle-orm';
import { parseClock } from 'comun/clock.ts';
import { localTime } from 'comun/agenda.ts';
import { plug } from '../db/schema.ts';
import { asFamily } from '../family.ts';
import { houseKitchen } from '../fridge.ts';
import { tell } from '../inbox.ts';
import { familyAdults } from '../kids.ts';
import { familySatellites, sayOnSatellites } from '../satellites.ts';
import { inQuietHours } from '../voice/quiet-check.ts';
import { voiceSettings } from '../voice/settings.ts';
import { setPlugWatcher } from './plugs.ts';
import { PlugWatch, type WatchEvent } from './watch.ts';

/**
 * The plugs' notices (#396, phase 3): what watch.ts reads in their watts, told to the family's
 * adults (their «Buzón» and phones) and, if chosen, said by the satellites, except in the «Horas de
 * silencio» (a fridge stopped, even then). Loaded by hooks.server.ts, so that plugs.ts need not
 * bring the inbox along. Only plugs seen since Seilide started are watched: one that never
 * connects again after a restart is not told about.
 */

interface Watched {
	familyId: string;
	name: string;
	hours: number | null;
	aloud: boolean;
	watch: PlugWatch;
}

const watched = new Map<string, Watched>();

const NOTICES: Record<
	WatchEvent,
	(w: Watched) => { title: string; body: string; said: string; urgent?: boolean }
> = {
	done: (w) => ({
		title: `Ha terminado: ${w.name}`,
		body: `${w.name} ha acabado.`,
		said: `${w.name} ha terminado.`
	}),
	stopped: (w) => ({
		title: `${w.name} no funciona`,
		body: `Lleva 3 horas sin gastar nada. Mira si sigue enfriando.`,
		said: `Atención: ${w.name} lleva tres horas sin funcionar.`,
		urgent: true
	}),
	offline: (w) => ({
		title: `${w.name}, sin conexión`,
		body: 'Lleva media hora sin conectar: puede que se haya ido la luz o la wifi en casa.',
		said: `${w.name} lleva media hora sin conexión.`
	}),
	longOn: (w) => ({
		title: `${w.name} sigue encendido`,
		body: `Lleva más de ${w.hours === 1 ? 'una hora' : `${w.hours} horas`} encendido.`,
		said: `${w.name} lleva mucho rato encendido.`
	})
};

async function notify(plugId: string, w: Watched, event: WatchEvent) {
	const n = NOTICES[event](w);
	const k = houseKitchen(w.familyId);
	const adults = await familyAdults(k);
	await tell(
		w.familyId,
		adults.map((a) => a.id),
		{
			kind: 'enchufe',
			level: n.urgent ? 'urgente' : 'normal',
			title: n.title,
			body: n.body,
			tag: `enchufe-${plugId}-${event}`,
			url: '/enchufes',
			ttl: 6 * 3600
		}
	);
	// Offline, the satellites may be without power too; they say it when they can.
	if (!w.aloud) return;
	const [satellites, settings] = await Promise.all([
		familySatellites(w.familyId),
		voiceSettings(k)
	]);
	const quiet =
		!n.urgent && settings.quiet && inQuietHours(settings.quiet, parseClock(localTime())!);
	if (satellites.length && !quiet)
		sayOnSatellites(
			satellites.map((s) => s.id),
			n.said
		);
}

function emit(plugId: string, w: Watched, events: WatchEvent[]) {
	for (const event of events)
		notify(plugId, w, event).catch((error) =>
			console.error('[enchufes] Aviso no mandado', { plugId, event, error })
		);
}

/** Its notices as saved: watched if any is on, keeping what it was counting. */
async function load(familyId: string, plugId: string) {
	const [row] = await asFamily(familyId, (tx) =>
		tx
			.select({
				name: plug.name,
				done: plug.notifyDone,
				stopped: plug.notifyStopped,
				offline: plug.notifyOffline,
				onHours: plug.notifyOnHours,
				aloud: plug.notifyAloud
			})
			.from(plug)
			.where(eq(plug.id, plugId))
	);
	if (!row || !(row.done || row.stopped || row.offline || row.onHours !== null)) {
		watched.delete(plugId);
		return;
	}
	const settings = {
		done: row.done,
		stopped: row.stopped,
		offline: row.offline,
		onHours: row.onHours
	};
	const before = watched.get(plugId);
	if (before) before.watch.settings = settings;
	watched.set(plugId, {
		familyId,
		name: row.name,
		hours: row.onHours,
		aloud: row.aloud,
		watch: before?.watch ?? new PlugWatch(settings, Date.now())
	});
}

setPlugWatcher({
	load(familyId, plugId) {
		load(familyId, plugId).catch((error) =>
			console.error('[enchufes] Avisos sin cargar', { plugId, error })
		);
	},
	live(_familyId, plugId, power, output) {
		const w = watched.get(plugId);
		if (w) emit(plugId, w, w.watch.seen(power, output, Date.now()));
	},
	gone(_familyId, plugId) {
		watched.get(plugId)?.watch.gone(Date.now());
	},
	tick() {
		const now = Date.now();
		for (const [plugId, w] of watched) emit(plugId, w, w.watch.tick(now));
	},
	forget(plugId) {
		watched.delete(plugId);
	}
});
