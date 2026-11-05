import type { PageServerLoad } from './$types';
import { gamePage } from '#lib/server/game-pages.ts';

export const load: PageServerLoad = ({ params, locals }) => gamePage(params, locals.user!.id);
