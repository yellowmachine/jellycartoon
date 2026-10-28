import { afterEach, expect, test } from 'bun:test';
import { isMapShare, sharedPlace } from './shared-place.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Each address asked for, answered with a redirect to the next one. */
function redirects(to: Record<string, string>) {
	globalThis.fetch = (async (input: string | URL | Request) => {
		const location = to[String(input)];
		return new Response(null, location ? { status: 302, headers: { location } } : { status: 404 });
	}) as typeof fetch;
}

test('what is a map share, and what a recipe', () => {
	expect(isMapShare('Casa Pepe https://maps.app.goo.gl/abc')).toBe(true);
	expect(isMapShare('https://www.google.com/maps/place/40.4168,-3.7038')).toBe(true);
	expect(isMapShare('40.4168, -3.7038')).toBe(true);
	expect(isMapShare('https://www.recetasderechupete.com/tortilla/')).toBe(false);
	expect(isMapShare('https://www.google.com/search?q=tortilla')).toBe(false);
	expect(isMapShare('Mira esta receta')).toBe(false);
});

test("a place from Google Maps' phone app: no coordinates, its name and address to search", async () => {
	redirects({
		'https://maps.app.goo.gl/abc':
			'https://www.google.com/maps/place/Casa+Pepe,+Calle+Mayor,+5,+45001+Toledo/data=!4m2!3m1!1s0x1:0x2?entry=gps'
	});
	expect(await sharedPlace('https://maps.app.goo.gl/abc')).toEqual({
		name: 'Casa Pepe',
		at: null,
		search: 'Casa Pepe, Calle Mayor, 5, 45001 Toledo'
	});
});

test("through Google's cookie notice, to a pin", async () => {
	const place =
		'https://www.google.com/maps/place/Puerta+del+Sol/@40.4169,-3.7035,17z/data=!8m2!3d40.4168!4d-3.7038';
	redirects({
		'https://maps.app.goo.gl/sol': `https://consent.google.com/ml?continue=${encodeURIComponent(place)}&gl=ES`
	});
	expect(await sharedPlace('Puerta del Sol\nhttps://maps.app.goo.gl/sol')).toEqual({
		name: 'Puerta del Sol',
		at: [-3.7038, 40.4168],
		search: null
	});
});

test('a short link that goes out of Google: nothing', async () => {
	redirects({ 'https://maps.app.goo.gl/bad': 'http://192.168.1.1/admin' });
	expect(await sharedPlace('https://maps.app.goo.gl/bad')).toBeNull();
});

test('plain coordinates', async () => {
	expect(await sharedPlace('40.4168, -3.7038')).toEqual({
		name: null,
		at: [-3.7038, 40.4168],
		search: null
	});
});
