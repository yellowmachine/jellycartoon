import { afterEach, expect, test } from 'bun:test';
import { fetchPublic } from './public-fetch.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
const HOST = 'https://93.184.216.34';

function answering(...answers: Response[]) {
	const asked: { url: string; init: RequestInit }[] = [];
	globalThis.fetch = (async (url: URL, init: RequestInit) => {
		asked.push({ url: String(url), init });
		return answers.shift()!;
	}) as unknown as typeof fetch;
	return asked;
}
const redirect = (location: string) => new Response('', { status: 302, headers: { location } });

test('redirects followed, each checked', async () => {
	const asked = answering(redirect('https://1.1.1.1/'), new Response('hola'));
	const page = await fetchPublic(HOST, { maxBytes: 100 });
	expect(page.body).toBe('hola');
	expect(asked).toHaveLength(2);
	answering(redirect('https://10.0.0.1/'));
	await expect(fetchPublic(HOST, { maxBytes: 100 })).rejects.toThrow('no es de internet');
});

test('with `redirects: false`, what carries a secret never goes to another address', async () => {
	const asked = answering(redirect('https://1.1.1.1/'));
	await expect(
		fetchPublic(HOST, { maxBytes: 100, redirects: false, headers: { 'x-auth-token': 'k' } })
	).rejects.toThrow('redirige');
	expect(asked).toHaveLength(1);
});

test('a method and a body; a 204, empty', async () => {
	const asked = answering(new Response(null, { status: 204 }));
	const res = await fetchPublic(HOST, { method: 'PUT', body: '{}', maxBytes: 100 });
	expect(res.body).toBe('');
	expect(asked[0]!.init.method).toBe('PUT');
	expect(asked[0]!.init.body).toBe('{}');
});
