import type { PageServerLoad } from './$types';
import { consolePage } from '#lib/server/game-pages.ts';

export const load: PageServerLoad = ({ params }) => consolePage(params.system);
