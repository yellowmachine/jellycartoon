import type { PageServerLoad } from './$types';
import { sampleCounts } from '#lib/server/wakeword-samples.ts';

export const load: PageServerLoad = async () => ({ counts: await sampleCounts() });
