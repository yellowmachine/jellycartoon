// Production entry point: reads ORIGIN at startup, so the same image works at any address.
//
// adapter-node builds each request's URL from the Host header and assumes https unless
// PROTOCOL_HEADER says otherwise. On a plain-http deployment that URL doesn't match the browser's
// Origin and SvelteKit's CSRF check rejects every form (403). Here every request gets the protocol
// of ORIGIN; the host still comes from the request, so http://localhost:3000 also works.

import type { Server } from 'node:http';

const PROTOCOL_HEADER = 'x-jellycartoon-protocol';

const origin = process.env.ORIGIN;
if (!origin) throw new Error('ORIGIN is required, e.g. http://192.168.1.10:3000');
const protocol = new URL(origin).protocol.slice(0, -1);

process.env.PROTOCOL_HEADER = PROTOCOL_HEADER;
// Only exists after `bun run build`, hence the variable (no compile-time resolution).
const entry = '../build/index.js';
const { server }: { server: Server } = await import(entry);

// Runs before adapter-node's own listener; also overwrites any value sent by the client.
server.prependListener('request', (req) => {
	req.headers[PROTOCOL_HEADER] = protocol;
});
