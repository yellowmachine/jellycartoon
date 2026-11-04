/**
 * A receipt's photo from the phone's camera, made smaller before it is sent (#194): a 12 MP one
 * is several MB, and the model reads a receipt as well at 2000 px on its longer side. Turned as
 * the phone held it (EXIF), as JPEG.
 */
const LONGEST = 2000;
const QUALITY = 0.85;

/** `longest` and `quality`: a paper to be read later (#384) keeps more than a receipt. */
export async function smallerPhoto(
	file: File,
	{ longest = LONGEST, quality = QUALITY }: { longest?: number; quality?: number } = {}
): Promise<Blob> {
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
		const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(bitmap.width * scale);
		canvas.height = Math.round(bitmap.height * scale);
		canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
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
