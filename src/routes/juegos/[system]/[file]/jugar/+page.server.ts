import type { PageServerLoad } from './$types';
import { playerPage } from '#lib/server/game-pages.ts';

export const load: PageServerLoad = ({ params, locals }) => playerPage(params, locals.user!.id);
