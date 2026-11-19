/**
 * A photo for Mensajes (#555), made small in the device before it is encrypted: its longest side at
 * most `MAX_SIDE`, as JPEG. Drawn anew on a canvas, so what the camera wrote in the file (where it was
 * taken, the phone's model) is left out. `createImageBitmap` turns it as the camera said.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function shrinkPhoto(file: Blob) {
	const bitmap = await createImageBitmap(file).catch(() => {
		throw new Error('Esa imagen no se puede abrir');
	});
	try {
		const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Este aparato no puede preparar la foto');
		// A transparent PNG on white, not black, as JPEG has no transparency.
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(bitmap, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
		if (!blob) throw new Error('Este aparato no puede preparar la foto');
		return { blob, width, height };
	} finally {
		bitmap.close();
	}
}

/** Where this device is now, asked once (the browser asks the person the first time). */
export function herePosition(): Promise<{ lat: number; lon: number; accuracy: number }> {
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) return reject(new Error('Este aparato no sabe dónde está'));
		navigator.geolocation.getCurrentPosition(
			(p) =>
				resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
			(err) =>
				reject(
					new Error(
						err.code === err.PERMISSION_DENIED
							? 'Seilide no tiene permiso para saber dónde estás: dáselo en el navegador'
							: 'No se ha podido saber dónde estás: prueba otra vez'
					)
				),
			{ enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 }
		);
	});
}
