import { MAX_PAPER_MB } from 'comun/papers.ts';
import { smallerPhoto } from 'comun/receipt-photo.ts';

/**
 * A paper of several sheets (#384), from the phone without a scanner: its photos (and PDFs) put
 * together in the browser into one PDF, so the server keeps one file per paper as before.
 */

const MAX_BYTES = MAX_PAPER_MB * 1024 * 1024;

/** One sheet alone keeps more, as it is read later, and by a person. */
const ALONE = { longest: 3000, quality: 0.9 };
/** Each of several: a sheet still reads well, and some fifteen of them fit. */
const SHEET = { longest: 2200, quality: 0.85 };

/** A4's width, in PDF points: each photo a page as wide, as tall as it is. */
const PAGE_WIDTH = 595;

export class PaperTooBig extends Error {
	constructor() {
		super(`Todo junto pasa de ${MAX_PAPER_MB} MB: quita alguna página`);
	}
}

export class NotASheet extends Error {
	constructor(name: string) {
		super(
			`«${name}» no se puede juntar con las demás: tiene que ser una foto o un PDF sin contraseña`
		);
	}
}

const isPdf = (file: File) => file.type === 'application/pdf';

/** A picture the browser cannot draw (HEIC on some), as it is, for the server to say why not. */
async function photo(file: File, size: typeof ALONE) {
	const smaller = await smallerPhoto(file, size);
	return smaller instanceof File
		? smaller
		: new File([smaller], 'papel.jpg', { type: smaller.type });
}

/** The file to send for these pages, in this order: one as it is (a photo smaller), several as a PDF. */
export async function paperFile(pages: File[]): Promise<File> {
	if (pages.length === 1) {
		const [only] = pages as [File];
		const file = isPdf(only) ? only : await photo(only, ALONE);
		if (file.size > MAX_BYTES) throw new PaperTooBig();
		return file;
	}
	const { PDFDocument } = await import('pdf-lib');
	const pdf = await PDFDocument.create();
	for (const page of pages) {
		if (isPdf(page)) {
			// One with a password cannot be copied from.
			const other = await PDFDocument.load(await page.arrayBuffer()).catch(() => {
				throw new NotASheet(page.name);
			});
			for (const copied of await pdf.copyPages(other, other.getPageIndices())) pdf.addPage(copied);
			continue;
		}
		const sheet = await photo(page, SHEET);
		const bytes = new Uint8Array(await sheet.arrayBuffer());
		const image =
			sheet.type === 'image/jpeg'
				? await pdf.embedJpg(bytes)
				: sheet.type === 'image/png'
					? await pdf.embedPng(bytes)
					: null;
		if (!image) throw new NotASheet(page.name);
		const height = (PAGE_WIDTH * image.height) / image.width;
		pdf.addPage([PAGE_WIDTH, height]).drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height });
	}
	const bytes = await pdf.save();
	if (bytes.length > MAX_BYTES) throw new PaperTooBig();
	return new File([bytes as BlobPart], 'papel.pdf', { type: 'application/pdf' });
}
