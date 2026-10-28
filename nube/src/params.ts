import { defineParams } from '@sveltejs/kit/params';
import { PENDING } from '#lib/nav.ts';

/** The URL params' matchers (SvelteKit 3: https://svelte.dev/docs/kit/advanced-routing#Matching). */
export const params = defineParams({
	/** The sections still at home but moving to the cloud (nav.ts), each with its page saying so. */
	pendiente: (param) => (PENDING.includes(param) ? param : undefined)
});
