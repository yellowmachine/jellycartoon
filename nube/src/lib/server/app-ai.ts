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
		return { ok: false, status: 401, message: 'Falta el token de Seilide' };
	let familyId: unknown;
	try {
		const info = await auth.api.oauth2UserInfo({ headers: new Headers({ authorization }) });
		familyId = (info as Record<string, unknown>)[FAMILY_CLAIM];
	} catch {
		return { ok: false, status: 401, message: 'Seilide no acepta ese token' };
	}
	if (typeof familyId !== 'string')
		return { ok: false, status: 403, message: 'Esta app no es para familias: no tiene IA' };
	const apiKey = await openRouterKey(houseKitchen(familyId));
	if (!apiKey)
		return {
			ok: false,
			status: 403,
			message: 'Tu familia no tiene clave de OpenRouter: ponla en Ajustes de Seilide'
		};
	return { ok: true, apiKey };
}

/** What an app asked (#284), to OpenRouter: its JSON body and `X-Title`, its name for Gastos → IA. */
export type AppForward = (request: {
	apiKey: string;
	label: string;
	body: Record<string, unknown>;
	signal: AbortSignal;
}) => Promise<Response>;

/**
 * An app's request to /api/ia (the chat, the speech): the person's token checked, its JSON body and
 * its name (`X-Title`, as OpenRouter takes it) passed to `forward`; refused, in OpenAI's shape.
 */
export async function appAiRequest(request: Request, forward: AppForward): Promise<Response> {
	const ai = await appAiKey(request);
	if (!ai.ok)
		return Response.json(
			{ error: { message: ai.message, code: ai.status } },
			{
				status: ai.status,
				headers: ai.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined
			}
		);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || Array.isArray(body))
		return Response.json({ error: { message: 'Se esperaba JSON', code: 400 } }, { status: 400 });
	const label = (request.headers.get('x-title') ?? '').trim().slice(0, 60) || 'App';
	return forward({ apiKey: ai.apiKey, label, body, signal: request.signal });
}
