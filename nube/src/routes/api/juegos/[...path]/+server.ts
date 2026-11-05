import { error, type RequestHandler } from '@sveltejs/kit';
import { HouseProblem, passToHouse } from '#lib/server/house.ts';

/** What the browser's copy depends on, and what the house says of it. */
const ASKED = ['range', 'if-modified-since', 'content-type'];
const ANSWERED = [
	'content-type',
	'content-length',
	'content-range',
	'accept-ranges',
	'cache-control',
	'last-modified'
];

/** The game's files from the house (#405), as the player asks for them at home: the key stays here. */
const passOn: RequestHandler = async ({ params, url, request, locals }) => {
	const headers = new Headers({ 'accept-encoding': 'identity' });
	for (const name of ASKED) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
	const prefix = url.pathname.startsWith('/api/fondo/') ? 'fondo/' : '';
	try {
		const answer = await passToHouse(
			locals.user!.id,
			locals.user!.email,
			`/juegos/${prefix}${params.path ?? params.id}`,
			{
				method: request.method,
				headers,
				body: hasBody ? await request.arrayBuffer() : undefined,
				signal: request.signal
			}
		);
		const out = new Headers();
		for (const name of ANSWERED) {
			const value = answer.headers.get(name);
			if (value) out.set(name, value);
		}
		return new Response(answer.body, { status: answer.status, headers: out });
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};

export const GET = passOn;
export const POST = passOn;
export const PUT = passOn;
export const DELETE = passOn;
