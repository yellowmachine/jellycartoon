import { hkdfSync } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { BETTER_AUTH_SECRET, ORIGIN } from '$app/env/private';
import { houseKitchen, kitchenOf, type Kitchen } from '#lib/server/fridge.ts';
import { askHouse, hasHouse, HouseProblem } from '#lib/server/house.ts';
import { PASS_HOURS, readPrayerPass, signPrayerPass } from '#lib/server/prayer-pass.ts';
import { listLists, listPrayers, prayerAudioFile, prayerModeOn } from '#lib/server/prayers.ts';
import { prayerRemote, type HouseNow } from '#lib/prayers.ts';
import type { SnapcastState } from 'comun/music.ts';
import { readFile } from '#lib/server/storage.ts';

/** The family's kitchen for Oración's pages and actions (#339): not there while it is off. */
export async function prayerKitchen(locals: App.Locals) {
	const k = await kitchenOf(locals.user!.id);
	if (!(await prayerModeOn(k))) error(404, 'Oración no está encendida (Ajustes → Familia)');
	return k;
}

/** Oración's passes' own key, derived from BETTER_AUTH_SECRET (HKDF), as secret-box.ts's. */
const PASS_KEY = Buffer.from(hkdfSync('sha256', BETTER_AUTH_SECRET, 'nube', 'prayer pass', 32));

/**
 * Where the house opens a text's recording (#339, por Snapcast): Seilide's own address, with a
 * pass of the family's in its path, as mpv asks without a session. `audioKey` changes with each
 * recording, as the page's.
 */
export function passAudioUrls(familyId: string) {
	const token = signPrayerPass(PASS_KEY, {
		familyId,
		expires: Date.now() + PASS_HOURS * 3_600_000
	});
	return (id: number, audioKey: string) =>
		`${ORIGIN}/api/oracion/pase/${token}/audio/${id}?v=${audioKey}`;
}

/** The family's kitchen a pass is for; a 404 if it is not one, or Oración is off now. */
export async function passKitchen(token: string): Promise<Kitchen> {
	const pass = readPrayerPass(PASS_KEY, token);
	if (!pass) error(404, 'No encontrado');
	const k = houseKitchen(pass.familyId);
	if (!(await prayerModeOn(k))) error(404, 'No encontrado');
	return k;
}

/**
 * A text's recording, only to its family, with ranges, as the `<audio>` and mpv ask for them to go
 * to a point of it: without them, it cannot move along it. `?v=` (what it was recorded with)
 * changes with each recording, so it is kept a day.
 */
export async function prayerAudio(k: Kitchen, id: number, request: Request) {
	const file = await prayerAudioFile(k, id);
	const bytes = file ? await readFile(k.familyId, 'oracion', file) : null;
	if (!bytes) error(404, 'Sin voz');
	const headers = {
		'Content-Type': 'audio/ogg',
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, max-age=86400'
	};
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
	if (!range || (!range[1] && !range[2])) return new Response(bytes, { headers });
	const size = bytes.length;
	// «bytes=-500»: the last 500.
	const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
	const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
	if (start >= size || start > end)
		return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	return new Response(bytes.subarray(start, end + 1), {
		status: 206,
		headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}` }
	});
}

/**
 * A list in the whole house, on its Snapcast (#339): its recordings by the family's pass, sent to
 * the house in this person's name (a grown-up: the house refuses a child). How many texts were left
 * out without a voice; or why it could not, said for a person.
 */
export async function prayOnHouse(
	locals: App.Locals,
	listId: number
): Promise<{ missing: number } | { problem: string }> {
	const k = await prayerKitchen(locals);
	if (!(await hasHouse(locals.user!.id))) return { problem: 'Tu familia no tiene casa conectada' };
	const list = (await listLists(k)).find((l) => l.id === listId);
	if (!list) return { problem: 'Esa lista ya no está' };
	const { remote, missing } = prayerRemote(list, await listPrayers(k), passAudioUrls(k.familyId));
	if (!remote.items.length) return { problem: 'Ningún texto de la lista tiene voz todavía' };
	try {
		await askHouse(locals.user!.id, locals.user!.email, '/musica/snapcast', {
			method: 'POST',
			body: JSON.stringify({ action: 'remote', ...remote })
		});
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		return {
			problem: err.status === 404 ? 'Actualiza la casa para rezar en toda la casa' : err.message
		};
	}
	return { missing };
}

/** What the whole house plays, if it is Seilide's (a list sent from here); null, nothing of it. */
export async function houseNow(locals: App.Locals): Promise<HouseNow | null> {
	await prayerKitchen(locals);
	const { state } = await askHouse<{ state: SnapcastState }>(
		locals.user!.id,
		locals.user!.email,
		'/musica/snapcast'
	);
	const track = state.active ? state.track : null;
	if (!track?.src) return null;
	return {
		title: track.title,
		album: track.album,
		paused: state.paused,
		positionSec: state.positionSec,
		durationSec: state.durationSec,
		last: state.playlistPos !== null && state.playlistPos === state.playlistCount
	};
}

const CONTROLS: Record<string, object> = {
	pause: { action: 'pause', value: true },
	resume: { action: 'pause', value: false },
	next: { action: 'next' },
	previous: { action: 'previous' },
	stop: { action: 'stop' }
};

/**
 * A button of what plays in the house, or `seek` to `value` seconds; why not, said for a person, or
 * null.
 */
export async function controlHouse(locals: App.Locals, what: string, value?: unknown) {
	await prayerKitchen(locals);
	const body =
		what === 'seek'
			? typeof value === 'number' && value >= 0
				? { action: 'seekTo', value }
				: undefined
			: CONTROLS[what];
	if (!body) return 'Orden no válida';
	try {
		await askHouse(locals.user!.id, locals.user!.email, '/musica/snapcast', {
			method: 'POST',
			body: JSON.stringify(body)
		});
		return null;
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		return err.message;
	}
}
