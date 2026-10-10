import { asc, eq } from 'drizzle-orm';
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { appSetting, user } from '#lib/server/db/schema.ts';

/** Cheap, fast and knows films well; changeable in Ajustes. */
export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

type Key = 'openrouter_api_key' | 'openrouter_model';

async function get(key: Key) {
	const [row] = await db
		.select({ value: appSetting.value })
		.from(appSetting)
		.where(eq(appSetting.key, key));
	return row?.value ?? null;
}

/** `null` deletes it. */
export async function setAppSetting(key: Key, value: string | null) {
	if (value === null) {
		await db.delete(appSetting).where(eq(appSetting.key, key));
		return;
	}
	await db
		.insert(appSetting)
		.values({ key, value, updatedAt: new Date() })
		.onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
}

/** The key in .env wins over the one in Ajustes, like the rest of the deploy configuration. */
export async function openRouterConfig() {
	const panelKey = await get('openrouter_api_key');
	const panelModel = await get('openrouter_model');
	return {
		apiKey: OPENROUTER_API_KEY ?? panelKey,
		keySource: OPENROUTER_API_KEY ? ('env' as const) : panelKey ? ('panel' as const) : null,
		model: panelModel ?? OPENROUTER_MODEL ?? DEFAULT_MODEL
	};
}

/** There are no roles: the first account created is the one that manages the app. */
export async function isAdmin(userId: string) {
	const [first] = await db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).limit(1);
	return first?.id === userId;
}
