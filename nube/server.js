/**
 * Seilide's server in production: adapter-node's own (build/index.js: the port, the graceful
 * shutdown, everything as before), plus the smart plugs' WebSocket (#396), which SvelteKit has not.
 * A Shelly connects by itself to `/api/enchufe/<token>` (its outbound WebSocket) and is handed to
 * the hub (src/lib/server/plugs/hub.ts), which hooks.server.ts left on globalThis when the app
 * started. Any other upgrade is refused. In development, the same is done by vite.config.ts.
 */
import { WebSocketServer } from 'ws';
import { server } from './build/index.js';

/** As plugAddress in src/lib/plugs.ts; the hub checks the token again. */
const PLUG_URL = /^\/api\/enchufe\/([\w-]{43})$/;
const HUB_KEY = Symbol.for('seilide.enchufes');

// A plug's frames are small (its whole state, about 1.5 KB).
const plugs = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
	const token = req.url?.match(PLUG_URL)?.[1];
	const hub = globalThis[HUB_KEY];
	if (!token || !hub) return socket.destroy();
	plugs.handleUpgrade(req, socket, head, (ws) => void hub.attach(token, ws));
});
