import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sseResponse } from '#lib/server/sse.ts';
import { watchWishes } from '#lib/server/wishes.ts';

/**
 * That the family's wishes have changed, live: only that. The page loads them again, so what each
 * one may see (a secret gift, a child's list) is decided in one place.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	return sseResponse<'changed'>(request, (listener) =>
		watchWishes(familyId, () => listener('changed'))
	);
};
