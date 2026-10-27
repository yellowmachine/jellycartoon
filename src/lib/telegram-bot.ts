/**
 * The house's Telegram bot (#243): what it tells the family's group, each to be turned on or off
 * in Ajustes → Casa.
 */

export const BOT_EVENTS = {
	lista: 'Lista de la compra: lo que se añade y lo que se compra',
	nevera: 'Nevera: los post-its nuevos',
	agenda: 'Agenda: lo que se apunta, y sus avisos',
	avisos: 'Alarmas y temporizadores de la casa, al sonar'
} as const;

export type BotEvent = keyof typeof BOT_EVENTS;

export type BotEvents = Record<BotEvent, boolean>;

/** All on: whoever connects the bot wants to hear from it. */
export const DEFAULT_BOT_EVENTS: BotEvents = {
	lista: true,
	nevera: true,
	agenda: true,
	avisos: true
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

/** «🛒 María ha añadido a la lista: leche y pan»; «✓ Pepe ha comprado: leche». */
export function listSaid(who: string | null, verb: 'añadido' | 'comprado', items: string[]) {
	const what =
		items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items.at(-1)}` : (items[0] ?? '');
	if (verb === 'añadido') return `🛒 ${who ?? 'Alguien'} ha añadido a la lista: ${what}`;
	return `✓ ${who ?? 'Alguien'} ha comprado: ${what}`;
}
