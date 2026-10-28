/**
 * The family's Telegram bot (#253; jellycartoon's #243): what it tells the family's group, each to
 * be turned on or off in Ajustes.
 */

export const BOT_EVENTS = {
	agenda: 'Agenda: lo que se apunta, y sus avisos',
	alarmas: 'Alarmas de la casa, al sonar',
	temporizadores: 'Temporizadores de la casa, al sonar'
} as const;

export type BotEvent = keyof typeof BOT_EVENTS;

export type BotEvents = Record<BotEvent, boolean>;

export const isBotEvent = (value: unknown): value is BotEvent =>
	typeof value === 'string' && value in BOT_EVENTS;

/** All on: whoever connects the bot wants to hear from it. */
export const DEFAULT_BOT_EVENTS: BotEvents = {
	agenda: true,
	alarmas: true,
	temporizadores: true
};

export function parseBotEvents(value: unknown): BotEvents {
	const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(BOT_EVENTS).map((k) => [
			k,
			v[k] === undefined ? DEFAULT_BOT_EVENTS[k as BotEvent] : v[k] === true
		])
	) as BotEvents;
}
