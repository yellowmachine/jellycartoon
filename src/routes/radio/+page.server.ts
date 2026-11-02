import type { PageServerLoad } from './$types';
import { stationsInfo } from '#lib/server/radio.ts';

export const load: PageServerLoad = async () => ({ info: await stationsInfo() });
