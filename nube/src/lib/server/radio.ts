import { resolveSrv } from 'node:dns/promises';
import { STATIONS, type RadioStationInfo, type RadioStream } from '#lib/radio.ts';

/**
 * Radio Browser's public API (https://api.radio-browser.info): its servers come from a DNS SRV
 * record, in random order, trying the next one when one fails. No key needed.
 */

const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';
/** If the SRV lookup fails. */
const FALLBACK_SERVER = 'de1.api.radio-browser.info';

interface Station {
	stationuuid: string;
	url: string;
	url_resolved: string;
	favicon: string;
	hls: number;
	lastcheckok: number;
}

let servers: Promise<string[]> | null = null;

function getServers() {
	servers ??= resolveSrv('_api._tcp.radio-browser.info')
		.then((records) => records.map((r) => r.name).sort(() => Math.random() - 0.5))
		.catch(() => [FALLBACK_SERVER])
		.then((names) => (names.length ? names : [FALLBACK_SERVER]));
	return servers;
}

async function api<T>(path: string): Promise<T> {
	let lastError: unknown;
	for (const server of await getServers()) {
		try {
			const res = await fetch(`https://${server}${path}`, {
				headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
				signal: AbortSignal.timeout(10_000)
			});
			if (!res.ok) throw new Error(`Radio Browser respondió ${res.status}`);
			return (await res.json()) as T;
		} catch (error) {
			lastError = error;
		}
	}
	// Every server failed: they are looked up again next time.
	servers = null;
	throw lastError;
}

const byUuid = (uuids: string[]) =>
	api<Station[]>(`/json/stations/byuuid?uuids=${uuids.join(',')}`);

const CACHE_MS = 60 * 60_000;
let cached: { at: number; info: Record<string, RadioStationInfo> } | null = null;

/** Logos and whether each station worked last time Radio Browser checked; an hour old at most. */
export async function stationsInfo(): Promise<Record<string, RadioStationInfo> | null> {
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.info;
	try {
		const stations = await byUuid(STATIONS.map((s) => s.uuid));
		const info = Object.fromEntries(
			stations.map((s) => [
				s.stationuuid,
				{ favicon: s.favicon || null, ok: s.lastcheckok === 1, hls: s.hls === 1 }
			])
		);
		cached = { at: Date.now(), info };
		return info;
	} catch (error) {
		console.warn('[radio] No se pudo consultar Radio Browser', error);
		return cached?.info ?? null;
	}
}

/**
 * Where the station's stream is now. Also counts the click, as Radio Browser asks every client to
 * do (`/json/url`): it is how it knows which stations are listened to.
 */
export async function streamFor(uuid: string): Promise<RadioStream | null> {
	const station = STATIONS.find((s) => s.uuid === uuid);
	if (!station) return null;
	const [found] = await byUuid([uuid]);
	if (!found?.url_resolved) return null;
	// The station's own link, which may redirect with a fresh token each time (RTVE's dispatcher);
	// the resolved one only when the link is a playlist file the browser cannot open.
	const playlistFile = /\.(pls|m3u|asx|xspf)(\?|$)/i.test(found.url);
	const url = found.url && !playlistFile ? found.url : found.url_resolved;
	void api(`/json/url/${uuid}`).catch(() => {});
	return {
		uuid,
		name: station.name,
		country: station.country,
		favicon: found.favicon || null,
		url,
		hls: found.hls === 1
	};
}
