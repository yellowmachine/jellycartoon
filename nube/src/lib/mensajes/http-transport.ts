import type { Transport } from './messenger.ts';

/** Mensajes (#551): the device's side of /api/mensajes. */
async function call<T>(body: object): Promise<T> {
	const res = await fetch('/api/mensajes', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new Error(answer?.message ?? 'Sin conexión');
	return answer as T;
}

export const httpTransport: Transport = {
	register: (d) =>
		call({ action: 'aparato', deviceId: d.id, name: d.name, keyPackages: d.keyPackages }),
	familyConversation: (deviceId) => call({ action: 'familia', deviceId }),
	pairConversation: (deviceId, otherId) => call({ action: 'pareja', deviceId, otherId }),
	conversations: (deviceId) => call({ action: 'conversaciones', deviceId }),
	conversation: (deviceId, conversationId) =>
		call({ action: 'conversacion', deviceId, conversationId }),
	claim: (deviceId, conversationId, deviceIds) =>
		call({ action: 'llaves', deviceId, conversationId, deviceIds }),
	commit: (deviceId, c) => call({ action: 'cambio', deviceId, ...c }),
	send: (deviceId, m) => call({ action: 'enviar', deviceId, ...m }),
	events: async (deviceId, since) => {
		const res = await fetch(`/api/mensajes?aparato=${encodeURIComponent(deviceId)}&desde=${since}`);
		const answer = await res.json().catch(() => null);
		if (!res.ok) throw new Error(answer?.message ?? 'Sin conexión');
		return answer;
	}
};
