import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			paths: {
				// adapter-node assumes https when it derives the origin from the Host header, which
				// breaks the CSRF check on plain-http LAN deployments. In dev, Vite knows the real one.
				origin: command === 'build' ? process.env.APP_ORIGIN || undefined : undefined
			}
		})
	]
}));
