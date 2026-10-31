import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile as readLocal, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { asc, count, eq, inArray } from 'drizzle-orm';
import { AI_VOICE, isAiVoice, MAX_TONE_CHARS } from 'comun/ai-voice.ts';
import { writeWav } from 'comun/wav.ts';
import {
	familySettings,
	prayer,
	prayerList,
	prayerListItem,
	prayerVoice
} from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { sayableError, speech } from '#lib/server/openrouter.ts';
import { putFile, removeFile, storageReady } from '#lib/server/storage.ts';
import {
	GENERATING_MS,
	MAX_ITEMS,
	MAX_PAUSE,
	MAX_TEXT,
	MAX_TIMES,
	MAX_TITLE,
	MAX_VOICE_NAME,
	prayerAudioUrl,
	speechChunks,
	type PrayerListView,
	type PrayerStatus,
	type PrayerView,
	type PrayerVoiceView
} from '#lib/prayers.ts';

/**
 * Oración (#339): the family's texts, read aloud once by one of its named voices (Gemini through
 * OpenRouter, with the family's key) and kept as Opus in its files, and its lists. Recorded in the
 * background, one at a time per family: OpenRouter counts what is in flight against the credit.
 */

const run = promisify(execFile);
const AREA = 'oracion';

// ——— On or off (Ajustes → Familia) ———

export async function prayerModeOn(k: Kitchen) {
	const [row] = await k.run((tx) =>
		tx.select({ on: familySettings.prayerMode }).from(familySettings)
	);
	return row?.on ?? false;
}

export async function setPrayerMode(k: Kitchen, on: boolean) {
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, prayerMode: on })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { prayerMode: on } })
	);
}

// ——— Voices ———

export interface VoiceInput {
	name: string;
	voice: string;
	tone: string;
}

export function parseVoiceInput(form: FormData): VoiceInput | null {
	const name = String(form.get('name') ?? '')
		.trim()
		.slice(0, MAX_VOICE_NAME);
	const voice = String(form.get('voice') ?? '');
	const tone = String(form.get('tone') ?? '')
		.trim()
		.slice(0, MAX_TONE_CHARS);
	return name && isAiVoice(voice) ? { name, voice, tone } : null;
}

export function listVoices(k: Kitchen): Promise<PrayerVoiceView[]> {
	return k.run(async (tx) => {
		const uses = await tx
			.select({ voiceId: prayer.voiceId, n: count() })
			.from(prayer)
			.groupBy(prayer.voiceId);
		const rows = await tx
			.select()
			.from(prayerVoice)
			.orderBy(asc(prayerVoice.name), asc(prayerVoice.id));
		return rows.map((v) => ({
			id: v.id,
			name: v.name,
			voice: v.voice,
			tone: v.tone,
			uses: uses.find((u) => u.voiceId === v.id)?.n ?? 0
		}));
	});
}

/** New (`id` null) or changed; null if that one is not there. */
export async function saveVoice(k: Kitchen, id: number | null, input: VoiceInput) {
	return k.run(async (tx) => {
		if (!id) {
			const [row] = await tx
				.insert(prayerVoice)
				.values({ familyId: k.familyId, ...input })
				.returning({ id: prayerVoice.id });
			return row.id;
		}
		const [row] = await tx
			.update(prayerVoice)
			.set(input)
			.where(eq(prayerVoice.id, id))
			.returning({ id: prayerVoice.id });
		return row?.id ?? null;
	});
}

/** False while a text uses it. */
export async function deleteVoice(k: Kitchen, id: number) {
	return k.run(async (tx) => {
		const [used] = await tx.select({ n: count() }).from(prayer).where(eq(prayer.voiceId, id));
		if (used.n) return false;
		await tx.delete(prayerVoice).where(eq(prayerVoice.id, id));
		return true;
	});
}

// ——— Texts ———

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** What a recording is made with: if any of it changes, it is no longer this text's. */
export const recordingKey = (text: string, voice: { voice: string; tone: string }) =>
	hash(`${voice.voice}|${voice.tone}|${text}`);

type PrayerRow = typeof prayer.$inferSelect;
type VoiceRow = typeof prayerVoice.$inferSelect;

export function statusOf(
	p: PrayerRow,
	voice: VoiceRow | undefined,
	now = Date.now()
): PrayerStatus {
	if (p.generatingSince && now - p.generatingSince.getTime() < GENERATING_MS) return 'generando';
	if (p.audioError || p.generatingSince) return 'error';
	if (!p.audioFile) return 'pendiente';
	return voice && p.audioKey === recordingKey(p.text, voice) ? 'lista' : 'cambiada';
}

function asView(p: PrayerRow, voice: VoiceRow | undefined): PrayerView {
	const status = statusOf(p, voice);
	return {
		id: p.id,
		title: p.title,
		text: p.text,
		voiceId: p.voiceId,
		status,
		durationSec: p.durationSec,
		error:
			status === 'error'
				? (p.audioError ??
					'Se cortó mientras se generaba (el servidor se reinició). Prueba otra vez.')
				: null,
		audioUrl: p.audioFile && p.audioKey ? prayerAudioUrl(p.id, p.audioKey) : null,
		audioKey: p.audioFile ? p.audioKey : null
	};
}

export function listPrayers(k: Kitchen): Promise<PrayerView[]> {
	return k.run(async (tx) => {
		const voices = await tx.select().from(prayerVoice);
		const rows = await tx.select().from(prayer).orderBy(asc(prayer.title), asc(prayer.id));
		return rows.map((p) =>
			asView(
				p,
				voices.find((v) => v.id === p.voiceId)
			)
		);
	});
}

export interface PrayerInput {
	title: string;
	text: string;
	voiceId: number;
}

export function parsePrayerInput(form: FormData): PrayerInput | null {
	const title = String(form.get('title') ?? '')
		.trim()
		.slice(0, MAX_TITLE);
	const text = String(form.get('text') ?? '')
		.trim()
		.slice(0, MAX_TEXT);
	const voiceId = Number(form.get('voiceId'));
	return title && text && Number.isInteger(voiceId) && voiceId > 0
		? { title, text, voiceId }
		: null;
}

/** New or changed; null if it (or its voice) is not there. The recording stays as it was. */
export async function savePrayer(k: Kitchen, id: number | null, input: PrayerInput) {
	return k.run(async (tx) => {
		const [voice] = await tx
			.select({ id: prayerVoice.id })
			.from(prayerVoice)
			.where(eq(prayerVoice.id, input.voiceId));
		if (!voice) return null;
		if (!id) {
			const [row] = await tx
				.insert(prayer)
				.values({ familyId: k.familyId, ...input, createdBy: k.userId })
				.returning({ id: prayer.id });
			return row.id;
		}
		const [row] = await tx
			.update(prayer)
			.set(input)
			.where(eq(prayer.id, id))
			.returning({ id: prayer.id });
		return row?.id ?? null;
	});
}

export async function deletePrayer(k: Kitchen, id: number) {
	const [gone] = await k.run((tx) =>
		tx.delete(prayer).where(eq(prayer.id, id)).returning({ file: prayer.audioFile })
	);
	if (gone?.file) await removeFile(k.familyId, AREA, gone.file).catch(() => {});
	return Boolean(gone);
}

/** Its recording's name in the family's files, if it has one: for /api/oracion/audio. */
export async function prayerAudioFile(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ file: prayer.audioFile }).from(prayer).where(eq(prayer.id, id))
	);
	return row?.file ?? null;
}

// ——— Recording ———

/** Between pieces of a long text, as a breath. */
const BETWEEN_PIECES_SEC = 0.6;
/** Each piece: Gemini takes a few seconds for a short one; a long one, more. */
const PIECE_TIMEOUT_MS = 120_000;

/** By family, the one being recorded: the next waits for it. */
const turns = new Map<string, Promise<unknown>>();

function inTurn<T>(familyId: string, task: () => Promise<T>) {
	const before = turns.get(familyId) ?? Promise.resolve();
	const mine = before.catch(() => {}).then(task);
	const done = mine.catch(() => {});
	turns.set(familyId, done);
	void done.then(() => {
		if (turns.get(familyId) === done) turns.delete(familyId);
	});
	return mine;
}

/** 16-bit mono silence at `rate`. */
const silence = (rate: number, sec: number) => new Uint8Array(Math.round(rate * sec) * 2);

/** As Ogg Opus, mono, for speech: a fraction of the WAV. */
async function toOpus(wav: Uint8Array) {
	const dir = await mkdtemp(path.join(tmpdir(), 'oracion-'));
	try {
		const input = path.join(dir, 'voz.wav');
		const output = path.join(dir, 'voz.ogg');
		await writeFile(input, wav);
		await run(
			'ffmpeg',
			[
				'-hide_banner',
				'-nostats',
				'-y',
				'-i',
				input,
				'-ac',
				'1',
				'-c:a',
				'libopus',
				'-b:a',
				'48k',
				'-f',
				'ogg',
				output
			],
			{ timeout: 120_000 }
		);
		return new Uint8Array(await readLocal(output));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Read aloud, piece by piece, and joined: its PCM, its rate and how long it lasts. */
async function readAloud(apiKey: string, text: string, voice: { voice: string; tone: string }) {
	let rate = 24_000;
	const parts: Uint8Array[] = [];
	for (const piece of speechChunks(text)) {
		const said = await speech({
			apiKey,
			model: AI_VOICE.model,
			voice: voice.voice,
			input: piece,
			instructions: voice.tone || undefined,
			timeoutMs: PIECE_TIMEOUT_MS
		});
		if (parts.length) parts.push(silence(said.rate, BETWEEN_PIECES_SEC));
		rate = said.rate;
		parts.push(said.pcm);
	}
	const pcm = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		pcm.set(p, at);
		at += p.length;
	}
	return { wav: writeWav(rate, 1, pcm), durationSec: pcm.length / 2 / rate };
}

/**
 * A few words in a voice, to hear how it sounds before recording a long text (#339): not kept, and
 * in the family's turn, as the recordings. Its voice and tone as written, saved or not.
 */
export async function tryVoice(
	familyId: string,
	apiKey: string,
	voice: { voice: string; tone: string },
	text: string
) {
	return inTurn(familyId, async () => toOpus((await readAloud(apiKey, text, voice)).wav));
}

/**
 * Starts recording it with the family's key, in the background (its state says how it goes); a
 * reason, said for a person, if it cannot start.
 */
export async function generatePrayer(
	k: Kitchen,
	id: number,
	apiKey: string | null
): Promise<string | null> {
	if (!storageReady) return 'No hay dónde guardar la voz (falta el almacenamiento de ficheros).';
	if (!apiKey) return 'Falta la clave de OpenRouter de la familia (Ajustes → Familia).';
	const [started] = await k.run((tx) =>
		tx
			.update(prayer)
			.set({ generatingSince: new Date(), audioError: null })
			.where(eq(prayer.id, id))
			.returning({ id: prayer.id })
	);
	if (!started) return 'Ese texto ya no está.';
	void inTurn(k.familyId, () => record(k, apiKey, id));
	return null;
}

async function record(k: Kitchen, apiKey: string, id: number) {
	try {
		// As it is now: it may have changed while it waited its turn.
		const [row] = await k.run((tx) =>
			tx
				.select({ p: prayer, v: prayerVoice })
				.from(prayer)
				.innerJoin(prayerVoice, eq(prayerVoice.id, prayer.voiceId))
				.where(eq(prayer.id, id))
		);
		if (!row) return;
		const key = recordingKey(row.p.text, row.v);
		const { wav, durationSec } = await readAloud(apiKey, row.p.text, row.v);
		const file = `${id}-${key}.ogg`;
		await putFile(k.familyId, AREA, file, await toOpus(wav), 'audio/ogg');
		const [before] = await k.run((tx) =>
			tx.select({ file: prayer.audioFile }).from(prayer).where(eq(prayer.id, id))
		);
		const [saved] = await k.run((tx) =>
			tx
				.update(prayer)
				.set({
					audioFile: file,
					audioKey: key,
					durationSec,
					generatingSince: null,
					audioError: null
				})
				.where(eq(prayer.id, id))
				.returning({ id: prayer.id })
		);
		// Deleted meanwhile: its new recording out too.
		if (!saved) await removeFile(k.familyId, AREA, file).catch(() => {});
		if (before?.file && before.file !== file)
			await removeFile(k.familyId, AREA, before.file).catch(() => {});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[oración] No se pudo generar la voz del texto ${id}`, message);
		await k
			.run((tx) =>
				tx
					.update(prayer)
					.set({ generatingSince: null, audioError: sayableError(message) })
					.where(eq(prayer.id, id))
			)
			.catch(() => {});
	}
}

// ——— Lists ———

export function listLists(k: Kitchen): Promise<PrayerListView[]> {
	return k.run(async (tx) => {
		const lists = await tx
			.select()
			.from(prayerList)
			.orderBy(asc(prayerList.title), asc(prayerList.id));
		const items = lists.length
			? await tx
					.select()
					.from(prayerListItem)
					.where(
						inArray(
							prayerListItem.listId,
							lists.map((l) => l.id)
						)
					)
					.orderBy(asc(prayerListItem.position), asc(prayerListItem.id))
			: [];
		return lists.map((l) => ({
			id: l.id,
			title: l.title,
			pauseSec: l.pauseSec,
			items: items
				.filter((i) => i.listId === l.id)
				.map((i) => ({ prayerId: i.prayerId, times: i.times }))
		}));
	});
}

export interface ListInput {
	title: string;
	pauseSec: number;
	items: { prayerId: number; times: number }[];
}

/** `list` as JSON, as the page sends it. */
export function parseListInput(raw: unknown): ListInput | null {
	if (!raw || typeof raw !== 'object') return null;
	const { title, pauseSec, items } = raw as Record<string, unknown>;
	if (typeof title !== 'string' || !title.trim() || !Array.isArray(items)) return null;
	const pause = Math.round(Number(pauseSec));
	const parsed = items.slice(0, MAX_ITEMS).map((i) => {
		const { prayerId, times } = (i ?? {}) as Record<string, unknown>;
		return { prayerId: Number(prayerId), times: Math.round(Number(times)) };
	});
	if (parsed.some((i) => !Number.isInteger(i.prayerId) || i.prayerId <= 0)) return null;
	return {
		title: title.trim().slice(0, MAX_TITLE),
		pauseSec: Number.isFinite(pause) ? Math.min(Math.max(pause, 0), MAX_PAUSE) : 3,
		items: parsed.map((i) => ({
			prayerId: i.prayerId,
			times: Number.isFinite(i.times) ? Math.min(Math.max(i.times, 1), MAX_TIMES) : 1
		}))
	};
}

/** New or changed, its texts as given; null if it, or one of its texts, is not there. */
export async function saveList(k: Kitchen, id: number | null, input: ListInput) {
	return k.run(async (tx) => {
		const ids = [...new Set(input.items.map((i) => i.prayerId))];
		if (ids.length) {
			const found = await tx.select({ id: prayer.id }).from(prayer).where(inArray(prayer.id, ids));
			if (found.length !== ids.length) return null;
		}
		const fields = { title: input.title, pauseSec: input.pauseSec };
		let listId: number;
		if (!id) {
			const [row] = await tx
				.insert(prayerList)
				.values({ familyId: k.familyId, ...fields })
				.returning({ id: prayerList.id });
			listId = row.id;
		} else {
			const [row] = await tx
				.update(prayerList)
				.set(fields)
				.where(eq(prayerList.id, id))
				.returning({ id: prayerList.id });
			if (!row) return null;
			listId = row.id;
			await tx.delete(prayerListItem).where(eq(prayerListItem.listId, listId));
		}
		if (input.items.length)
			await tx
				.insert(prayerListItem)
				.values(
					input.items.map((i, position) => ({ familyId: k.familyId, listId, position, ...i }))
				);
		return listId;
	});
}

export async function deleteList(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(prayerList).where(eq(prayerList.id, id)));
}
