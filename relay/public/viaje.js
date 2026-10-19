// A shared trip (#81): the car on the map, live from this relay (SSE), until it is no longer shared.
import * as maplibregl from '/maplibre/maplibre-gl.mjs';

// Its worker from here: a worker must come from the page's own origin.
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const token = location.pathname.split('/')[2];
const $ = (id) => document.getElementById(id);
const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
/** Older than this, the position is said to be old: no signal, or the tablet closed. */
const OLD_MS = 2 * 60_000;

const map = new maplibregl.Map({
	container: 'mapa',
	// OpenFreeMap: free, no key, and it allows this use: https://openfreemap.org
	style: 'https://tiles.openfreemap.org/styles/liberty',
	center: [-3.7, 40.4],
	zoom: 5,
	attributionControl: { compact: true }
});
const arrow = document.createElement('div');
arrow.className = 'coche';
const car = new maplibregl.Marker({ element: arrow, rotationAlignment: 'map' });
let following = true;
let last = null;

map.on('dragstart', () => {
	following = false;
	$('centrar').hidden = !last;
});
$('centrar').addEventListener('click', () => {
	following = true;
	$('centrar').hidden = true;
	if (last) map.easeTo({ center: [last.lon, last.lat], zoom: Math.max(map.getZoom(), 14) });
});

/** «Última posición hace 20 s», kept up to date between news. */
function age() {
	if (!last) return;
	const seconds = Math.round((Date.now() - last.t) / 1000);
	const text =
		seconds < 60 ? `hace ${Math.max(seconds, 0)} s` : `hace ${Math.round(seconds / 60)} min`;
	$('cuando').textContent = `Última posición ${text}`;
	$('cuando').classList.toggle('viejo', Date.now() - last.t > OLD_MS);
}
setInterval(age, 5000);

function show(trip) {
	if (trip.gone || trip.ended) {
		$('fin').hidden = false;
		$('centrar').hidden = true;
		car.remove();
		events.close();
		return;
	}
	if (trip.name) {
		$('quien').textContent = `Viaje de ${trip.name}`;
		document.title = `Viaje de ${trip.name}`;
	}
	$('destino').textContent = trip.destination
		? `Va a ${trip.destination}${trip.arrivesAt ? `, llega sobre las ${time.format(trip.arrivesAt)}` : ''}`
		: '';
	if (!trip.position) return;
	const first = !last;
	last = trip.position;
	car.setLngLat([last.lon, last.lat]).addTo(map);
	if (last.heading !== null && (last.speed ?? 0) > 3) car.setRotation(last.heading);
	age();
	if (first) map.jumpTo({ center: [last.lon, last.lat], zoom: 14 });
	else if (following) map.easeTo({ center: [last.lon, last.lat], duration: 1000 });
}

const events = new EventSource(`/s/${token}/eventos`);
events.onmessage = (e) => show(JSON.parse(e.data));
