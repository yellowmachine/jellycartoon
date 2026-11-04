import type { RequestHandler } from './$types';
import { houseAiKeyInfo } from '#lib/server/app-ai.ts';

/** The family's key's limit and spending, as OpenRouter's `/key`: for the house's Ajustes. */
export const GET: RequestHandler = ({ request }) => houseAiKeyInfo(request);
