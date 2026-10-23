import { asc, eq } from 'drizzle-orm';
import {
	OPENROUTER_API_KEY,
	OPENROUTER_MODEL,
	OPENROUTESERVICE_API_KEY,
	RELAY_PUBLISH_KEY,
	RELAY_URL
} from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { appSetting, user } from '#lib/server/db/schema.ts';

/** Cheap, fast and knows films well; changeable in Ajustes. */
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

/** For talking about films: better than the one that identifies them, still a few cents a question. */
export const DEFAULT_CHAT_MODEL = 'anthropic/claude-sonnet-5.5';

/**
 * For what looks at frames: the names of a film's scenes and the titles of a series' episodes. Sees
 * images well and does not reason first, which here costs a lot and adds little.
 */
export const DEFAULT_VISION_MODEL = 'anthropic/claude-sonnet-5.5';

/**
 * For voice commands (#33): someone waits with the phone in the hand, so fast; and it has to pick
 * the right tool from a vague sentence («lo de Raphael»), so good at using tools.
 */
export const DEFAULT_VOICE_MODEL = 'anthropic/claude-haiku-5.5';

type Key =
	| 'openrouter_api_key'
	| 'openrouter_model'
	| 'openrouter_chat_model'
	| 'openrouter_chat_web'
	| 'openrouter_vision_model'
	| 'openrouter_voice_model'
	| 'subtitles_paused'
	| 'last_scan_series'
	| 'last_scan_films'
	| 'auto_subtitle_langs'
	| 'episode_labels'
	| 'ors_api_key'
	| 'ors_url'
	| 'relay_url'
	| 'relay_key';

async function get(key: Key) {
	const [row] = await db
		.select({ value: appSetting.value })
		.from(appSetting)
		.where(eq(appSetting.key, key));
	return row?.value ?? null;
}

/** `null` deletes it. */
export async function setAppSetting(key: Key, value: string | null) {
	if (value === null) {
		await db.delete(appSetting).where(eq(appSetting.key, key));
		return;
	}
	await db
		.insert(appSetting)
		.values({ key, value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
}

/** The key in .env wins over the one in Ajustes, like the rest of the deploy configuration. */
export async function openRouterConfig() {
	const panelKey = await get('openrouter_api_key');
	const panelModel = await get('openrouter_model');
	return {
		apiKey: OPENROUTER_API_KEY ?? panelKey,
		keySource: OPENROUTER_API_KEY ? ('env' as const) : panelKey ? ('panel' as const) : null,
		model: panelModel ?? OPENROUTER_MODEL ?? DEFAULT_MODEL
	};
}

/** The conversations about films: their model, and whether the AI may search the web. */
/** openrouteservice's own, with the free key; a self-hosted one (Docker) goes in Ajustes. */
export const DEFAULT_ORS_URL = 'https://api.openrouteservice.org';

/**
 * The road mode's routes (#78): openrouteservice's key and address. The key in .env wins over the
 * one in Ajustes, as with OpenRouter.
 */
export async function orsConfig() {
	const [panelKey, url] = await Promise.all([get('ors_api_key'), get('ors_url')]);
	return {
		apiKey: OPENROUTESERVICE_API_KEY ?? panelKey,
		keySource: OPENROUTESERVICE_API_KEY ? ('env' as const) : panelKey ? ('panel' as const) : null,
		url: url ?? DEFAULT_ORS_URL
	};
}

/**
 * Sharing trips (#81): the relay's address and the key it expects, from .env (which wins) or
 * Ajustes. Without both, there is no «Compartir viaje».
 */
export async function relayConfig() {
	const [url, key] = await Promise.all([get('relay_url'), get('relay_key')]);
	return {
		url: (RELAY_URL ?? url)?.replace(/\/+$/, '') || null,
		key: RELAY_PUBLISH_KEY ?? key,
		fromEnv: Boolean(RELAY_URL || RELAY_PUBLISH_KEY)
	};
}

export async function chatConfig() {
	const [{ apiKey }, model, web] = await Promise.all([
		openRouterConfig(),
		get('openrouter_chat_model'),
		get('openrouter_chat_web')
	]);
	return { apiKey, model: model ?? DEFAULT_CHAT_MODEL, web: web === 'true' };
}

/** The scenes and the episode titles: their own model, apart from the conversations'. */
export async function visionModel() {
	return (await get('openrouter_vision_model')) ?? DEFAULT_VISION_MODEL;
}

/** Voice commands: their own model. */
export async function voiceModel() {
	return (await get('openrouter_voice_model')) ?? DEFAULT_VOICE_MODEL;
}

/** Gestión → Subtítulos: paused, Whisper starts nothing new until it is resumed. */
export async function subtitlesPaused() {
	return (await get('subtitles_paused')) === 'true';
}

export async function setSubtitlesPaused(paused: boolean) {
	await setAppSetting('subtitles_paused', paused ? 'true' : null);
}

/** How the last scan of a folder went (Gestión says it), as JSON with its time. */
export async function lastScan<T extends object>(kind: 'series' | 'films') {
	const value = await get(kind === 'series' ? 'last_scan_series' : 'last_scan_films');
	return value ? (JSON.parse(value) as T & { at: string }) : null;
}

export async function setLastScan(kind: 'series' | 'films', result: object) {
	await setAppSetting(
		kind === 'series' ? 'last_scan_series' : 'last_scan_films',
		JSON.stringify({ ...result, at: new Date().toISOString() })
	);
}

/** Gestión → Subtítulos: the audio languages new episodes and films get Whisper's subtitles in. */
export async function autoSubtitleLanguages() {
	return ((await get('auto_subtitle_langs')) ?? '').split(',').filter(Boolean);
}

export async function setAutoSubtitleLanguages(langs: string[]) {
	await setAppSetting('auto_subtitle_langs', langs.length ? langs.join(',') : null);
}

/** Ajustes → Casa: what the vision model looks for in episodes (episode-labels.ts), lowercase. */
export async function episodeLabels() {
	return parseLabels((await get('episode_labels')) ?? '');
}

export async function setEpisodeLabels(text: string) {
	const labels = parseLabels(text);
	await setAppSetting('episode_labels', labels.length ? labels.join(', ') : null);
	return labels;
}

/** «Perro, coche,  perro» → `perro`, `coche`: separated by commas, each once. */
export function parseLabels(text: string) {
	return [
		...new Set(
			text
				.split(',')
				.map((l) => l.trim().toLocaleLowerCase('es').replace(/\s+/g, ' '))
				.filter(Boolean)
		)
	];
}

/** There are no roles: the first account created is the one that manages the app. */
export async function isAdmin(userId: string) {
	const [first] = await db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).limit(1);
	return first?.id === userId;
}
