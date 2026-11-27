import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SatelliteRule } from '../../packages/comun/src/plug-rules.ts';
import { createRules } from './rules.ts';
import { createTrust, enrollText, fingerprint } from './trust.ts';

const PLUG = 'shellyplugmg3-1';
const OTHER = 'shellyplugmg3-2';
const b64 = (b: ArrayBuffer) => Buffer.from(b).toString('base64url');
const dir = () => mkdtempSync(join(tmpdir(), 'reglas-'));

async function setup() {
	const d = dir();
	const trust = createTrust(join(d, 'seguridad.json'));
	const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
		'sign',
		'verify'
	]);
	const spki = b64(await crypto.subtle.exportKey('spki', pair.publicKey));
	const w = trust.openEnrolment();
	const key = await crypto.subtle.importKey(
		'raw',
		Buffer.from(trust.code(w).split('.')[0]!, 'base64url'),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const mac = b64(
		await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(enrollText(spki, 'Móvil')))
	);
	if (!trust.enrol(spki, 'Móvil', mac).ok) throw new Error('alta');
	let ago = Infinity;
	const rules = createRules({
		file: join(d, 'reglas.json'),
		trust,
		orderAgo: () => ago,
		ownPlug: (id) => id === PLUG,
		log: () => {}
	});
	/** As the device's firma.ts signs it: the whole list, about the satellite. */
	async function sign(version: number, list: SatelliteRule[], over: Record<string, unknown> = {}) {
		const envelope = JSON.stringify({
			v: 1,
			sat: trust.fp,
			dev: fingerprint(spki),
			plug: null,
			method: 'Satelite.Reglas',
			params: { version, rules: list },
			ts: Date.now() - 3_600_000,
			nonce: 'n',
			...over
		});
		const sig = b64(
			await crypto.subtle.sign(
				{ name: 'ECDSA', hash: 'SHA-256' },
				pair.privateKey,
				new TextEncoder().encode(envelope)
			)
		);
		return { version, rules: list, envelope, sig };
	}
	return { d, trust, rules, sign, heard: (ms: number) => (ago = ms) };
}

const termo = (over: Partial<SatelliteRule> = {}): SatelliteRule => ({
	id: 1,
	when: { kind: 'cada_dia', time: '22:00' },
	plug: PLUG,
	on: false,
	minutes: null,
	once: false,
	...over
});

describe('las reglas de enchufes del satélite (#651, fase 2)', () => {
	test('firmadas por un aparato dado de alta: se guardan, aunque lleguen tarde', async () => {
		const { d, trust, rules, sign } = await setup();
		// Signed an hour ago (the satellite was off): its version guards it, not its time.
		expect(rules.offer(await sign(1, [termo()]))).toEqual({ taken: true });
		expect(rules.version()).toBe(1);
		// Kept across a restart.
		const again = createRules({
			file: join(d, 'reglas.json'),
			trust,
			orderAgo: () => Infinity,
			ownPlug: () => false,
			log: () => {}
		});
		expect(again.rules()).toEqual([termo()]);
	});

	test('nunca una versión igual o más antigua, aunque esté firmada', async () => {
		const { rules, sign } = await setup();
		const old = await sign(1, [termo()]);
		rules.offer(await sign(2, [termo({ on: true })]));
		expect(rules.offer(old)).toEqual({ taken: false });
		expect(rules.rules()[0]!.on).toBe(true);
	});

	test('firma de otro, para otro satélite o con otra cosa: no', async () => {
		const { rules, sign } = await setup();
		const bad = await sign(1, [termo()]);
		expect(
			rules.offer({ ...bad, sig: bad.sig.replace(/^./, bad.sig[0] === 'A' ? 'B' : 'A') }).taken
		).toBe(false);
		expect(rules.offer(await sign(1, [termo()], { sat: 'otro-satelite-xxxxxxxx' })).why).toBe(
			'firmada para otro satélite'
		);
		expect(rules.offer(await sign(1, [termo()], { method: 'Switch.Set' })).why).toBe(
			'no son reglas'
		);
		expect(rules.offer(await sign(1, [termo({ minutes: 9999 })])).why).toBe('reglas sin sentido');
	});

	test('dichas al satélite: sin firma solo justo después de oír una orden él mismo', async () => {
		const { rules, heard } = await setup();
		const unsigned = { version: 1, rules: [termo()] };
		heard(10 * 60_000);
		expect(rules.offer(unsigned).why).toBe('sin firmar y sin una orden oída aquí');
		heard(20_000);
		expect(rules.offer(unsigned)).toEqual({ taken: true });
	});

	test('sin firma: añadir y quitar, pero no cambiar una regla ni tocar enchufes de otro', async () => {
		const { rules, sign, heard } = await setup();
		rules.offer(await sign(1, [termo()]));
		heard(5_000);
		expect(rules.offer({ version: 2, rules: [termo({ on: true })] }).taken).toBe(false);
		expect(rules.offer({ version: 2, rules: [termo(), termo({ id: 2, plug: OTHER })] }).taken).toBe(
			false
		);
		expect(
			rules.offer({
				version: 2,
				rules: [
					termo(),
					termo({ id: 2, when: { kind: 'enchufe', plugs: [PLUG], moment: 'termina' } })
				]
			}).taken
		).toBe(true);
		expect(rules.offer({ version: 3, rules: [] }).taken).toBe(true);
		expect(rules.rules()).toEqual([]);
	});

	test('un encargo hecho por él mismo sale de la lista sin firma; uno que no hizo, no', async () => {
		const { rules, sign } = await setup();
		const errand = termo({
			id: 3,
			when: { kind: 'en_fecha', day: '2026-11-28', time: '09:00' },
			once: true
		});
		rules.offer(await sign(1, [termo(), errand]));
		expect(rules.offer({ version: 2, rules: [termo()] }).taken).toBe(false);
		rules.markDone(3, '2026-11-28 09:00');
		expect(rules.offer({ version: 2, rules: [termo()] }).taken).toBe(true);
		// But never one that is not an errand.
		expect(rules.offer({ version: 3, rules: [] }).taken).toBe(false);
	});
});
