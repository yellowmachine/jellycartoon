import { describe, expect, test } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { NotASheet, paperFile } from './paper-pages.ts';

/** A PDF of `pages` blank pages. */
async function pdf(pages: number, name = 'hoja.pdf') {
	const doc = await PDFDocument.create();
	for (let i = 0; i < pages; i++) doc.addPage();
	return new File([(await doc.save()) as BlobPart], name, { type: 'application/pdf' });
}

/** A 2×1 PNG: without a browser to draw it, it goes in as it is. */
const png = new File(
	[
		Uint8Array.from(
			atob(
				'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwyBDAYGAEbWB/mF3GSmAAAAAElFTkSuQmCC'
			),
			(c) => c.charCodeAt(0)
		)
	],
	'foto.png',
	{ type: 'image/png' }
);

describe('paperFile', () => {
	test('one PDF, as it is', async () => {
		const only = await pdf(2);
		expect(await paperFile([only])).toBe(only);
	});

	test('several, one PDF with all their pages in order', async () => {
		const joined = await paperFile([await pdf(2), png, await pdf(1)]);
		expect(joined.type).toBe('application/pdf');
		const doc = await PDFDocument.load(await joined.arrayBuffer());
		expect(doc.getPageCount()).toBe(4);
		// The photo, a page as wide as A4 and as tall as it is: 2×1.
		const { width, height } = doc.getPage(2).getSize();
		expect(width).toBe(595);
		expect(height).toBeCloseTo(297.5);
	});

	test('a file that is not a PDF nor a photo it can put in, said by its name', async () => {
		const bad = new File([new Uint8Array([1, 2, 3])], 'roto.pdf', { type: 'application/pdf' });
		await expect(paperFile([png, bad])).rejects.toThrow(NotASheet);
		await expect(paperFile([png, bad])).rejects.toThrow('«roto.pdf»');
	});
});
