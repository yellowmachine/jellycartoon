import type { Tool } from '#lib/server/openrouter.ts';
import { cancelSend, confirmSend, prepareSend, telegramOf } from '#lib/server/telegram/telegram.ts';

/**
 * The voice's Telegram (#243): messages with the person's own account, only where it is known who
 * speaks (not a satellite) and only after their «sí», which the server asks for, not the AI. The
 * family's group, with its bot, is the cloud's (#253): it says things there itself.
 */

export const TELEGRAM_TOOLS = new Set(['telegram_send', 'telegram_confirm']);

const fn = (name: string, description: string, properties: object, required: string[]): Tool => ({
	type: 'function',
	function: {
		name,
		description,
		parameters: { type: 'object', properties, required, additionalProperties: false }
	}
});

/** Those that make sense for who speaks: their account connected. */
export async function telegramTools(userId: string, satellite: boolean): Promise<Tool[]> {
	const account = satellite ? null : await telegramOf(userId);
	return [
		...(account
			? [
					fn(
						'telegram_send',
						'Prepara un mensaje de Telegram de su cuenta a un contacto o un grupo («dile a Ana que llego en diez minutos», «contesta a Ana que voy de camino»). No lo envía: después pregúntale con «ask» si lo envía, diciendo a quién y qué, y espera su respuesta.',
						{
							to: {
								type: 'string',
								description: 'A quién, como lo dice: «Ana», «el grupo de la familia».'
							},
							text: {
								type: 'string',
								description:
									'El mensaje, escrito como lo mandaría esa persona, en primera persona: «Llego en diez minutos».'
							}
						},
						['to', 'text']
					),
					fn(
						'telegram_confirm',
						'Con su respuesta a la pregunta de telegram_send: envía el mensaje preparado si ha dicho que sí, o lo olvida si ha dicho que no. Solo con su respuesta, nunca en la misma orden en que se preparó.',
						{ send: { type: 'boolean', description: 'true si ha dicho que sí.' } },
						['send']
					)
				]
			: [])
	];
}

/** One of `TELEGRAM_TOOLS`, run: in words for the model. */
export async function runTelegramTool(
	name: string,
	args: Record<string, unknown>,
	ctx: { userId: string; satellite: string | null; order: string }
): Promise<string> {
	const text = typeof args.text === 'string' ? args.text.trim().slice(0, 1000) : '';
	switch (name) {
		case 'telegram_send': {
			if (ctx.satellite)
				return 'Desde un satélite no se mandan mensajes de la cuenta de nadie: no se sabe quién habla. Para el grupo de la familia, group_say.';
			const to = typeof args.to === 'string' ? args.to.trim() : '';
			if (!to || !text) return 'Falta a quién o qué.';
			const prepared = await prepareSend(ctx.userId, to, text, ctx.order);
			switch (prepared.status) {
				case 'off':
					return 'Su Telegram no está conectado ahora.';
				case 'none':
					return `No encuentro a «${to}» entre sus chats de Telegram. Díselo.`;
				case 'choose':
					return `Hay varios parecidos: ${prepared.options.join('; ')}. Pregúntale cuál con «ask».`;
				case 'ready':
					return `Preparado para ${prepared.group ? 'el grupo' : ''} «${prepared.to}»${prepared.reply ? ' (como respuesta a su último mensaje)' : ''}: «${text}». Ahora pregúntale con «ask» si lo envía, con opciones «Sí» (orden «sí, envíalo») y «No» (orden «no, no lo envíes»), diciendo a quién y qué; no lo envíes sin su respuesta.`;
			}
			return 'No se pudo preparar.';
		}
		case 'telegram_confirm': {
			if (args.send !== true) {
				cancelSend(ctx.userId);
				return 'No se envía: olvidado.';
			}
			try {
				return `Enviado a «${await confirmSend(ctx.userId, ctx.order)}».`;
			} catch (err) {
				return err instanceof Error ? err.message : String(err);
			}
		}
	}
	return `No existe la herramienta «${name}».`;
}
