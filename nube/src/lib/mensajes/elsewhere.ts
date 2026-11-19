/** A point in the phone's own maps app (#555): only opened when touched (it then learns the place). */
export function elsewhere(lat: number, lon: number) {
	const ua = navigator.userAgent;
	if (/android/i.test(ua)) return `geo:${lat},${lon}?q=${lat},${lon}`;
	if (/iphone|ipad|mac os/i.test(ua))
		return `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`;
	return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}
