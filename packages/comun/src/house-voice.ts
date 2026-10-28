import type { VoiceAction, VoiceRequest } from './voice.ts';

/**
 * The voice between the house and the cloud (#253): the brain (the AI, its instructions, the
 * family's tools) is in the cloud; the house keeps its hands (the music and the speakers, the
 * videos, the satellites' timers, what each one watched…). The house sends each order with what
 * only it knows (/api/casa/voz); the cloud asks it to do what only it can (/api/v1/voz), in that
 * order's name, while it lasts.
 */

/** A function the model can call, as OpenRouter takes it. */
export interface VoiceTool {
	type: 'function';
	function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A speaker of the house (Snapcast), by its name. */
export interface VoiceRoom {
	id: string;
	name: string;
}

/** What only the house knows, with each order. */
export interface HouseVoiceContext {
	/** The music library for the instructions: «- Artista: Álbum [álbum 3]; …», or the artists. */
	library: string[];
	playlists: { id: number; name: string; total: number }[];
	/** The whole house (Snapcast) can sound: not in the car, nor without it. */
	speakers: boolean;
	rooms: VoiceRoom[];
	/** A living room (its TV, mpv) to put videos on. */
	salon: boolean;
	/** Langua's longest clip, in minutes. */
	clipMinutes: number;
	/** How to read what each one watched (its tools' rules), and whether it is kept. */
	historyRules: string;
	keepHistory: boolean;
	/** «Hoy es lunes…», in the house's time. */
	today: string;
	/** What sounds now in each place, as said to the AI. */
	sounding: string;
	/** The episode on this device's player, as said to the AI; null, none. */
	watching: string | null;
	/** A satellite's timers, kept by the house; a phone's come in the request. */
	timers: string[];
	/** The house's satellites, to say where an alarm sounds. */
	satellites: { id: string; name: string }[];
	/** The house's own tools besides the usual (what each one watched, their Telegram). */
	tools: VoiceTool[];
}

/** An order, from the house to the cloud. */
export interface HouseVoiceOrder {
	/** This order, told apart from the next; the house's hands answer to it while it lasts. */
	order: string;
	request: VoiceRequest;
	/** Who speaks: their name (empty on a satellite) and whether it is a child's account. */
	who: { name: string; kid: boolean };
	satellite: { id: string; name: string } | null;
	house: HouseVoiceContext;
}

/** One of the house's tools, done there: what to tell the AI, and what the device must do. */
export interface HouseHandResult {
	result: string;
	actions: VoiceAction[];
	/** Done by the house as an action for the device would be (a satellite's timer). */
	done: number;
}

/** Where an order's time went, for the Registro. */
export interface VoiceTiming {
	/** Reading what the instructions list (albums, recipes…). */
	prepareMs: number;
	/** Each turn with the model: its time, its tokens (and how many were cached), its tools. */
	rounds: { ms: number; prompt: number; cached: number; completion: number; tools: string[] }[];
}
