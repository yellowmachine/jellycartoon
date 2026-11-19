import type { BackupTransport } from './backup.ts';

/** Mensajes (#551): the device's side of /api/mensajes/copia. */
async function call<T>(body: object): Promise<T> {
	const res = await fetch('/api/mensajes/copia', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const answer = await res.json().catch(() => null);
	if (!res.ok) throw new Error(answer?.message ?? 'Sin conexión');
	return answer as T;
}

export const httpBackup: BackupTransport = {
	status: () => call({ action: 'estado' }),
	evaluate: async (blinded) =>
		(await call<{ evaluation: string }>({ action: 'evaluar', blinded })).evaluation,
	create: (c) => call({ action: 'crear', ...c }),
	open: (proof) => call({ action: 'abrir', proof }),
	save: (c) => call({ action: 'guardar', ...c }),
	forget: () => call({ action: 'olvidar' })
};
