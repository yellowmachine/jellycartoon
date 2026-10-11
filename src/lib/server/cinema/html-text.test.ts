import { describe, expect, test } from 'bun:test';
import { htmlToText } from './html-text.ts';

describe('htmlToText', () => {
	test('keeps tables as rows and headings', () => {
		const html = `<div class="mw-heading"><h2 id="T1">Temporada 1<span class="mw-editsection"><span>[</span><a>editar</a><span>]</span></span></h2></div>
<table><tr><th>N.º</th><th>Título</th></tr>
<tr><td>1</td><td>«El piloto»<sup class="reference"><a>[1]</a></sup></td></tr>
<tr><td>2</td><td>The One with the Sonogram at the End</td></tr></table>`;
		expect(htmlToText(html)).toBe(
			[
				'## Temporada 1',
				'N.º | Título',
				'1 | «El piloto»',
				'2 | The One with the Sonogram at the End'
			].join('\n')
		);
	});

	test('decodes entities and drops styles and comments', () => {
		const html = `<style>.a{color:red}</style><!-- x --><p>Tom &amp; Jerry&nbsp;&#8212; &#x2018;Puss&#39;</p>`;
		expect(htmlToText(html)).toBe("Tom & Jerry — ‘Puss'");
	});
});
