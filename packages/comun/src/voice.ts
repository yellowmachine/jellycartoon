import type { MusicTrack } from 'comun/music.ts';
import type { Recipe } from 'comun/recipe.ts';
import type { LngLat, Place } from 'comun/road.ts';

/** Voice commands (#33), shared by the server and /voz. */

/**
 * Where something sounds: this device (the browser that was spoken to) or the whole house
 * (Snapcast). The living room (the host's mpv) comes later.
 */
export type VoiceTarget = 'here' | 'house';

/** `stopAfterTrack`: «para al acabar esta canción». */
export type VoiceControl = 'pause' | 'resume' | 'next' | 'previous' | 'stop' | 'stopAfterTrack';

/** What the device has to do itself: the server cannot play in its browser. */
export type VoiceAction =
	| { kind: 'play'; tracks: MusicTrack[]; start: number; shuffle: boolean }
	| { kind: 'radio'; uuid: string }
	| { kind: 'control'; action: VoiceControl }
	/** «Para dentro de media hora», at the end of the song on then; 0, no longer. */
	| { kind: 'stopIn'; minutes: number }
	/** An episode in this browser's player; `startSec` null: from where it was left. */
	| { kind: 'watch'; episodeId: number; startSec: number | null }
	/** The episode playing here goes on elsewhere (its audio on Snapcast, #223): here it stops. */
	| { kind: 'handOver' }
	/** A kitchen timer in this browser (#60); one with the same name starts over. */
	| { kind: 'timer'; label: string; seconds: number }
	/** Waiting for something to be said («cuando hierva»): it is started by voice or a tap. */
	| { kind: 'prepareTimer'; label: string; seconds: number; trigger: string }
	/** The screen stays on in this browser (the phone on the kitchen wall), or no longer. */
	| { kind: 'kitchenMode'; on: boolean }
	/** That one by its name, or all of them with null. */
	| { kind: 'cancelTimer'; label: string | null }
	/** A recipe to cook here (#60), on that step (an index), instead of the one there was. */
	| { kind: 'recipe'; recipe: Recipe; step: number }
	/** The recipe here, on that step (an index). */
	| { kind: 'recipeStep'; step: number }
	| { kind: 'endRecipe' }
	/** The road mode's route (#78) to that place, from where we are; null, none. */
	| { kind: 'navigate'; place: Place | null }
	/** A stop on the way to the route on (#312), before its end, which stays; why, if said. */
	| { kind: 'addStop'; place: Place; reason: string | null }
	/** A stop of the route on, out, by its name as said; null, all of them. The end stays. */
	| { kind: 'removeStop'; name: string | null }
	/** A route kept in Viajes (#151), by its id: from where we are, through its stops ahead. */
	| { kind: 'route'; id: number }
	/** A photo with the road mode's camera (#81). */
	| { kind: 'photo' };

/** The longest timer: a day. */
export const MAX_TIMER_SEC = 24 * 3600;

/** «Para dentro de…»: at most a night. */
export const MAX_STOP_LATER_MIN = 12 * 60;

/** A choice when the order was not clear: tapped, its `command` is sent as if it had been said. */
export interface VoiceOption {
	label: string;
	command: string;
}

/** A turn of the conversation before, so that «no, eso no» means something. */
export interface VoiceTurn {
	role: 'user' | 'assistant';
	content: string;
}

/** The episode playing in this browser's player, and where: what «los últimos 5 minutos» are of. */
export interface VideoHere {
	episodeId: number;
	positionSec: number;
}

export interface VoiceRequest {
	text: string;
	/** What sounds on this device now, as the page shows it; null if nothing. */
	here: string | null;
	video: VideoHere | null;
	history: VoiceTurn[];
	/**
	 * This browser's timers, as it says them: «la pasta, quedan 7 min 5 s», or prepared, «el
	 * arroz, 30 min, preparado: arranca cuando esté hecho el sofrito».
	 */
	timers: string[];
	/** The recipe being cooked here, as recipe.ts describes it, and its step; null if none. */
	recipe: string | null;
	/** The film whose card is on this screen, to ask about it; null if none. */
	film: number | null;
	/** Said in the road mode (#78): driving, audio only, here only. */
	car: boolean;
	/** In the road mode, where we are (the GPS), for «llévame a…» and «¿dónde estoy?». */
	position: LngLat | null;
	/**
	 * In the road mode, the route on, described: «a Plaza de Zocodover, quedan 2,1 km», and its
	 * stops ahead (#312).
	 */
	navigation: string | null;
	/**
	 * In the road mode, the route ahead from where we are (road-guide.ts's `lineAhead`), to look
	 * along it (#312); null without one.
	 */
	ahead: LngLat[] | null;
}

export interface VoiceReply {
	/** Short, to be read aloud. */
	reply: string;
	actions: VoiceAction[];
	options: VoiceOption[];
	/** It asked something and waits for the answer (`FOLLOW_UP_MS`): it needs more to do it. */
	expectsAnswer: boolean;
	/**
	 * It did something by what it had learned there, not asked (nube's learned.ts): a satellite
	 * listens `AFTER_LEARNED_MS` without the wake word, for a «no, para la música». Not when it put
	 * something on: that would be heard instead.
	 */
	listenAfter?: boolean;
	/**
	 * A satellite in «Modo conversación» (#361, Ajustes): it listens `CONVERSATION_MS` after this
	 * answer, without the wake word, with a soft beep, and goes quiet without a sound if nothing is
	 * said. Not after a question (`expectsAnswer`) nor after putting something on.
	 */
	conversation?: boolean;
}

/**
 * After a question, how long the microphone listens for its answer by itself, without the wake word
 * or the button: the AI asked something and waits.
 */
export const FOLLOW_UP_MS = 8000;
/** After something done by what was learned, the satellite listens this long, for a correction. */
export const AFTER_LEARNED_MS = 5000;
/** In «Modo conversación» (#361), how long a satellite listens after any answer. */
export const CONVERSATION_MS = 5000;

/**
 * Whether an answer ends asking something («¿Es ahí?», «… ¿te lo pongo?»): then it waits for the
 * answer even if the AI did not say so (#361, phase 0).
 */
export const endsAsking = (text: string) => /\?[\s»"'”)]*$/.test(text.trim());

/**
 * The answer as it goes in the conversation: with a choice, its options and their orders, so that
 * «la segunda» or «el álbum» said next can be done.
 */
export function assistantTurn(reply: VoiceReply): VoiceTurn {
	const options = reply.options.map((o, i) => `${i + 1}. ${o.label}: «${o.command}»`).join('; ');
	return {
		role: 'assistant',
		content: options ? `${reply.reply} [Opciones: ${options}]` : reply.reply
	};
}

/** «Cómo es la voz de la casa», «Cómo quieres que te hable» (Ajustes): free text, this long at most. */
export const MAX_VOICE_STYLE = 500;

/**
 * Said when the family's AI has no credit left: by Seilide's voice, and kept recorded by each
 * satellite (#296), which cannot have it said then.
 */
export const SAID_NO_CREDIT =
	'Se ha acabado el crédito de la inteligencia artificial de la familia. Hay que recargarlo en OpenRouter.';

/** The turns before that are kept: the last exchanges are enough. */
export const HISTORY_TURNS = 6;
/**
 * Nothing said for this long, the conversation is over: the next order goes without the turns
 * before, as hours-old ones only confused the AI («those timers were already set»).
 */
export const HISTORY_IDLE_MS = 10 * 60_000;

/** The route ahead's points at most: 100 km, one every 500 m (road-guide.ts), and some spare. */
const MAX_AHEAD = 400;

/**
 * A point from a page: two numbers, on the Earth. As road.ts's isLngLat, here again: the satellite's
 * image copies only this file (satellite/Dockerfile), so it imports nothing but types.
 */
const isPoint = (value: unknown): value is LngLat =>
	Array.isArray(value) &&
	value.length === 2 &&
	value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
	Math.abs(value[0]) <= 180 &&
	Math.abs(value[1]) <= 90;

const text = (value: unknown, max: number) =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** A command from a page, only if it is well formed; the history, the last turns and valid ones. */
export function parseVoiceRequest(body: unknown): VoiceRequest | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const said = text(b.text, 500);
	if (!said) return null;
	const history = (Array.isArray(b.history) ? b.history : []).flatMap((turn: unknown) => {
		const t = turn as Record<string, unknown> | null;
		// An answer with its options (`assistantTurn`) is longer.
		const content = text(t?.content, t?.role === 'assistant' ? 1000 : 500);
		return (t?.role === 'user' || t?.role === 'assistant') && content
			? [{ role: t.role, content } as VoiceTurn]
			: [];
	});
	const v = b.video as Record<string, unknown> | null | undefined;
	const video =
		v &&
		Number.isInteger(v.episodeId) &&
		Number.isFinite(v.positionSec) &&
		Number(v.positionSec) >= 0
			? { episodeId: Number(v.episodeId), positionSec: Number(v.positionSec) }
			: null;
	return {
		text: said,
		here: text(b.here, 200),
		video,
		history: history.slice(-HISTORY_TURNS),
		timers: (Array.isArray(b.timers) ? b.timers : [])
			.flatMap((t: unknown) => text(t, 100) ?? [])
			.slice(0, 20),
		// Thirty steps of a few lines each, and the ingredients.
		recipe: text(b.recipe, 12_000),
		film: Number.isInteger(b.film) && Number(b.film) > 0 ? Number(b.film) : null,
		car: b.car === true,
		position: b.car === true && isPoint(b.position) ? [b.position[0], b.position[1]] : null,
		navigation: b.car === true ? text(b.navigation, 800) : null,
		ahead:
			b.car === true &&
			Array.isArray(b.ahead) &&
			b.ahead.length >= 2 &&
			b.ahead.length <= MAX_AHEAD &&
			b.ahead.every(isPoint)
				? (b.ahead as LngLat[])
				: null
	};
}
