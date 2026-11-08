import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { WebSocketServer } from 'ws';

/**
 * The smart plugs' WebSocket (#396) in development, as server.js does in production: SvelteKit has
 * none. Until the app has answered its first request, hooks.server.ts has not left the hub, so a
 * plug is refused and tries again by itself. Vite's own (HMR) is another protocol, left alone.
 */
function plugSockets(): Plugin {
	const PLUG_URL = /^\/api\/enchufe\/([\w-]{43})$/;
	const HUB_KEY = Symbol.for('seilide.enchufes');
	return {
		name: 'seilide-enchufes',
		configureServer(server) {
			const plugs = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
			server.httpServer?.on('upgrade', (req, socket, head) => {
				const token = req.url?.match(PLUG_URL)?.[1];
				if (!token) return;
				const hub = (
					globalThis as Record<symbol, { attach(t: string, ws: unknown): void } | undefined>
				)[HUB_KEY];
				if (!hub) return socket.destroy();
				plugs.handleUpgrade(req, socket, head, (ws) => void hub.attach(token, ws));
			});
		}
	};
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		plugSockets(),
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
