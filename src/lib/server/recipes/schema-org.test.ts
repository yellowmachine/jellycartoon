import { describe, expect, test } from 'bun:test';
import { findRecipe, normalizeRecipe, readPage } from './schema-org.ts';

/** As WordPress recipe plugins write it: in an @graph, with sections and entities. */
const page = `<!doctype html><html><head>
<title>Macarrones gratinados | Recetas de prueba</title>
<meta property="og:site_name" content="Recetas de prueba">
<meta property="og:image" content="https://example.com/og.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"WebPage","name":"Macarrones"},
 {"@type":["Recipe"],"name":"Macarrones gratinados &amp; bechamel","recipeYield":["4","4 raciones"],
  "image":[{"@type":"ImageObject","url":"https://example.com/macarrones.jpg"}],
  "recipeIngredient":["400 g de macarrones","1 cebolla","<b>100 g</b> de queso rallado"],
  "recipeInstructions":[
   {"@type":"HowToSection","name":"La pasta","itemListElement":[
     {"@type":"HowToStep","text":"Cuece los macarrones 10 minutos en agua con sal."}]},
   {"@type":"HowToStep","text":"Gratina 15 minutos a 200&#176;C."}]}
]}</script>
<script type="application/ld+json">{ roto</script>
</head><body><nav>Inicio Recetas</nav><h1>Macarrones gratinados</h1><p>Un clásico de casa.</p>
<script>var x = 1;</script><footer>© Recetas</footer></body></html>`;

describe('readPage', () => {
	test('the JSON-LD that parses, the site and its text without menus', async () => {
		const read = await readPage(page);
		expect(read.jsonLd).toHaveLength(1);
		expect(read.siteName).toBe('Recetas de prueba');
		expect(read.title).toBe('Macarrones gratinados | Recetas de prueba');
		expect(read.imageUrl).toBe('https://example.com/og.jpg');
		expect(read.text).toBe('Macarrones gratinados Un clásico de casa.');
	});
});

describe('findRecipe and normalizeRecipe', () => {
	test('in an @graph, with sections, entities and tags', async () => {
		const recipe = normalizeRecipe(findRecipe((await readPage(page)).jsonLd)!);
		expect(recipe).toEqual({
			title: 'Macarrones gratinados & bechamel',
			servings: 4,
			ingredients: ['400 g de macarrones', '1 cebolla', '100 g de queso rallado'],
			instructions: [
				'Cuece los macarrones 10 minutos en agua con sal.',
				'Gratina 15 minutos a 200°C.'
			],
			imageUrl: 'https://example.com/macarrones.jpg'
		});
	});

	test('instructions as one text, in paragraphs or as an HTML list', () => {
		const text = (recipeInstructions: unknown) =>
			normalizeRecipe({ '@type': 'Recipe', name: 'X', recipeInstructions })?.instructions;
		expect(text('Pela las patatas.\nFríelas.')).toEqual(['Pela las patatas.', 'Fríelas.']);
		expect(text('<ol><li>Bate los huevos.</li><li>Cuaja la tortilla.</li></ol>')).toEqual([
			'Bate los huevos.',
			'Cuaja la tortilla.'
		]);
		expect(text(['Uno.', { '@type': 'HowToStep', name: 'Dos.' }])).toEqual(['Uno.', 'Dos.']);
		expect(text('**Derretir la mantequilla** a fuego medio.')).toEqual([
			'Derretir la mantequilla a fuego medio.'
		]);
	});

	test('a list at the top, and not a recipe', () => {
		expect(findRecipe([[{ '@type': 'Person' }, { '@type': 'Recipe', name: 'Y' }]])).toEqual({
			'@type': 'Recipe',
			name: 'Y'
		});
		expect(findRecipe([{ '@type': 'Article' }])).toBeNull();
		expect(normalizeRecipe({ '@type': 'Recipe', name: 'Sin pasos' })).toBeNull();
	});
});
