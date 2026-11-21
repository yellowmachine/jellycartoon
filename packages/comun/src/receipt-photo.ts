/**
 * A receipt's photo from the phone's camera, made smaller before it is sent (#194): a 12 MP one
 * is several MB, and the model reads a receipt as well at 2000 px on its longer side. Turned as
 * the phone held it (EXIF), as JPEG.
 */
const LONGEST = 2000;
const QUALITY = 0.85;

/** A quarter turn clockwise, as many times: 0, 90, 180 or 270 degrees. */
export type Turn = 0 | 90 | 180 | 270;

/**
 * `longest` and `quality`: a paper to be read later (#384) keeps more than a receipt. `turn`: turned
 * further by hand, clockwise (a sheet photographed flat on a table, whose EXIF the phone got wrong).
 */
export async function smallerPhoto(
	file: File,
	{
		longest = LONGEST,
		quality = QUALITY,
		turn = 0
	}: { longest?: number; quality?: number; turn?: Turn } = {}
): Promise<Blob> {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
		const width = Math.round(bitmap.width * scale);
		const height = Math.round(bitmap.height * scale);
		const sideways = turn === 90 || turn === 270;
		const canvas = document.createElement('canvas');
		canvas.width = sideways ? height : width;
		canvas.height = sideways ? width : height;
		const ctx = canvas.getContext('2d')!;
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((turn * Math.PI) / 180);
		ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
		bitmap.close();
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', quality)
		);
		return blob ?? file;
	} catch {
		// A format the browser cannot draw (HEIC on some): as it is, the server limits its size.
		return file;
	}
}

/**
 * The SHA-256 of the file as chosen, before it is made smaller (#440): the same file put in twice.
 * Null where the browser cannot (not over https).
 */
export async function fileHash(file: Blob): Promise<string | null> {
	try {
		const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	} catch {
		return null;
	}
}
