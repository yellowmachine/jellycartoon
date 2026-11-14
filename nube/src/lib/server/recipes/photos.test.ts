import { describe, expect, mock, test } from 'bun:test';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * A recipe's picture from the favourite sites (photos.ts): the search and the pages faked, as the
 * sites would answer.
 */

const pages: Record<string, string> = {
	'https://recetas.ejemplo.es/sin-foto': '<html><head><title>Sin foto</title></head></html>',
	'https://recetas.ejemplo.es/tortilla': `<html><head>
		<meta property="og:image" content="/img/og-tortilla.jpg">
		<script type="application/ld+json">{"@type":"Recipe","name":"Tortilla","image":"https://cdn.ejemplo.es/tortilla.jpg","recipeIngredient":["huevos"],"recipeInstructions":["Bate"]}</script>
	</head></html>`,
	'https://otra.ejemplo.es/tortilla': `<html><head>
		<meta property="og:image" content="/img/og-tortilla.jpg">
	</head></html>`
};
let found: string[] = [];

mock.module('#lib/server/recipes/sites.ts', () => ({
	searchRecipeSites: async () => found.map((url) => ({ url, title: '', site: '' }))
}));
mock.module('#lib/server/public-fetch.ts', () => ({
	fetchPublic: async (url: string) => {
		if (!(url in pages)) throw new Error('No contesta');
		return { url, body: pages[url], contentType: 'text/html' };
	}
}));

// Not used here: the family's storage, and the file kinds' module (with the database).
mock.module('#lib/server/storage.ts', () => ({
	putFile: async () => {},
	removeFile: async () => {}
}));
mock.module('#lib/server/expenses/income.ts', () => ({ kindOf: () => null }));

const { findPicture, pictureOf } = await import('./photos.ts');
const k = {} as Kitchen;

describe('findPicture', () => {
	test('the Recipe’s own image, before og:image', async () => {
		found = ['https://recetas.ejemplo.es/tortilla'];
		expect(await findPicture(k, 'tortilla')).toBe('https://cdn.ejemplo.es/tortilla.jpg');
	});

	test('og:image, made whole against its page, when the page has no Recipe', async () => {
		found = ['https://otra.ejemplo.es/tortilla'];
		expect(await findPicture(k, 'tortilla')).toBe('https://otra.ejemplo.es/img/og-tortilla.jpg');
	});

	test('past the pages with none, or that fail, to the first with one', async () => {
		found = [
			'https://recetas.ejemplo.es/no-contesta',
			'https://recetas.ejemplo.es/sin-foto',
			'https://otra.ejemplo.es/tortilla'
		];
		expect(await findPicture(k, 'tortilla')).toBe('https://otra.ejemplo.es/img/og-tortilla.jpg');
	});

	test('nothing found on the sites: null', async () => {
		found = [];
		expect(await findPicture(k, 'macarrones de la abuela')).toBeNull();
	});
});

describe('pictureOf', () => {
	test('its own photo over the site’s, with its name so a new one is not cached', () => {
		expect(pictureOf({ id: 3, photo: 'a.jpg', imageUrl: 'https://x/y.jpg' })).toBe(
			'/recetas/fotos/3?v=a.jpg'
		);
		expect(pictureOf({ id: 3, photo: null, imageUrl: 'https://x/y.jpg' })).toBe('https://x/y.jpg');
		expect(pictureOf({ id: 3, photo: null, imageUrl: null })).toBeNull();
	});
});
