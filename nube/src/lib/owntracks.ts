/**
 * OwnTracks (#593): what its app sends in HTTP mode, read; and the link that configures it with one
 * touch. As its booklet says (owntracks.org/booklet: tech/http, tech/json, features/remoteconfig).
 */

/** Where it posts, on Seilide. */
export const OWNTRACKS_PATH = '/api/owntracks';

/** Kept this long (phase 3 forgets the older ones); older ones that arrive late are not kept. */
export const KEEP_DAYS = 90;

export interface OwntracksPoint {
	at: Date;
	lon: number;
	lat: number;
	accuracy: number | null;
	speed: number | null;
	altitude: number | null;
	battery: number | null;
	device: string | null;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A whole number in its range, or null: what the phone did not send or sent wrong. */
const whole = (v: unknown, min: number, max: number) =>
	isNumber(v) && v >= min && v <= max ? Math.round(v) : null;
/** «myphone», «owntracks/ana/myphone»'s last part, short and printable. */
const deviceName = (v: unknown) =>
	typeof v === 'string' && v.trim()
		? v
				.trim()
				.slice(0, 40)
				.replace(/[^\p{L}\p{N} ._-]/gu, '') || null
		: null;

/**
 * One `location` message, or null for anything else (`lwt`, `transition`, a friend deleted…) or a
 * position that makes no sense: out of the world, from the future, or older than what is kept.
 * `device`, the `X-Limit-D` header, when the app sends it.
 */
export function parseLocation(
	body: unknown,
	device: string | null = null,
	now = Date.now()
): OwntracksPoint | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const m = body as Record<string, unknown>;
	if (m._type !== 'location') return null;
	const { lat, lon, tst } = m;
	if (!isNumber(lat) || !isNumber(lon) || !isNumber(tst)) return null;
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	const at = Math.round(tst) * 1000;
	if (at > now + 60 * 60 * 1000 || at < now - KEEP_DAYS * 24 * 60 * 60 * 1000) return null;
	const topicDevice = typeof m.topic === 'string' ? m.topic.split('/').at(-1) : null;
	return {
		at: new Date(at),
		lon,
		lat,
		accuracy: whole(m.acc, 0, 100_000),
		speed: whole(m.vel, 0, 2000),
		altitude: whole(m.alt, -1000, 10_000),
		battery: whole(m.batt, 0, 100),
		device: deviceName(device) ?? deviceName(topicDevice) ?? deviceName(m.tid)
	};
}

/** The password of a Basic `Authorization` header, or null. */
export function basicPassword(header: string | null): string | null {
	const match = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
	if (!match) return null;
	let decoded: string;
	try {
		decoded = atob(match[1]!);
	} catch {
		return null;
	}
	const colon = decoded.indexOf(':');
	return colon < 0 ? null : decoded.slice(colon + 1);
}

/** «Ana López» → «AL», «ana» → «AN»: the two letters OwnTracks shows for a person (`tid`). */
export function trackerId(name: string) {
	const letters = name
		.normalize('NFD')
		.replace(/[^\p{L}\p{N} ]/gu, '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const two =
		letters.length > 1 ? letters[0]![0]! + letters[1]![0]! : (letters[0] ?? 'yo').slice(0, 2);
	return two.toUpperCase().padEnd(2, 'X');
}

/**
 * Its configuration: HTTP mode to Seilide, with the person's password, and *Significant*
 * monitoring (a position every 500 m and 15 min at most, little battery); *Move* (every 15 s) is
 * chosen in the app for a walk. With its places as regions (phase 4).
 */
export function owntracksConfig({
	origin,
	password,
	name,
	regions = []
}: {
	origin: string;
	password: string;
	name: string;
	/** Its places (phase 4): the phone tells when it arrives or leaves. */
	regions?: OwntracksRegion[];
}) {
	return {
		_type: 'configuration',
		mode: 3,
		url: origin + OWNTRACKS_PATH,
		auth: true,
		username: 'seilide',
		password,
		tid: trackerId(name),
		monitoring: 1,
		locatorDisplacement: 500,
		locatorInterval: 900,
		moveModeLocatorInterval: 15,
		// Without it the phone hands over a position every second while another app (Maps) asks for
		// the GPS: no faster than the interval.
		pegLocatorFastestIntervalToInterval: true,
		waypoints: regions.map(regionWaypoint)
	};
}

/**
 * The link that configures it: `owntracks:///config?inline=` with the configuration in base64.
 * Encoded for the address, as `+` would otherwise be read as a space.
 */
export function owntracksLink(config: ReturnType<typeof owntracksConfig>) {
	const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(config))));
	return `owntracks:///config?inline=${encodeURIComponent(base64)}`;
}

/** Each place's radius on the phone (#593, phase 4): enough for the GPS indoors, not the street. */
export const REGION_RADIUS = 150;

/**
 * A place the phone watches (#593): OwnTracks tells when it arrives or leaves (`transition`).
 * `rid` and `tst` stay the same for the same place, link after link: the app knows it by them.
 */
export interface OwntracksRegion {
	rid: string;
	desc: string;
	lat: number;
	lon: number;
}

/** A fixed moment, so each place's `tst` is always the same (Android keys regions on it). */
const REGION_EPOCH = 1_700_000_000;

/** «casa» → its waypoint; «sitio-12» → REGION_EPOCH + 12, as owntracks.org/booklet/tech/json says. */
export const regionWaypoint = (r: OwntracksRegion) => ({
	_type: 'waypoint',
	desc: r.desc,
	lat: r.lat,
	lon: r.lon,
	rad: REGION_RADIUS,
	rid: r.rid,
	tst: REGION_EPOCH + (Number(r.rid.match(/\d+$/)?.[0]) || 0)
});

export interface OwntracksTransition {
	at: Date;
	place: string;
	moment: 'llega' | 'sale';
}

/**
 * One `transition` message (phase 4): arriving (`enter`) at or leaving (`leave`) a region, by its
 * name (`desc`); null for anything else. Old ones that come late are kept as the positions are.
 */
export function parseTransition(body: unknown, now = Date.now()): OwntracksTransition | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
	const m = body as Record<string, unknown>;
	if (m._type !== 'transition' || (m.event !== 'enter' && m.event !== 'leave')) return null;
	if (!isNumber(m.tst) || typeof m.desc !== 'string' || !m.desc.trim()) return null;
	const at = Math.round(m.tst) * 1000;
	if (at > now + 60 * 60 * 1000 || at < now - KEEP_DAYS * 24 * 60 * 60 * 1000) return null;
	return {
		at: new Date(at),
		place: m.desc.trim().slice(0, 80),
		moment: m.event === 'enter' ? 'llega' : 'sale'
	};
}
