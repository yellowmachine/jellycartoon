import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// Kit's own origin check would refuse the OpenID provider's token endpoint, which the
			// houses and apps call server to server, without an Origin (#284). checkCsrf in
			// src/hooks.server.ts does the same check, but not there.
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
