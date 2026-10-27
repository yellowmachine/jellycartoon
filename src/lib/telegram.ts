/**
 * Telegram in the road mode (#243): a message that came to the person's own account, as the server
 * passes it to their phone, and how it is said aloud to whoever drives.
 */

export type TelegramKind =
	| 'texto'
	| 'foto'
	| 'nota de voz'
	| 'audio'
	| 'vídeo'
	| 'pegatina'
	| 'archivo'
	| 'ubicación'
	| 'otro';

export interface TelegramMessage {
	/** To mark it read once said (`chat:id`). */
	key: string;
	/** Who sent it, as the account has them: «Ana». */
	from: string;
	/** A group's name; null, a private chat. */
	chat: string | null;
	/** Its words; null, only something else (a photo…). */
	text: string | null;
	kind: TelegramKind;
	at: number;
}

/** Longer than this, read only its start: whoever drives does not want a letter. */
export const SAID_CHARS = 400;

const WHAT: Record<Exclude<TelegramKind, 'texto'>, string> = {
	foto: 'una foto',
	'nota de voz': 'una nota de voz',
	audio: 'un audio',
	vídeo: 'un vídeo',
	pegatina: 'una pegatina',
	archivo: 'un archivo',
	ubicación: 'una ubicación',
	otro: 'algo'
};

/**
 * «Mensaje de Ana: llego en diez minutos»; «Ana, en Familia: …»; «Ana te ha mandado una foto»
 * (and its words, if it has them).
 */
export function telegramSaid(m: TelegramMessage) {
	const who = m.chat ? `${m.from}, en ${m.chat}` : m.from;
	const words = m.text
		? m.text.length > SAID_CHARS
			? `${m.text.slice(0, SAID_CHARS)}… y sigue`
			: m.text
		: null;
	if (m.kind === 'texto') return `Mensaje de ${who}: ${words ?? ''}`;
	const sent = `${who} te ha mandado ${WHAT[m.kind]}`;
	return words ? `${sent}: ${words}` : `${sent}.`;
}
