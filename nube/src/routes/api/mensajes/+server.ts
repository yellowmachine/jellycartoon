import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { messages, noticeOthers, tellNew } from '#lib/server/messages.ts';
import { MessagesProblem } from '#lib/server/messages-scope.ts';

/**
 * Mensajes (#551): what a device asks of the delivery service, always with its id (theirs, checked).
 * Everything that comes and goes is encrypted by the devices.
 */
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : -1);

async function handled<T>(fn: () => Promise<T>) {
	try {
		return json(await fn());
	} catch (err) {
		if (err instanceof MessagesProblem) error(400, err.message);
		throw err;
	}
}

/** What this device has not read yet. */
export const GET: RequestHandler = async ({ url, locals }) =>
	handled(() =>
		messages.events(
			locals.user!.id,
			url.searchParams.get('aparato') ?? '',
			Number(url.searchParams.get('desde')) || 0
		)
	);

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const b = await request.json().catch(() => null);
	if (!b || typeof b !== 'object') error(400, 'Orden no válida');
	const deviceId = str(b.deviceId);
	switch (b.action) {
		case 'aparato':
			return handled(() =>
				messages.registerDevice(userId, {
					id: deviceId,
					name: str(b.name),
					keyPackages: Array.isArray(b.keyPackages) ? b.keyPackages : []
				})
			);
		case 'familia':
			return handled(() => messages.familyConversation(userId, deviceId));
		case 'conversacion':
			return handled(() => messages.conversation(userId, deviceId, str(b.conversationId)));
		case 'llaves':
			return handled(() =>
				messages.claimKeyPackages(
					userId,
					deviceId,
					str(b.conversationId),
					Array.isArray(b.deviceIds) ? b.deviceIds.map(str) : []
				)
			);
		case 'cambio':
			return handled(async () => {
				const r = await messages.postCommit(userId, deviceId, {
					conversationId: str(b.conversationId),
					epoch: int(b.epoch),
					commit: str(b.commit),
					...(typeof b.welcome === 'string'
						? {
								welcome: b.welcome,
								recipients: Array.isArray(b.recipients) ? b.recipients.map(str) : []
							}
						: {})
				});
				if (r.ok) tellNew(r.familyId);
				return { ok: r.ok, epoch: r.epoch };
			});
		case 'enviar':
			return handled(async () => {
				const conversationId = str(b.conversationId);
				const sent = await messages.postMessage(userId, deviceId, {
					conversationId,
					epoch: int(b.epoch),
					data: str(b.data)
				});
				tellNew(sent.familyId);
				void noticeOthers(userId, sent.familyId, conversationId, sent.to).catch((err) =>
					console.warn('[mensajes] Aviso no mandado', err)
				);
				return { id: sent.id };
			});
		case 'quitar':
			return handled(() => messages.revokeDevice(userId, str(b.target)));
	}
	error(400, 'Orden no válida');
};
