import { expect, test } from 'bun:test';
import { articleOf, safeArticleHtml } from './notes-reader.ts';
import { parseTags } from '#lib/notes.ts';

const para = `<p>${'El pan de masa madre necesita tiempo, harina, agua y algo de paciencia. '.repeat(15)}</p>`;
const page = (body: string) =>
	`<html><head><title>Pan de masa madre | Cocina</title><meta property="og:site_name" content="Cocina"></head><body><nav>Inicio · Recetas · Contacto</nav>${body}<footer>© Cocina</footer></body></html>`;

test('a web’s article, as the reader shows it: only text, its shape and its links', () => {
	const a = articleOf(
		page(
			`<article><h1>Pan de masa madre</h1>${para}<img src="a.jpg" alt="pan"><script>alert(1)</script><h2 style="color:red">La harina</h2><p>Más en <a href="/centeno" onclick="robar()">el centeno</a>.</p>${para}</article>`
		),
		'https://cocina.es/pan'
	)!;
	expect(a).toMatchObject({ site: 'Cocina', minutes: 2 });
	expect(a.title).toContain('Pan de masa madre');
	expect(a.html).not.toMatch(/<img|<script|alert|onclick|style=|Inicio · Recetas/);
	expect(a.html).toContain(
		'<a href="https://cocina.es/centeno" rel="noopener noreferrer nofollow" target="_blank">el centeno</a>'
	);
	expect(a.text).toContain('El pan de masa madre necesita tiempo');
	expect(a.text).not.toContain('© Cocina');
});

test('a page without an article, nothing; and what was kept is sanitized again when shown', () => {
	expect(articleOf(page('<p>Hola.</p>'), 'https://cocina.es/')).toBeNull();
	expect(articleOf('no es html', 'https://cocina.es/')).toBeNull();
	expect(
		safeArticleHtml('<p onclick="x()">Hola<script>alert(1)</script></p><img src=x onerror=y>')
	).toBe('<p>Hola</p>');
	expect(safeArticleHtml('<a href="javascript:alert(1)">mal</a>')).not.toContain('javascript');
});

test('tags as written: lowercase, without #, once each, at most ten', () => {
	expect(parseTags('Cocina, #niños,, cocina ,  Trabajo  duro')).toEqual([
		'cocina',
		'niños',
		'trabajo duro'
	]);
	expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
});
