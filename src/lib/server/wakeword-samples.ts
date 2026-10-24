import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { isSampleWav, KINDS, speakerSlug, type Kind } from '#lib/wakeword-samples.ts';

export { KINDS, MAX_SAMPLE_BYTES, type Kind } from '#lib/wakeword-samples.ts';

/**
 * Voices of the house saying the wake word (#144, phase 3), to train its model with them: the
 * synthetic voices alone do not sound like us. Each take a WAV (16 kHz, mono, 16 bits, as the
 * detector hears) in DATA_DIR/palabra/<kind>/<who>/; nothing leaves this server, and they are
 * taken from there to train by hand.
 */

const root = path.join(dataRoot, 'palabra');

/** Only what this module names: never a path from outside. */
const isFileName = (name: string) => /^\d{13}_[a-z0-9]{6}\.wav$/.test(name);

/** A take kept: its file's name, to undo it. */
export async function saveSample(kind: Kind, speaker: string, wav: Uint8Array, by: string) {
	const who = speakerSlug(speaker);
	if (!who) throw new Error('Falta quién habla');
	if (!isSampleWav(wav)) throw new Error('No es una grabación de las de esta página');
	const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}.wav`;
	const dir = path.join(root, kind, who);
	const file = path.join(dir, name);
	await mkdir(dir, { recursive: true });
	await writeFile(`${file}.part`, wav);
	await rename(`${file}.part`, file);
	log.info('palabra', 'Grabación guardada', { kind, speaker: who, by });
	return name;
}

export async function deleteSample(kind: Kind, speaker: string, name: string) {
	const who = speakerSlug(speaker);
	if (!who || !isFileName(name)) throw new Error('No es una grabación');
	await rm(path.join(root, kind, who, name), { force: true });
}

/** How many takes each one has: { speaker: { kind: count } }. */
export async function sampleCounts() {
	const counts: Record<string, Partial<Record<Kind, number>>> = {};
	for (const kind of KINDS) {
		const speakers = await readdir(path.join(root, kind)).catch(() => [] as string[]);
		for (const who of speakers) {
			const files = await readdir(path.join(root, kind, who)).catch(() => [] as string[]);
			const n = files.filter(isFileName).length;
			if (n) (counts[who] ??= {})[kind] = n;
		}
	}
	return counts;
}
