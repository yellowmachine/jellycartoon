/**
 * When and where a photo was taken, as its camera wrote it in the file (EXIF, JPEG only): read in
 * the device, before the photo is made small and loses it. Phones often leave the place out of what
 * they hand over; what is not there, or makes no sense, is null.
 */
export interface Taken {
	at: Date | null;
	position: [number, number] | null;
}

const NOTHING: Taken = { at: null, position: null };

/** The EXIF block of a JPEG: where its TIFF header starts, or null. */
function tiffStart(view: DataView) {
	if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
	let i = 2;
	while (i + 10 <= view.byteLength) {
		const marker = view.getUint16(i);
		if (marker >> 8 !== 0xff || marker === 0xffda) return null;
		// APP1 with «Exif\0\0».
		if (marker === 0xffe1 && view.getUint32(i + 4) === 0x45786966) return i + 10;
		i += 2 + view.getUint16(i + 2);
	}
	return null;
}

/** A camera that does not write its time zone is taken to be in the device's. */
export function photoTaken(bytes: ArrayBuffer): Taken {
	try {
		const view = new DataView(bytes);
		const tiff = tiffStart(view);
		if (tiff === null) return NOTHING;
		const little = view.getUint16(tiff) === 0x4949;
		const u16 = (o: number) => view.getUint16(tiff + o, little);
		const u32 = (o: number) => view.getUint32(tiff + o, little);
		/** A directory's entries, by tag: where each one's value is. */
		const entries = (at: number) => {
			const found = new Map<number, { count: number; value: number }>();
			const n = u16(at);
			for (let i = 0; i < n; i++) {
				const e = at + 2 + i * 12;
				found.set(u16(e), { count: u32(e + 4), value: e + 8 });
			}
			return found;
		};
		const text = (e: { count: number; value: number } | undefined) => {
			if (!e || e.count > 64) return '';
			const from = e.count > 4 ? u32(e.value) : e.value;
			let s = '';
			for (let i = 0; i < e.count; i++) s += String.fromCharCode(view.getUint8(tiff + from + i));
			return s.replace(/\0.*$/, '').trim();
		};
		const main = entries(u32(4));
		const exifAt = main.get(0x8769);
		const exif = exifAt ? entries(u32(exifAt.value)) : new Map();
		const gpsAt = main.get(0x8825);
		const gps = gpsAt ? entries(u32(gpsAt.value)) : new Map();

		const said = text(exif.get(0x9003)).match(/^(\d{4}):(\d\d):(\d\d) (\d\d:\d\d:\d\d)$/);
		const offset = text(exif.get(0x9011));
		let at: Date | null = null;
		if (said) {
			const tz = /^[+-]\d\d:\d\d$/.test(offset) ? offset : '';
			const date = new Date(`${said[1]}-${said[2]}-${said[3]}T${said[4]}${tz}`);
			if (!Number.isNaN(date.getTime())) at = date;
		}

		const degrees = (e: { count: number; value: number } | undefined, max: number) => {
			if (!e || e.count !== 3) return null;
			const from = u32(e.value);
			const part = (i: number) => u32(from + i * 8) / u32(from + i * 8 + 4);
			const value = part(0) + part(1) / 60 + part(2) / 3600;
			return Number.isFinite(value) && value <= max ? value : null;
		};
		const lat = degrees(gps.get(2), 90);
		const lon = degrees(gps.get(4), 180);
		const placed = lat !== null && lon !== null && (lat !== 0 || lon !== 0);
		return {
			at,
			position: placed
				? [text(gps.get(3)) === 'W' ? -lon : lon, text(gps.get(1)) === 'S' ? -lat : lat]
				: null
		};
	} catch {
		return NOTHING;
	}
}
