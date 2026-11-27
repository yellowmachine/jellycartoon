/**
 * This device's key for the plugs (#643, phase 2): made here with WebCrypto (ECDSA P-256), its
 * private half not extractable, kept in this browser's IndexedDB with the satellites that took it.
 * Seilide never has it: it only carries what it signs to the satellite, which checks it.
 *
 * The same in the satellite (satellite/src/trust.ts): a key is known by the first 22 characters of
 * the base64url SHA-256 of its SPKI; a device is added with the code from the satellite's page,
 * `<secret>.<satellite's fingerprint>`, by a MAC over «alta|<its SPKI>|<its name>».
 */

export interface SatelliteTrust {
	fp: string;
	/** Its key, SPKI in base64url: its answers are checked with it. */
	spki: string;
	/** As the family calls it. */
	name: string;
	/** What this device is called there. */
	as: string;
}

interface Stored {
	pair: CryptoKeyPair;
	spki: string;
	fp: string;
	satellites: SatelliteTrust[];
}

const DB = 'seilide-enchufes';
const KEY = 'aparato';

function db(): Promise<IDBDatabase> {
	return new Promise((ok, ko) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore('kv');
		r.onsuccess = () => ok(r.result);
		r.onerror = () => ko(r.error);
	});
}

async function read(): Promise<Stored | null> {
	const d = await db();
	return new Promise((ok, ko) => {
		const r = d.transaction('kv').objectStore('kv').get(KEY);
		r.onsuccess = () => ok((r.result as Stored | undefined) ?? null);
		r.onerror = () => ko(r.error);
	});
}

async function write(s: Stored) {
	const d = await db();
	await new Promise<void>((ok, ko) => {
		const t = d.transaction('kv', 'readwrite');
		t.objectStore('kv').put(s, KEY);
		t.oncomplete = () => ok();
		t.onerror = () => ko(t.error);
	});
}

const b64 = (bytes: ArrayBuffer | Uint8Array) => {
	let text = '';
	for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b);
	return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (text: string) => {
	const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(plain, (c) => c.charCodeAt(0));
};
const utf8 = (text: string) => new TextEncoder().encode(text);

export async function fingerprint(spki: string) {
	return b64(await crypto.subtle.digest('SHA-256', unb64(spki))).slice(0, 22);
}

/** This device's key: made the first time. */
async function own(): Promise<Stored> {
	const saved = await read();
	if (saved) return saved;
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
		'sign',
		'verify'
	]);
	const spki = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
	const made = { pair, spki, fp: await fingerprint(spki), satellites: [] };
	await write(made);
	return made;
}

/** The satellites that took this device; none if it has no key or no IndexedDB. */
export async function trusted(): Promise<SatelliteTrust[]> {
	try {
		return (await read())?.satellites ?? [];
	} catch {
		return [];
	}
}

/** The code from the satellite's page, as pasted: its secret, and the satellite's fingerprint. */
export function parseCode(code: string) {
	const m = code.trim().match(/^([\w-]{22})\.([\w-]{22})$/);
	return m ? { secret: m[1]!, satellite: m[2]! } : null;
}

/** What goes to Seilide to give this device to the satellite: its key, its name, the MAC. */
export async function enrolRequest(code: string, name: string) {
	const parsed = parseCode(code);
	if (!parsed) return null;
	const me = await own();
	const key = await crypto.subtle.importKey(
		'raw',
		unb64(parsed.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = b64(await crypto.subtle.sign('HMAC', key, utf8(`alta|${me.spki}|${name}`)));
	return { publicKey: me.spki, name, mac, satellite: parsed.satellite };
}

/**
 * The satellite's answer, checked before trusting it: its key must be the one in the code, and its
 * signature must say this device was added. Kept then. False if it does not check.
 */
export async function acceptEnrolment(
	expected: string,
	answer: { fp: string; satellite: string; ack: string },
	names: { satellite: string; as: string }
) {
	const me = await own();
	if ((await fingerprint(answer.satellite)) !== expected || answer.fp !== me.fp) return false;
	const key = await crypto.subtle.importKey(
		'spki',
		unb64(answer.satellite),
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify']
	);
	const ok = await crypto.subtle.verify(
		{ name: 'ECDSA', hash: 'SHA-256' },
		key,
		unb64(answer.ack),
		utf8(`alta-ok|${me.fp}`)
	);
	if (!ok) return false;
	await write({
		...me,
		satellites: [
			...me.satellites.filter((s) => s.fp !== expected),
			{ fp: expected, spki: answer.satellite, name: names.satellite, as: names.as }
		]
	});
	return true;
}

/** Forgotten here: this device no longer signs for that satellite (it stays on its list there). */
export async function forget(satellite: string) {
	const me = await read();
	if (me) await write({ ...me, satellites: me.satellites.filter((s) => s.fp !== satellite) });
}

/**
 * An order for that plug, signed for its satellite: the exact JSON text and its signature, which
 * Seilide passes on as they are. Null if this device is not given to that satellite.
 */
export async function signOrder(
	satellite: string,
	plug: string,
	method: string,
	params?: Record<string, unknown>
) {
	const me = await read().catch(() => null);
	if (!me || !me.satellites.some((s) => s.fp === satellite)) return null;
	const nonce = b64(crypto.getRandomValues(new Uint8Array(12)));
	const envelope = JSON.stringify({
		v: 1,
		sat: satellite,
		dev: me.fp,
		plug,
		method,
		params,
		ts: Date.now(),
		nonce
	});
	const sig = b64(
		await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, me.pair.privateKey, utf8(envelope))
	);
	return { envelope, sig };
}

/** A switch of a plug through its satellite, signed if this device can: for the form's `signed`. */
export async function signedSwitch(
	p: { satellite: string | null; deviceId: string | null; relayed: boolean },
	on: boolean,
	backAfterS?: number
) {
	if (!p.relayed || !p.satellite || !p.deviceId) return null;
	const order = await signOrder(
		p.satellite,
		p.deviceId,
		'Switch.Set',
		backAfterS ? { id: 0, on, toggle_after: backAfterS } : { id: 0, on }
	);
	return order ? JSON.stringify(order) : null;
}
