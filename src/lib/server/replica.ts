import {
	ShapeStream,
	isChangeMessage,
	isControlMessage,
	type Offset,
	type Row
} from '@electric-sql/client';
import { ELECTRIC_REPLICA } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { askCloud, cloudLink, CloudProblem, linked } from '#lib/server/kitchen.ts';
import { log } from '#lib/server/log.ts';
import {
	applyChanges,
	foldChange,
	readPosition,
	REPLICAS,
	replaceAll,
	type Change,
	type ReplicaName
} from '#lib/server/replica-apply.ts';
import { useCloudTags } from '#lib/server/tags.ts';

/**
 * La copia de solo lectura de lo que es de Seilide (#394, piloto), con ELECTRIC_REPLICA: baja por
 * su /api/casa/sync, con la llave de la casa. Sin red, la casa sigue leyendo lo que tiene, y al
 * volver se pone al día. Si algo falla, otra vez desde la última posición guardada.
 */

const RETRY_MS = 30_000;

async function follow(name: ReplicaName) {
	const link = await cloudLink();
	if (!link) throw new Error('Sin Seilide conectado');
	const position = await readPosition(db, name);

	/** Sin nada aún, o si Electric manda empezar de nuevo: se junta entera antes de tocar la tabla. */
	let fromScratch: Map<string, Row> | null = position ? null : new Map();
	let pending: Change[] = [];

	const abort = new AbortController();
	const stream = new ShapeStream({
		url: `${link.url}/api/casa/sync/${name}`,
		headers: { 'x-api-key': link.key },
		signal: abort.signal,
		...(position ? { handle: position.handle, offset: position.offset as Offset } : {}),
		// Aquí nunca se rinde: sin red es lo normal. Si el cliente se rinde igual, `done`.
		onError: (error) => {
			log.warn('replica', `${name}: sin respuesta`, { error });
			return {};
		}
	});

	await new Promise<void>((_, reject) => {
		const done = (error: unknown) => {
			abort.abort();
			reject(error);
		};
		stream.subscribe(async (messages) => {
			try {
				for (const message of messages) {
					if (isChangeMessage(message)) {
						const change = { operation: message.headers.operation, value: message.value } as Change;
						if (fromScratch) foldChange(name, fromScratch, change);
						else pending.push(change);
					} else if (isControlMessage(message)) {
						if (message.headers.control === 'must-refetch') {
							fromScratch = new Map();
							pending = [];
						} else if (message.headers.control === 'up-to-date') {
							const at = { handle: stream.shapeHandle as string, offset: stream.lastOffset };
							if (fromScratch) {
								await replaceAll(db, name, [...fromScratch.values()], at);
								log.info('replica', `${name}: copia completa`, { filas: fromScratch.size });
								fromScratch = null;
							} else if (pending.length) {
								await applyChanges(db, name, pending, at);
							}
							pending = [];
						}
					}
				}
			} catch (error) {
				done(error);
			}
		}, done);
	});
}

async function keepFollowing(name: ReplicaName) {
	for (;;) {
		try {
			await follow(name);
		} catch (error) {
			log.warn('replica', `${name}: se reintenta`, { error });
		}
		await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
	}
}

export function startReplica() {
	if (!ELECTRIC_REPLICA) return;
	useCloudTags({
		ask: async <T>(body: Record<string, unknown>) =>
			askCloud<T>(await linked(), '/etiquetas', { body }),
		problem: (message) => new CloudProblem(message),
		isProblem: (error) => error instanceof CloudProblem,
		note: (message) => log.info('replica', message)
	});
	for (const name of Object.keys(REPLICAS) as ReplicaName[]) void keepFollowing(name);
}
