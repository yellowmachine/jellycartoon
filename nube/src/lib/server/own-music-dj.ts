import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { writeWav } from 'comun/wav.ts';
import { playlistBatch, type DjOptions, type DjVoice, type MusicTrack } from 'comun/music.ts';
import { asTrack } from '#lib/own-music.ts';
import type { Kitchen } from './fridge.ts';
import { openRouterKey } from './family-settings.ts';
import { completeJson, speech } from './openrouter.ts';
import { ownPlaylistOf } from './own-music-lists.ts';
import { voiceSettings } from './voice/settings.ts';

/**
 * Modo DJ with a list of «Tu música» (#534), as the house's (music/dj.ts) but made by Seilide: the
 * list's songs, mixed or in order, and every few of them a DJ who says what has sounded and what
 * comes. Its words, by the family's AI (its OpenRouter key and voice model), with only what the
 * files say; read aloud by Gemini through OpenRouter, the house's DJ voices. Kept a while here, as
 * one more track of the queue: made while the song before plays, and skipped if not ready in time.
 */

const run = promisify(execFile);

/** The house's DJ voices (music/dj.ts), chosen by ear there. */
const SPEECH_MODEL = 'google/gemini-3.8-flash-tts';
const VOICES: Record<DjVoice, string> = { male: 'Puck', female: 'Laomedeia' };
/** Songs given at a time; more when only a few are left (comun's dj.svelte.ts). */
export const DJ_BATCH = 30;
/** The DJ's words are kept this long: the queue may be saved and brought back meanwhile. */
const KEEP_MS = 12 * 3600_000;
const DIR = path.join(tmpdir(), 'seilide-dj');

/** What browsers seldom play: left out of the DJ, which cannot grey them as a page does. */
const RARELY_PLAYED = new Set(['audio/mp4; codecs="alac"', 'audio/x-ms-wma']);

/** Whether the family can have the DJ: it speaks with its OpenRouter key. */
export async function ownDjEnabled(k: Kitchen) {
	return Boolean(await openRouterKey(k));
}

/** The list's songs as the player takes them, in its order, without what browsers seldom play. */
async function listTracks(familyId: string, playlistId: number) {
	const list = await ownPlaylistOf(familyId, playlistId);
	if (!list) return null;
	return list.items
		.filter((i) => !RARELY_PLAYED.has(i.track.mime))
		.map((i) => asTrack(i.track, i.album));
}

/** The DJ's next songs of the list (comun's playlistBatch); null, not the family's list. */
export async function ownDjTracks(
	familyId: string,
	playlistId: number,
	{ inOrder, offset, exclude }: { inOrder: boolean; offset: number; exclude: number[] }
) {
	const tracks = await listTracks(familyId, playlistId);
	if (!tracks) return null;
	return playlistBatch(tracks, DJ_BATCH, { inOrder, offset, exclude });
}

const describe = (t: MusicTrack) => `«${t.title}», de ${t.artist} (álbum «${t.album}»)`;

/** What the DJ says: by the AI with only those facts; without it, the same said plainly. */
async function words(
	k: Kitchen,
	apiKey: string,
	played: MusicTrack[],
	next: MusicTrack | null,
	lang: DjOptions['lang'],
	playlist: string | null
) {
	const english = lang === 'en';
	const facts = [
		...(playlist ? [`Suena la lista «${playlist}», de la familia.`] : []),
		`Han sonado: ${played.map(describe).join('; ')}.`,
		next ? `Ahora suena: ${describe(next)}.` : 'No se sabe qué suena después.'
	].join('\n');
	try {
		const { texto } = await completeJson<{ texto: string }>({
			apiKey,
			label: 'Locutor del modo DJ',
			system: [
				'Eres el locutor de una emisora de radio musical que suena en una casa.',
				'Entre canción y canción dices en voz alta, en una a tres frases (unos 15 segundos),',
				'qué ha sonado y qué viene ahora, con naturalidad y simpatía, como en la radio.',
				'Usa SOLO los datos que te dan: no inventes años, historias, géneros ni nada que no esté.',
				'Si te dicen qué lista suena, puedes nombrarla alguna vez, sin repetirla siempre.',
				'Sin emojis ni acotaciones: es texto para leer en voz alta.',
				english
					? 'Habla en inglés (English), sencillo y claro: quien escucha está aprendiendo.'
					: 'Habla en español de España.'
			].join(' '),
			prompt: facts,
			name: 'locucion',
			schema: {
				type: 'object',
				properties: { texto: { type: 'string' } },
				required: ['texto'],
				additionalProperties: false
			},
			model: (await voiceSettings(k)).model,
			maxTokens: 1000,
			timeoutMs: 30_000
		});
		if (texto.trim()) return texto.trim();
	} catch (err) {
		console.warn('[tu música] El locutor no pudo escribir; lo dice sin IA', String(err));
	}
	const last = played.at(-1);
	if (english)
		return [
			last ? `That was ${last.title}, by ${last.artist}.` : '',
			next ? `Now, ${next.title}, by ${next.artist}.` : ''
		].join(' ');
	return [
		last ? `Acabas de escuchar ${last.title}, de ${last.artist}.` : '',
		next ? `Ahora, ${next.title}, de ${next.artist}.` : ''
	].join(' ');
}

/** How it speaks: told apart from the words, which Gemini would otherwise read aloud. */
function delivery(lang: DjOptions['lang'], voice: DjVoice) {
	if (lang === 'en')
		return 'Upbeat, friendly music radio DJ. Clear and not too fast: the listener is learning English.';
	return [
		voice === 'female' ? 'Locutora' : 'Locutor',
		'de radio musical de España, acento castellano peninsular, tono animado y cercano.',
		'Pronuncia los nombres de grupos y los títulos de canciones en su idioma original, con naturalidad.'
	].join(' ');
}

/** Each clip's family: only its own may hear it. */
const clips = new Map<string, { familyId: string; at: number }>();

async function prune() {
	const now = Date.now();
	for (const [id, c] of clips) if (now - c.at > KEEP_MS) clips.delete(id);
	for (const file of await readdir(DIR).catch(() => [] as string[])) {
		const at = (await stat(path.join(DIR, file)).catch(() => null))?.mtimeMs ?? now;
		if (now - at > KEEP_MS) await rm(path.join(DIR, file), { force: true });
	}
}

const clipFile = (id: string) => path.join(DIR, `${id}.ogg`);
const isClipId = (id: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

/** As Ogg Opus, mono, for speech: a fraction of the WAV, for the phone's data in the car too. */
async function toOpus(wav: Uint8Array, out: string) {
	const input = `${out}.wav`;
	try {
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
				out
			],
			{ timeout: 60_000 }
		);
	} finally {
		await rm(input, { force: true });
	}
}

/**
 * Negative, so the DJ's words never clash with a song's id in the queue; from a random start, so
 * not with those of before a restart either.
 */
let clipCount = Math.floor(Math.random() * 1_000_000);

/**
 * The DJ's words after `played`, before `next` (ids of the list's songs), as a track of the queue.
 * Throws if it cannot (no key, the voice failing): the browser goes on without that talk.
 */
export async function ownDjClip(
	k: Kitchen,
	input: {
		playlistId: number;
		played: number[];
		next: number | null;
		lang: DjOptions['lang'];
		voice: DjVoice;
		playlist: string | null;
	}
): Promise<MusicTrack> {
	const apiKey = await openRouterKey(k);
	if (!apiKey) throw new Error('Sin clave de OpenRouter, el locutor no puede hablar');
	const tracks = (await listTracks(k.familyId, input.playlistId)) ?? [];
	const byId = new Map(tracks.map((t) => [t.id, t]));
	const played = input.played.map((id) => byId.get(id)).filter((t): t is MusicTrack => Boolean(t));
	const next = input.next === null ? null : (byId.get(input.next) ?? null);
	const text = await words(k, apiKey, played, next, input.lang, input.playlist);
	const { pcm, rate } = await speech({
		apiKey,
		model: SPEECH_MODEL,
		voice: VOICES[input.voice],
		input: text,
		instructions: delivery(input.lang, input.voice),
		timeoutMs: 60_000
	});
	await mkdir(DIR, { recursive: true });
	await prune();
	const id = randomUUID();
	await toOpus(writeWav(rate, 1, pcm), clipFile(id));
	clips.set(id, { familyId: k.familyId, at: Date.now() });
	return {
		id: -++clipCount,
		title: input.lang === 'en' ? 'DJ' : 'Locutor',
		artist: 'Modo DJ',
		number: null,
		durationSec: Math.round(pcm.length / 2 / rate),
		albumId: 0,
		album: '',
		hasCover: false,
		clip: { id, text },
		src: `/api/music/own/dj/clips/${id}`
	};
}

/** A clip's audio, only to its family; null, not there (or another's). */
export async function ownDjClipAudio(familyId: string, id: string) {
	if (!isClipId(id) || clips.get(id)?.familyId !== familyId) return null;
	return readFile(clipFile(id)).catch(() => null);
}
