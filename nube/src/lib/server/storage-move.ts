import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { dev } from '$app/env';
import { familyOnlyScope } from './family-scope.ts';
import { db } from './db/index.ts';
import { storedFile } from './db/storage.schema.ts';
import { sealFor } from './family-secret.ts';
import { tellMove } from './file-quota.ts';
import {
	bucketProblem,
	copyFiles,
	endpointProblem,
	labelOf,
	samePlace,
	type Bucket
} from './storage-bucket.ts';
import {
	familyStorage,
	forgetPlaces,
	openBucket,
	ownPlace,
	placesOf,
	removeSeilideCopies,
	sideOf
} from './storage.ts';

/**
 * A family's files to its own storage (#480, phase 2), or from one of its own to another, or (only
 * the service's administrator) back to Seilide's. The copy runs here, in the background, one family
 * at a time each; stopped by a restart, it goes on at the start (hooks.server.ts), and what was
 * copied is not copied again (storage-bucket.ts' `copyFiles`). Meanwhile nothing waits: storage.ts
 * writes in both places and reads from where they were.
 */

const asFamily = familyOnlyScope(db);

export type StorageView = ReturnType<typeof storageView>;

/** What Ajustes shows of where the family's files are: never the keys. */
export function storageView(row: Awaited<ReturnType<typeof familyStorage.of>>) {
	return {
		state: row?.moving ? 'pasando' : row?.current ? 'externo' : 'interno',
		label: row?.currentLabel ?? null,
		nextLabel: row?.moving ? (row.nextLabel ?? 'Seilide') : null,
		done: row?.done ?? 0,
		total: row?.total ?? 0,
		problem: row?.problem ?? null,
		movedAt: row?.movedAt ?? null,
		cleanupAt: row?.cleanupAt ?? null
	} as const;
}

/** The moves running now, so that a family's is never run twice at once. */
const running = new Set<string>();

/**
 * Whether Seilide can use that bucket: its address may be reached, and a file can be written, read,
 * listed and deleted in its folder. What is wrong, or null.
 */
export async function testBucket(b: Bucket) {
	const wrong = await endpointProblem(
		b.endpoint,
		(host) => lookup(host, { all: true, verbatim: true }),
		{ allowPrivate: dev }
	);
	if (wrong) return wrong;
	const side = sideOf(ownPlace(b));
	const name = `prueba-${randomUUID()}.txt`;
	const body = new TextEncoder().encode('Seilide');
	try {
		await side.put('.seilide', name, body, 'text/plain');
		const back = await side.get('.seilide', name);
		if (!back || new TextDecoder().decode(back) !== 'Seilide')
			return 'Se escribe pero no se lee lo mismo';
		if (!(await side.list('.seilide')).includes(name)) return 'Las claves no dejan listar';
		await side.remove('.seilide', name);
		return null;
	} catch (err) {
		return bucketProblem(err);
	}
}

const filesOf = (familyId: string) =>
	asFamily(familyId, (tx) =>
		tx.select({ area: storedFile.area, name: storedFile.name }).from(storedFile)
	);

/**
 * The move to `to` (null: back to Seilide's, only from /admin), after trying the bucket. What is
 * wrong, or null: started.
 */
export async function startMove(familyId: string, to: Bucket | null) {
	if (to) {
		const wrong = await testBucket(to);
		if (wrong) return wrong;
		const row = await familyStorage.of(familyId);
		if (row?.current && samePlace(await openBucket(familyId, row.current), to))
			return 'Ya estáis en ese almacenamiento: para otras claves, «Cambiar las claves»';
	}
	const destination = to
		? { sealed: await sealFor(familyId, JSON.stringify(to)), label: labelOf(to) }
		: null;
	const total = (await filesOf(familyId)).length;
	if (!(await familyStorage.start(familyId, destination, total)))
		return 'Ya se están pasando los ficheros';
	forgetPlaces(familyId);
	console.log('[ficheros] Empieza el paso', {
		familyId,
		to: destination?.label ?? 'Seilide',
		total
	});
	void runMove(familyId);
	return null;
}

/** After a problem: with new keys for the same bucket if they are given. What is wrong, or null. */
export async function continueMove(familyId: string, keys?: Bucket) {
	const row = await familyStorage.of(familyId);
	if (!row?.moving) return 'No se está pasando nada';
	if (keys) {
		if (!row.next || !samePlace(await openBucket(familyId, row.next), keys))
			return 'Tiene que ser el mismo almacenamiento, con otras claves';
		const wrong = await testBucket(keys);
		if (wrong) return wrong;
		await familyStorage.resume(familyId, {
			sealed: await sealFor(familyId, JSON.stringify(keys)),
			label: labelOf(keys)
		});
	} else await familyStorage.resume(familyId);
	forgetPlaces(familyId);
	void runMove(familyId);
	return null;
}

/** Not moving any more: they stay where they were (what was copied stays there too). */
export async function cancelMove(familyId: string) {
	await familyStorage.cancel(familyId);
	forgetPlaces(familyId);
}

/** Other keys for the bucket it is already in: nothing moves. What is wrong, or null. */
export async function changeKeys(familyId: string, keys: Bucket) {
	const row = await familyStorage.of(familyId);
	if (!row?.current || row.moving) return 'Ahora no se pueden cambiar las claves';
	if (!samePlace(await openBucket(familyId, row.current), keys))
		return 'Para otro bucket o carpeta, «Pasar a otro almacenamiento»';
	const wrong = await testBucket(keys);
	if (wrong) return wrong;
	await familyStorage.setKeys(
		familyId,
		await sealFor(familyId, JSON.stringify(keys)),
		labelOf(keys)
	);
	forgetPlaces(familyId);
	return null;
}

/**
 * The copy itself: every file the family has, to where it goes; then once more for those that came
 * meanwhile and did not reach it, and the switch. Stopped by a problem, it says so in Ajustes and to
 * who runs the family, and waits for «Seguir».
 */
async function runMove(familyId: string) {
	if (running.has(familyId)) return;
	running.add(familyId);
	try {
		const { from, to } = await placesOf(familyId);
		if (!to) return;
		const still = async () => {
			const row = await familyStorage.of(familyId);
			return Boolean(row?.moving && !row.problem);
		};
		let lastSaid = 0;
		for (let round = 0; round < 2; round++) {
			const files = await filesOf(familyId);
			const result = await copyFiles({
				files,
				from: sideOf(from),
				to: sideOf(to),
				stopped: async () => !(await still()),
				onProgress: async (done) => {
					if (Date.now() - lastSaid < 2000 && done < files.length) return;
					lastSaid = Date.now();
					await familyStorage.progress(familyId, done, files.length);
				}
			});
			if (result.problem) {
				console.warn('[ficheros] El paso se ha parado', { familyId, problem: result.problem });
				await familyStorage.stopped(familyId, result.problem);
				await tellMove(
					familyId,
					'Se ha parado el paso de los ficheros',
					`${result.problem}. Cuando esté arreglado, «Seguir» en Ajustes → Familia → Espacio.`
				);
				return;
			}
			if (!(await still())) return;
			await familyStorage.progress(familyId, result.done, files.length);
		}
		await familyStorage.finish(familyId);
		forgetPlaces(familyId);
		console.log('[ficheros] Paso terminado', { familyId });
		await tellMove(
			familyId,
			'Ficheros pasados',
			to.own
				? 'Todos los ficheros de la familia están ya en vuestro almacenamiento.'
				: 'Todos los ficheros de la familia están de nuevo en Seilide.'
		);
	} catch (err) {
		const problem = bucketProblem(err);
		console.error('[ficheros] El paso ha fallado', { familyId, problem });
		await familyStorage.stopped(familyId, problem).catch(() => {});
	} finally {
		running.delete(familyId);
	}
}

/** At the server's start: the moves a restart stopped, on from where they were. */
export async function resumeMoves() {
	for (const familyId of await familyStorage.pendingMoves()) void runMove(familyId);
}

/** Once a day: the copies left in Seilide's storage a week ago by those who moved out. */
export async function cleanupCopies() {
	for (const familyId of await familyStorage.cleanupDue()) {
		try {
			await removeSeilideCopies(familyId);
			await familyStorage.cleaned(familyId);
			console.log('[ficheros] Copias en Seilide borradas', { familyId });
		} catch (err) {
			console.warn('[ficheros] No se pudieron borrar las copias', { familyId, error: String(err) });
		}
	}
}
