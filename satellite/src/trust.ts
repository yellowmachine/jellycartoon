import {
	createHash,
	createHmac,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	sign,
	timingSafeEqual,
	verify,
	type KeyObject
} from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Who may order the plugs (#643, phase 2): the devices given here, each with its own key, and
 * which plugs Seilide may switch by itself. All of it only here, in the satellite: a Seilide that is
 * broken into can neither add a device nor change a permission, because both need a device's
 * signature, and a device is only added with a code shown on the satellite's own page, in the
 * home's wifi.
 *
 * Keys are ECDSA P-256 with SHA-256, signatures in their raw form (r‖s, 64 bytes): what WebCrypto
 * makes in the browser. A key is known by its fingerprint: the first 22 characters of the base64url
 * SHA-256 of its SPKI (132 bits).
 */

export interface Device {
	fp: string;
	name: string;
	/** Its public key, SPKI in base64url. */
	spki: string;
	addedAt: string;
}

interface Saved {
	/** The satellite's own: PKCS#8 PEM, and its SPKI in base64url. */
	key: { pem: string; spki: string };
	devices: Device[];
	/** By the Shelly's id: Seilide may switch it by itself (its schedules, rules, the voice). */
	auto: Record<string, boolean>;
	/** By the Shelly's id: the schedule jobs the satellite made on it (Satelite.Horarios). */
	jobs?: Record<string, number[]>;
}

/** How long the window that «añade un aparato» opens lasts. */
export const ENROLL_MS = 5 * 60_000;
/** An order older or newer than this, by the satellite's clock: not taken. */
export const ORDER_SKEW_MS = 2 * 60_000;
/** For `check`: an order about the satellite, not a plug. */
export const ANY_PLUG = Symbol('ningún enchufe');
const MAX_DEVICES = 50;
const MAX_NAME = 40;

export const fingerprint = (spki: string) =>
	createHash('sha256').update(Buffer.from(spki, 'base64url')).digest('base64url').slice(0, 22);

const keyOf = (spki: string) =>
	createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' });

const verifies = (key: KeyObject, data: string, sig: string) => {
	try {
		return verify(
			'sha256',
			Buffer.from(data),
			{ key, dsaEncoding: 'ieee-p1363' },
			Buffer.from(sig, 'base64url')
		);
	} catch {
		return false;
	}
};

/** The text a device signs to be added: its key and its name, with the code's secret. */
export const enrollText = (spki: string, name: string) => `alta|${spki}|${name}`;
/** What the satellite signs back: that device, added by it. */
export const enrolledText = (deviceFp: string) => `alta-ok|${deviceFp}`;

/** A signed order, as the device wrote it (the exact JSON text it signed). */
export interface Envelope {
	v: 1;
	/** The satellite it is for. */
	sat: string;
	/** The device that signs it. */
	dev: string;
	/** The Shelly it is for; null, about the satellite itself (`Satelite.Olvidar`). */
	plug: string | null;
	method: string;
	params?: Record<string, unknown>;
	/** When it was made, in ms. */
	ts: number;
	nonce: string;
}

export type Opened =
	{ ok: true; enrolment: { secret: string; until: number } } | { ok: false; why: string };

export function createTrust(file: string, now: () => number = Date.now) {
	let saved: Saved = load();
	const privateKey = createPrivateKey(saved.key.pem);
	const ownFp = fingerprint(saved.key.spki);
	let window: { secret: string; until: number } | null = null;
	/** Nonces seen, by when they stop counting: an order is taken once. */
	const seen = new Map<string, number>();

	function load(): Saved {
		try {
			const s = JSON.parse(readFileSync(file, 'utf8')) as Saved;
			if (s?.key?.pem && s.key.spki && Array.isArray(s.devices))
				return { key: s.key, devices: s.devices, auto: s.auto ?? {}, jobs: s.jobs ?? {} };
		} catch {
			// None yet: made now.
		}
		const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		const made: Saved = {
			key: {
				pem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
				spki: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')
			},
			devices: [],
			auto: {}
		};
		write(made);
		return made;
	}

	function write(s: Saved) {
		mkdirSync(dirname(file), { recursive: true });
		// Whole or not at all: a cut while writing must not lose the devices.
		writeFileSync(`${file}.nuevo`, JSON.stringify(s), { mode: 0o600 });
		renameSync(`${file}.nuevo`, file);
	}

	const save = (change: (s: Saved) => Saved) => {
		saved = change(saved);
		write(saved);
	};

	const open = () => (window && window.until > now() ? window : null);

	return {
		fp: ownFp,
		spki: saved.key.spki,
		devices: () => saved.devices,
		auto: (shellyId: string) => saved.auto[shellyId] === true,
		/** The window, opened (a new code) for ENROLL_MS. */
		openEnrolment() {
			window = { secret: randomBytes(16).toString('base64url'), until: now() + ENROLL_MS };
			return window;
		},
		enrolment: open,
		/** What the device pastes: the secret, and the satellite's fingerprint to check its answer. */
		code: (w: { secret: string }) => `${w.secret}.${ownFp}`,
		/**
		 * A device added: only while the window is open, with a MAC made with its code, once. Its
		 * name is the device's. What it gets back, signed by the satellite, says it was added here.
		 */
		enrol(spki: string, name: string, mac: string) {
			const w = open();
			if (!w) return { ok: false as const, why: 'El alta está cerrada: di «añade un aparato»' };
			const clean = name.trim().slice(0, MAX_NAME) || 'Aparato';
			const want = createHmac('sha256', Buffer.from(w.secret, 'base64url'))
				.update(enrollText(spki, name))
				.digest();
			const got = Buffer.from(mac, 'base64url');
			if (got.length !== want.length || !timingSafeEqual(got, want))
				return { ok: false as const, why: 'El código no vale: cópialo otra vez' };
			let fp: string;
			try {
				const key = keyOf(spki);
				if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
					throw new Error('curve');
				fp = fingerprint(spki);
			} catch {
				return { ok: false as const, why: 'La clave del aparato no vale' };
			}
			if (saved.devices.length >= MAX_DEVICES && !saved.devices.some((d) => d.fp === fp))
				return { ok: false as const, why: 'Demasiados aparatos: quita alguno' };
			window = null;
			save((s) => ({
				...s,
				devices: [
					...s.devices.filter((d) => d.fp !== fp),
					{ fp, name: clean, spki, addedAt: new Date(now()).toISOString() }
				]
			}));
			const ack = sign('sha256', Buffer.from(enrolledText(fp)), {
				key: privateKey,
				dsaEncoding: 'ieee-p1363'
			}).toString('base64url');
			return { ok: true as const, fp, satellite: saved.key.spki, ack };
		},
		/** Only while the window is open: whoever opened it is in the room. */
		remove(fp: string) {
			if (!open()) return false;
			save((s) => ({ ...s, devices: s.devices.filter((d) => d.fp !== fp) }));
			return true;
		},
		/** A device that asked itself to leave, signed: no window needed, only it can. */
		leave(fp: string) {
			save((s) => ({ ...s, devices: s.devices.filter((d) => d.fp !== fp) }));
		},
		setAuto(shellyId: string, on: boolean) {
			save((s) => ({ ...s, auto: { ...s.auto, [shellyId]: on } }));
		},
		jobsOf: (shellyId: string) => saved.jobs?.[shellyId] ?? [],
		setJobs(shellyId: string, ids: number[]) {
			save((s) => ({ ...s, jobs: { ...s.jobs, [shellyId]: ids } }));
		},
		/**
		 * A signed order for that plug, checked: by a device given here, for this satellite and this
		 * plug, recent, not seen before. Its method and parameters, to be checked against what is
		 * allowed.
		 */
		/**
		 * A device's signed order: for that plug, or, with `ANY_PLUG`, about the satellite itself
		 * (`Satelite.Olvidar`), which names no plug.
		 */
		check(
			text: string,
			sig: string,
			shellyId: string | null | typeof ANY_PLUG,
			/**
			 * False for a whole state, the plug rules (#651): it may come late (the satellite was off),
			 * so neither its time nor its nonce count; what guards it is its version, which only goes up.
			 */
			{ fresh = true }: { fresh?: boolean } = {}
		) {
			let e: Envelope;
			try {
				e = JSON.parse(text) as Envelope;
			} catch {
				return { ok: false as const, why: 'orden firmada sin sentido' };
			}
			if (!e || e.v !== 1 || typeof e.method !== 'string' || typeof e.nonce !== 'string')
				return { ok: false as const, why: 'orden firmada sin sentido' };
			if (e.sat !== ownFp) return { ok: false as const, why: 'firmada para otro satélite' };
			if (shellyId === ANY_PLUG ? e.plug !== null : !shellyId || e.plug !== shellyId)
				return { ok: false as const, why: 'firmada para otro enchufe' };
			const device = saved.devices.find((d) => d.fp === e.dev);
			if (!device) return { ok: false as const, why: 'el aparato no está dado de alta' };
			const at = now();
			if (fresh) {
				if (typeof e.ts !== 'number' || Math.abs(at - e.ts) > ORDER_SKEW_MS)
					return { ok: false as const, why: 'orden caducada: mira la hora del aparato' };
				for (const [n, until] of seen) if (until < at) seen.delete(n);
				if (seen.has(e.nonce)) return { ok: false as const, why: 'orden repetida' };
			}
			if (!verifies(keyOf(device.spki), text, sig))
				return { ok: false as const, why: 'la firma no vale' };
			if (fresh) seen.set(e.nonce, at + 2 * ORDER_SKEW_MS);
			return {
				ok: true as const,
				method: e.method,
				params: e.params,
				device: device.name,
				fp: device.fp
			};
		}
	};
}

export type Trust = ReturnType<typeof createTrust>;
