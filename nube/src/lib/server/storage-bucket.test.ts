import { describe, expect, test } from 'bun:test';
import {
	bucketFrom,
	bucketProblem,
	copyFiles,
	endpointProblem,
	folderOf,
	isPrivateAddress,
	labelOf,
	type Side
} from './storage-bucket.ts';

/** A family's own storage (#480, phase 2): what it writes, the addresses, the copy. */

const form = (values: Record<string, string>) => ({ get: (k: string) => values[k] ?? null });
const good = {
	endpoint: 'https://abc.r2.cloudflarestorage.com/',
	bucket: 'fotos-casa',
	accessKeyId: 'AK',
	secretAccessKey: 'SK'
};

describe('the bucket as written', () => {
	test('with its defaults', () => {
		expect(bucketFrom(form(good))).toEqual({
			endpoint: 'https://abc.r2.cloudflarestorage.com',
			region: 'auto',
			bucket: 'fotos-casa',
			prefix: 'seilide/',
			accessKeyId: 'AK',
			secretAccessKey: 'SK'
		});
		expect(labelOf(bucketFrom(form(good)) as never)).toBe(
			'abc.r2.cloudflarestorage.com · fotos-casa · seilide/'
		);
	});

	test('what is wrong with it', () => {
		expect(bucketFrom(form({ ...good, endpoint: 'nada' }))).toHaveProperty('problem');
		expect(bucketFrom(form({ ...good, bucket: 'Mi Bucket' }))).toHaveProperty('problem');
		expect(bucketFrom(form({ ...good, prefix: '../otra' }))).toHaveProperty('problem');
		expect(bucketFrom(form({ ...good, secretAccessKey: '' }))).toHaveProperty('problem');
	});

	test('the folder', () => {
		expect(folderOf('/casa//seilide/')).toBe('casa/seilide/');
		expect(folderOf('')).toBe('');
		expect(folderOf('a/../b')).toBeNull();
		expect(folderOf('con espacio')).toBeNull();
	});
});

describe('the addresses Seilide may reach', () => {
	test('private ones, never', () => {
		for (const ip of [
			'127.0.0.1',
			'10.1.2.3',
			'172.20.0.5',
			'192.168.1.56',
			'169.254.169.254',
			'100.64.0.1',
			'0.0.0.0',
			'::1',
			'fd00::1',
			'fe80::1',
			'::ffff:10.0.0.1'
		])
			expect({ ip, private: isPrivateAddress(ip) }).toEqual({ ip, private: true });
		for (const ip of ['104.18.1.1', '8.8.8.8', '2606:4700::1'])
			expect({ ip, private: isPrivateAddress(ip) }).toEqual({ ip, private: false });
	});

	const resolves =
		(...addresses: string[]) =>
		async () =>
			addresses.map((address) => ({ address }));

	test('https, a public name, and all it resolves to public', async () => {
		expect(await endpointProblem('https://s3.example.com', resolves('8.8.8.8'))).toBeNull();
		expect(await endpointProblem('http://s3.example.com', resolves('8.8.8.8'))).toContain('https');
		expect(await endpointProblem('https://nube-rustfs:9000', resolves('8.8.8.8'))).not.toBeNull();
		expect(await endpointProblem('https://casa.local', resolves('8.8.8.8'))).not.toBeNull();
		expect(await endpointProblem('https://10.0.0.1', resolves())).not.toBeNull();
		expect(
			await endpointProblem('https://trampa.example.com', resolves('8.8.8.8', '127.0.0.1'))
		).not.toBeNull();
		expect(
			await endpointProblem('https://nada.example.com', async () => {
				throw new Error('ENOTFOUND');
			})
		).toContain('No se encuentra');
	});

	test('in development, its own rustfs', async () => {
		expect(
			await endpointProblem('http://127.0.0.1:19000', resolves(), { allowPrivate: true })
		).toBeNull();
	});
});

test('S3 errors, as the family reads them', () => {
	expect(bucketProblem({ name: 'InvalidAccessKeyId' })).toContain('claves');
	expect(bucketProblem({ name: 'NoSuchBucket' })).toBe('Ese bucket no existe');
	expect(bucketProblem({ name: 'x', $metadata: { httpStatusCode: 403 } })).toContain('permiso');
});

/** A storage in memory; `failing`, the names it refuses to keep. */
function memory(failing = new Set<string>()) {
	const files = new Map<string, Uint8Array<ArrayBuffer>>();
	let puts = 0;
	const side: Side = {
		size: async (a, n) => files.get(`${a}/${n}`)?.length ?? null,
		get: async (a, n) => files.get(`${a}/${n}`) ?? null,
		put: async (a, n, body) => {
			if (failing.has(n)) throw Object.assign(new Error('no'), { name: 'AccessDenied' });
			puts++;
			files.set(`${a}/${n}`, new Uint8Array(body));
		}
	};
	return { side, files, puts: () => puts };
}

const bytes = (n: number) => new Uint8Array(n);
const noWait = async () => {};

describe('the copy', () => {
	test('what is missing goes; what is there, the same size, does not', async () => {
		const from = memory();
		const to = memory();
		from.files.set('fotos/a.jpg', bytes(10));
		from.files.set('fotos/b.jpg', bytes(20));
		to.files.set('fotos/a.jpg', bytes(10));
		const files = [
			{ area: 'fotos', name: 'a.jpg' },
			{ area: 'fotos', name: 'b.jpg' }
		];
		expect(await copyFiles({ files, from: from.side, to: to.side, wait: noWait })).toEqual({
			done: 2,
			missing: 0,
			problem: null
		});
		expect(to.puts()).toBe(1);
		expect(to.files.get('fotos/b.jpg')?.length).toBe(20);
		// Again: nothing left to copy.
		await copyFiles({ files, from: from.side, to: to.side, wait: noWait });
		expect(to.puts()).toBe(1);
	});

	test('a different size there is copied again', async () => {
		const from = memory();
		const to = memory();
		from.files.set('notas/n.webm', bytes(30));
		to.files.set('notas/n.webm', bytes(7));
		await copyFiles({
			files: [{ area: 'notas', name: 'n.webm' }],
			from: from.side,
			to: to.side,
			wait: noWait
		});
		expect(to.files.get('notas/n.webm')?.length).toBe(30);
	});

	test('one gone meanwhile is skipped', async () => {
		const from = memory();
		const to = memory();
		expect(
			await copyFiles({
				files: [{ area: 'fotos', name: 'ya-no.jpg' }],
				from: from.side,
				to: to.side,
				wait: noWait
			})
		).toEqual({ done: 1, missing: 1, problem: null });
	});

	test('a failure stops it with why, after trying again; then it goes on from there', async () => {
		const from = memory();
		const failing = new Set(['b.jpg']);
		const to = memory(failing);
		for (const n of ['a.jpg', 'b.jpg', 'c.jpg']) from.files.set(`fotos/${n}`, bytes(5));
		const files = ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => ({ area: 'fotos', name }));
		let waits = 0;
		const first = await copyFiles({
			files,
			from: from.side,
			to: to.side,
			wait: async () => void waits++
		});
		expect(first.done).toBe(1);
		expect(first.problem).toContain('permiso');
		expect(waits).toBe(2);
		expect(to.files.has('fotos/c.jpg')).toBe(false);
		failing.clear();
		expect(await copyFiles({ files, from: from.side, to: to.side, wait: noWait })).toEqual({
			done: 3,
			missing: 0,
			problem: null
		});
		expect(to.puts()).toBe(3);
	});

	test('cancelled meanwhile, it stops', async () => {
		const from = memory();
		const to = memory();
		for (const n of ['a', 'b']) from.files.set(`fotos/${n}`, bytes(1));
		let asked = 0;
		const result = await copyFiles({
			files: [
				{ area: 'fotos', name: 'a' },
				{ area: 'fotos', name: 'b' }
			],
			from: from.side,
			to: to.side,
			stopped: async () => ++asked > 1,
			wait: noWait
		});
		expect(result).toEqual({ done: 1, missing: 0, problem: null });
	});
});
