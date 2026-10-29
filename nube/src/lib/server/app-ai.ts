import { auth } from './auth.ts';
import { openRouterKey } from './family-settings.ts';
import { houseKitchen } from './fridge.ts';
import { FAMILY_CLAIM } from './oidc-claims.ts';

/**
 * The AI for the apps of families (#284: Langua): they ask the cloud, with the person's access
 * token, and the cloud asks OpenRouter with the family's key, which never leaves it. The token is
 * checked by the provider's own userinfo, which says whose it is and, with the `family` scope
 * (app-clients.ts), of what family: without it, no AI, since the family pays.
 */
export type AppAi = { ok: true; apiKey: string } | { ok: false; status: number; message: string };

export async function appAiKey(request: Request): Promise<AppAi> {
	const authorization = request.headers.get('authorization') ?? '';
	if (!/^Bearer\s+\S/i.test(authorization))
		return { ok: false, status: 401, message: 'Falta el token de la nube' };
	let familyId: unknown;
	try {
		const info = await auth.api.oauth2UserInfo({ headers: new Headers({ authorization }) });
		familyId = (info as Record<string, unknown>)[FAMILY_CLAIM];
	} catch {
		return { ok: false, status: 401, message: 'La nube no acepta ese token' };
	}
	if (typeof familyId !== 'string')
		return { ok: false, status: 403, message: 'Esta app no es para familias: no tiene IA' };
	const apiKey = await openRouterKey(houseKitchen(familyId));
	if (!apiKey)
		return {
			ok: false,
			status: 403,
			message: 'Tu familia no tiene clave de OpenRouter: ponla en Ajustes de la nube'
		};
	return { ok: true, apiKey };
}
