import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gameShader } from '#lib/server/db/schema.ts';
import { ALL, gameScope, isShader, systemScope, type Shader } from '#lib/game-shaders.ts';

/** Every one set, by where. */
export async function shaders() {
	const rows = await db.select().from(gameShader);
	return Object.fromEntries(
		rows.filter((r) => isShader(r.shader)).map((r) => [r.scope, r.shader])
	) as Record<string, Shader>;
}

/**
 * A game's own, if it has one, and the one it has without it: its console's, else the one for all,
 * else none.
 */
export async function shaderFor(system: string, gameId: number) {
	const set = await shaders();
	return {
		own: set[gameScope(gameId)] ?? null,
		inherited: set[systemScope(system)] ?? set[ALL] ?? ('disabled' as Shader)
	};
}

/** One for there; none (null) leaves it to the one above. */
export async function setShader(scope: string, shader: Shader | null) {
	if (!shader) await db.delete(gameShader).where(eq(gameShader.scope, scope));
	else
		await db
			.insert(gameShader)
			.values({ scope, shader })
			.onConflictDoUpdate({ target: gameShader.scope, set: { shader } });
}
