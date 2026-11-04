import { describe, expect, test } from 'bun:test';
import { envelope, isEnveloped, type KeyStore, type Kms } from './envelope.ts';

/**
 * Envelope encryption (#326) with a fake KMS: it "wraps" by prefixing the family (so that one bound
 * to another family is refused, as Key Manager's associated data does) and counts its calls.
 */
function fakes() {
	const calls = { wrap: 0, unwrap: 0 };
	let down = false;
	const kms: Kms = {
		async wrap(key, familyId) {
			calls.wrap++;
			if (down) throw new Error('KMS caído');
			return `${familyId}:${key.toString('base64')}`;
		},
		async unwrap(wrapped, familyId) {
			calls.unwrap++;
			if (down) throw new Error('KMS caído');
			const [owner, key] = wrapped.split(':');
			if (owner !== familyId) throw new Error('Otra familia');
			return Buffer.from(key!, 'base64');
		}
	};
	const kept = new Map<string, string>();
	const store: KeyStore = {
		get: async (familyId) => kept.get(familyId) ?? null,
		async put(familyId, wrapped) {
			if (!kept.has(familyId)) kept.set(familyId, wrapped);
			return kept.get(familyId)!;
		}
	};
	let clock = 0;
	const box = envelope({ kms, store, cacheMs: 1000, now: () => clock });
	return {
		box,
		calls,
		kept,
		kms,
		store,
		later: (ms: number) => (clock += ms),
		fail: (on: boolean) => (down = on)
	};
}

describe('envelope', () => {
	test('kept and read back, with its prefix, never the text itself', async () => {
		const { box } = fakes();
		const sealed = await box.seal('A', 'sk-or-secreta');
		expect(isEnveloped(sealed)).toBe(true);
		expect(sealed).not.toContain('secreta');
		expect(await box.open('A', sealed)).toBe('sk-or-secreta');
	});

	test('one data key per family, made once and kept only wrapped', async () => {
		const { box, kept, calls } = fakes();
		await box.seal('A', 'uno');
		await box.seal('A', 'dos');
		await box.seal('B', 'tres');
		expect(calls.wrap).toBe(2);
		// Each one unwrapped once, to check it, before it was kept.
		expect(calls.unwrap).toBe(2);
		expect([...kept.keys()].sort()).toEqual(['A', 'B']);
	});

	test('in memory a while: the KMS asked again only after it', async () => {
		const { box, calls, later } = fakes();
		const sealed = await box.seal('A', 'clave');
		box.forget();
		calls.unwrap = 0;
		await box.open('A', sealed);
		await box.open('A', sealed);
		expect(calls.unwrap).toBe(1);
		later(1001);
		await box.open('A', sealed);
		expect(calls.unwrap).toBe(2);
	});

	test('many at once: one question to the KMS', async () => {
		const { box, calls } = fakes();
		const sealed = await box.seal('A', 'clave');
		box.forget();
		calls.unwrap = 0;
		await Promise.all([1, 2, 3, 4].map(() => box.open('A', sealed)));
		expect(calls.unwrap).toBe(1);
	});

	test('bound to its family: another family cannot read it', async () => {
		const { box } = fakes();
		await box.seal('B', 'de B');
		const sealed = await box.seal('A', 'de A');
		expect(await box.open('B', sealed)).toBeNull();
	});

	test('a family without a key yet: nothing to read, and none made by reading', async () => {
		const { box, kept } = fakes();
		expect(await box.open('A', 'kms1.x.y.z')).toBeNull();
		expect(kept.size).toBe(0);
	});

	test('two servers making it at once: both use the one kept', async () => {
		const first = fakes();
		const second = envelope({ kms: first.kms, store: first.store });
		const [a, b] = await Promise.all([first.box.seal('A', 'uno'), second.seal('A', 'dos')]);
		expect(await second.open('A', a)).toBe('uno');
		expect(await first.box.open('A', b)).toBe('dos');
	});

	test('a KMS that wraps but cannot unwrap: nothing kept, and it fails', async () => {
		const { box, kms, kept } = fakes();
		kms.unwrap = async () => Buffer.alloc(32);
		await expect(box.seal('A', 'clave')).rejects.toThrow('no devuelve la clave');
		expect(kept.size).toBe(0);
	});

	test('the KMS down and nothing in memory: it fails, not «no key»', async () => {
		const { box, fail } = fakes();
		const sealed = await box.seal('A', 'clave');
		box.forget();
		fail(true);
		await expect(box.open('A', sealed)).rejects.toThrow('KMS caído');
		fail(false);
		expect(await box.open('A', sealed)).toBe('clave');
	});
});

describe('files', () => {
	const file = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255, 1, 2, 3]);

	test('read back as they were, and not readable as kept', async () => {
		const { box } = fakes();
		const sealed = await box.sealBytes('A', file);
		expect(Buffer.from(sealed).includes(Buffer.from(file))).toBe(false);
		expect(await box.openBytes('A', sealed)).toEqual(file);
	});

	test('each time different', async () => {
		const { box } = fakes();
		expect(await box.sealBytes('A', file)).not.toEqual(await box.sealBytes('A', file));
	});

	test("changed, cut or another family's: null, never garbage", async () => {
		const { box } = fakes();
		const sealed = await box.sealBytes('A', file);
		const changed = sealed.slice();
		changed[changed.length - 1]! ^= 1;
		expect(await box.openBytes('A', changed)).toBeNull();
		expect(await box.openBytes('A', sealed.slice(0, 10))).toBeNull();
		await box.sealBytes('B', file);
		expect(await box.openBytes('B', sealed)).toBeNull();
	});

	test('a family without a key: null', async () => {
		const { box } = fakes();
		expect(await box.openBytes('A', new Uint8Array(40))).toBeNull();
	});
});
