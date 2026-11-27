import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from './relay.ts';
import { createTrust } from './trust.ts';

/**
 * The browser's side (Seilide's firma.ts) against the satellite's (trust.ts, relay.ts), #643: the
 * code pasted, the device added, its answer checked, and its orders let down. IndexedDB, a small
 * in-memory one: only what firma.ts uses of it.
 */

function memoryIndexedDb() {
	const kv = new Map<string, unknown>();
	const later = (fn: () => void) => queueMicrotask(fn);
	const db = {
		createObjectStore: () => {},
		transaction: () => {
			const t: Record<string, unknown> = {};
			t.objectStore = () => ({
				get(key: string) {
					const r: Record<string, unknown> = {};
					later(() => {
						r.result = structuredClone(kv.get(key));
						(r.onsuccess as () => void)();
					});
					return r;
				},
				put(value: unknown, key: string) {
					kv.set(key, value);
					later(() => (t.oncomplete as () => void)());
				}
			});
			return t;
		}
	};
	return {
		open() {
			const r: Record<string, unknown> = { result: db };
			later(() => {
				(r.onupgradeneeded as (() => void) | undefined)?.();
				(r.onsuccess as () => void)();
			});
			return r;
		}
	};
}

let firma: typeof import('../../nube/src/lib/enchufes/firma.ts');
beforeAll(async () => {
	(globalThis as Record<string, unknown>).indexedDB = memoryIndexedDb();
	firma = await import('../../nube/src/lib/enchufes/firma.ts');
});

const PLUG = 'shellyplugmg3-1';

describe('the device and the satellite, together', () => {
	test('the code pasted, the device added, its orders let down', async () => {
		const trust = createTrust(join(mkdtempSync(join(tmpdir(), 'firma-')), 'seguridad.json'));
		const code = trust.code(trust.openEnrolment());
		expect(firma.parseCode(code)).toEqual({ secret: expect.any(String), satellite: trust.fp });

		const request = (await firma.enrolRequest(code, 'Móvil'))!;
		const done = trust.enrol(request.publicKey, request.name, request.mac);
		if (!done.ok) throw new Error(done.why);
		// Seilide could change the answer on the way: checked against the code.
		expect(
			await firma.acceptEnrolment('otrahuellaaaaaaaaaaaaa', done, { satellite: 'X', as: 'Móvil' })
		).toBe(false);
		expect(
			await firma.acceptEnrolment(
				request.satellite,
				// Another first letter, always: «A» if it did not start with one.
				{ ...done, ack: done.ack.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) },
				{
					satellite: 'Dormitorio',
					as: 'Móvil'
				}
			)
		).toBe(false);
		expect(
			await firma.acceptEnrolment(request.satellite, done, { satellite: 'Dormitorio', as: 'Móvil' })
		).toBe(true);
		expect(await firma.trusted()).toMatchObject([
			{ fp: trust.fp, name: 'Dormitorio', as: 'Móvil' }
		]);

		const p = { relayed: true, satellite: trust.fp, deviceId: PLUG };
		const signed = JSON.parse((await firma.signedSwitch(p, true, 1800))!);
		const frame = JSON.stringify({
			id: 3,
			src: 'seilide',
			method: 'Satelite.Firmada',
			params: signed
		});
		const out = decide(frame, trust, PLUG);
		expect('toPlug' in out && JSON.parse(out.toPlug)).toMatchObject({
			method: 'Switch.Set',
			params: { id: 0, on: true, toggle_after: 1800 }
		});

		const permit = await firma.signOrder(trust.fp, PLUG, 'Satelite.Permiso', { auto: true });
		decide(
			JSON.stringify({ id: 4, src: 'seilide', method: 'Satelite.Firmada', params: permit }),
			trust,
			PLUG
		);
		expect(trust.auto(PLUG)).toBe(true);

		// Another satellite's plug: this device does not sign for it.
		expect(await firma.signedSwitch({ ...p, satellite: 'otra' }, true)).toBeNull();
	});
});

describe('a device that leaves (Satelite.Olvidar)', () => {
	test('only by its own signature, with no window open, and only once', async () => {
		const { doEnrolTask } = await import('./alta.ts');
		const trust = createTrust(join(mkdtempSync(join(tmpdir(), 'olvidar-')), 'seguridad.json'));
		const code = trust.code(trust.openEnrolment());
		const request = (await firma.enrolRequest(code, 'Oficina'))!;
		const done = trust.enrol(request.publicKey, request.name, request.mac);
		if (!done.ok) throw new Error(done.why);
		expect(
			await firma.acceptEnrolment(request.satellite, done, { satellite: 'D', as: 'Oficina' })
		).toBe(true);
		expect(trust.enrolment()).toBeNull();

		const ask = (envelope: string, sig: string) =>
			doEnrolTask({ id: 't', kind: 'olvidar', envelope, sig }, trust, () => 0)!;
		const order = (await firma.leaveOrder(trust.fp))!;
		// Another order, or for a plug, is not a leaving.
		const other = (await firma.signOrder(trust.fp, null, 'Switch.Set', { id: 0, on: true }))!;
		expect(ask(other.envelope, other.sig).problem).toBe('no se firma eso');
		const forPlug = (await firma.signOrder(trust.fp, PLUG, 'Satelite.Olvidar'))!;
		expect(ask(forPlug.envelope, forPlug.sig).problem).toBe('firmada para otro enchufe');
		const bad = (order.sig[0] === 'A' ? 'B' : 'A') + order.sig.slice(1);
		expect(ask(order.envelope, bad).problem).toBe('la firma no vale');
		expect(trust.devices()).toHaveLength(1);

		expect(ask(order.envelope, order.sig)).toEqual({ id: 't', forgotten: true });
		expect(trust.devices()).toHaveLength(0);
		expect(ask(order.envelope, order.sig).problem).toBe('el aparato no está dado de alta');
	});
});
