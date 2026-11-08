/**
 * A walk's photo for whoever has its link (#434), without what the camera wrote in it: the GPS
 * would say where it was taken, near home too, whatever the trimmed way hides. The phone's photos
 * come drawn again as JPEG (smallerPhoto), which keeps none of it; one the browser could not draw
 * comes as it was taken. Only JPEG and PNG are shared: a WebP's could hide it in more places.
 */

/** JPEG: its APP1 (EXIF, XMP) and APP13 (IPTC) out; the rest, the picture, as it is. */
function jpegWithout(file: Uint8Array): Uint8Array<ArrayBuffer> | null {
	const parts: Uint8Array[] = [file.subarray(0, 2)];
	let i = 2;
	while (i + 4 <= file.length) {
		if (file[i] !== 0xff) return null;
		const marker = file[i + 1]!;
		// Start of scan: the picture itself, to the end.
		if (marker === 0xda) {
			parts.push(file.subarray(i));
			return join(parts);
		}
		const length = (file[i + 2]! << 8) | file[i + 3]!;
		if (length < 2 || i + 2 + length > file.length) return null;
		if (marker !== 0xe1 && marker !== 0xed) parts.push(file.subarray(i, i + 2 + length));
		i += 2 + length;
	}
	return null;
}

/** PNG: its eXIf and text chunks (where XMP goes) out. */
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);
function pngWithout(file: Uint8Array): Uint8Array<ArrayBuffer> | null {
	const parts: Uint8Array[] = [file.subarray(0, 8)];
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	let i = 8;
	while (i + 12 <= file.length) {
		const length = view.getUint32(i);
		const type = String.fromCharCode(...file.subarray(i + 4, i + 8));
		const end = i + 12 + length;
		if (end > file.length) return null;
		if (!PNG_DROPPED.has(type)) parts.push(file.subarray(i, end));
		i = end;
		if (type === 'IEND') return join(parts);
	}
	return null;
}

function join(parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** The photo without its metadata, and its type; null if it is not one that can be cleaned. */
export function withoutMetadata(file: Uint8Array) {
	if (file[0] === 0xff && file[1] === 0xd8) {
		const clean = jpegWithout(file);
		return clean && { bytes: clean, type: 'image/jpeg' };
	}
	if (file[0] === 0x89 && file[1] === 0x50 && file[2] === 0x4e && file[3] === 0x47) {
		const clean = pngWithout(file);
		return clean && { bytes: clean, type: 'image/png' };
	}
	return null;
}
