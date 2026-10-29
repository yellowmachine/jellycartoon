import { randomUUID } from 'node:crypto';
import { todayText } from 'comun/clock.ts';
import type { HouseVoiceOrder } from 'comun/house-voice.ts';
import type { VoiceRequest } from 'comun/voice.ts';

/**
 * An order said to Seilide without the house (#253): a family that has none, or whose house does
 * not answer. What the house would send with it (house-voice.ts), as a house with nothing: no
 * music, no speakers, no satellites, none of its tools. Who speaks is an adult, as all Seilide's.
 */
export function orderWithoutHouse(request: VoiceRequest, name: string): HouseVoiceOrder {
	return {
		order: randomUUID(),
		request,
		who: { name, kid: false },
		satellite: null,
		house: {
			library: [],
			playlists: [],
			speakers: false,
			rooms: [],
			salon: false,
			clipMinutes: 0,
			historyRules: '',
			// Nothing kept nor asked: without the line about «Guardar lo que veo».
			keepHistory: true,
			today: todayText(),
			sounding: `[Ahora suena. Aquí: ${request.here ?? 'nada'}.]`,
			watching: null,
			timers: [],
			satellites: [],
			tools: []
		}
	};
}

/** Said to the AI with each order: why there is no music, and what to say if it is asked for. */
export const NO_HOUSE =
	'[Esta familia no tiene casa conectada (jellycartoon, con su música y sus vídeos): no hay música, radio, vídeos ni altavoces. Si lo pide, dile corto que eso necesita la casa.]';

/** The same, when it has one that does not answer now. */
export const HOUSE_DOWN =
	'[La casa de esta familia no contesta ahora: no hay música, radio, vídeos ni altavoces. Si lo pide, dile corto que la casa no responde.]';
