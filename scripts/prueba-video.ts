/**
 * A stand-in for the cloud's app (#253), to try the video API before the cloud exists: it keeps
 * the cloud key, as the cloud's server will, and serves a page that lists the series, plays an
 * episode with hls.js straight from the house (the signed link) and sends its progress there.
 *
 *   MEDIA_URL=https://media.<dominio> MEDIA_KEY=casita_… PERSONA=<email> bun scripts/prueba-video.ts
 *
 * Then open http://<this PC's IP>:8787 on the phone (PORT to change it). The key never reaches
 * the page: it only goes from here to the house.
 */

const MEDIA_URL = process.env.MEDIA_URL?.replace(/\/$/, '');
const MEDIA_KEY = process.env.MEDIA_KEY;
const PERSONA = process.env.PERSONA;
if (!MEDIA_URL || !MEDIA_KEY || !PERSONA) {
	console.error('Faltan MEDIA_URL, MEDIA_KEY o PERSONA (ver el principio del script)');
	process.exit(1);
}

/** To the house's API, with the key and in whose name. */
function api(path: string, init: RequestInit = {}) {
	return fetch(`${MEDIA_URL}/api/v1${path}`, {
		...init,
		headers: { 'x-api-key': MEDIA_KEY!, 'x-persona': PERSONA!, 'content-type': 'application/json' }
	});
}

/** The house's answer as it came, status and body. */
async function relay(response: Promise<Response>) {
	const r = await response;
	return new Response(await r.text(), {
		status: r.status,
		headers: { 'content-type': r.headers.get('content-type') ?? 'text/plain' }
	});
}

const PAGE = /* html */ `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prueba de vídeo</title>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js"></script>
<style>
	body { margin: 0; padding: 16px; background: #09090b; color: #e4e4e7; font-family: system-ui, sans-serif; }
	button { display: block; width: 100%; margin: 4px 0; padding: 10px; text-align: left; background: #18181b;
		color: inherit; border: 1px solid #27272a; border-radius: 6px; font-size: 1rem; }
	video { width: 100%; background: #000; }
	small { color: #a1a1aa; }
	#estado { color: #fbbf24; }
</style>
</head>
<body>
<h1>Prueba de vídeo</h1>
<p id="estado"></p>
<video id="video" controls playsinline hidden></video>
<div id="lista"></div>
<script>
const lista = document.getElementById('lista');
const estado = document.getElementById('estado');
const video = document.getElementById('video');
let hls, progreso, enviar;

const boton = (texto, accion) => {
	const b = document.createElement('button');
	b.innerHTML = texto;
	b.onclick = accion;
	lista.append(b);
};

async function pedir(url, init) {
	const r = await fetch(url, init);
	if (!r.ok) throw new Error(r.status + ' ' + (await r.text()));
	return r.json();
}

async function series() {
	lista.innerHTML = '';
	const { series } = await pedir('/api/series');
	for (const s of series) boton(s.title + ' <small>(' + s.episodes + ')</small>', () => capitulos(s.id));
}

async function capitulos(id) {
	lista.innerHTML = '';
	const s = await pedir('/api/series/' + id);
	boton('← Series', series);
	for (const e of s.episodes) {
		const visto = e.completed ? ' ✓' : e.positionSec > 0 ? ' · ' + Math.round(e.positionSec / 60) + ' min' : '';
		boton(e.season + 'x' + e.number + ' ' + (e.title ?? '') + ' <small>' + (e.light ? '720p' : 'original') + visto + '</small>', () => ver(e.id));
	}
}

async function ver(id) {
	const v = await pedir('/api/ver/' + id, { method: 'POST' });
	estado.textContent = 'Calidad: ' + v.quality + ' · caduca ' + new Date(v.expires).toLocaleTimeString();
	progreso = v.progressUrl;
	video.hidden = false;
	hls?.destroy();
	if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = v.url;
	else { hls = new Hls(); hls.loadSource(v.url); hls.attachMedia(video); }
	video.addEventListener('loadedmetadata', () => { video.currentTime = v.positionSec; video.play(); }, { once: true });
}

// Every 10 s while it plays, straight to the house with the signed link.
setInterval(() => {
	if (!progreso || video.paused) return;
	fetch(progreso, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ positionSec: video.currentTime, durationSec: video.duration })
	}).catch((e) => (estado.textContent = 'Progreso: ' + e));
}, 10000);

series().catch((e) => (estado.textContent = e.message));
</script>
</body>
</html>`;

const server = Bun.serve({
	port: Number(process.env.PORT ?? 8787),
	hostname: '0.0.0.0',
	fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === '/') return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
		if (pathname === '/api/series') return relay(api('/series'));
		const series = /^\/api\/series\/(\d+)$/.exec(pathname);
		if (series) return relay(api(`/series/${series[1]}`));
		const watch = /^\/api\/ver\/(\d+)$/.exec(pathname);
		if (watch && request.method === 'POST')
			return relay(api(`/episodios/${watch[1]}/ver`, { method: 'POST', body: '{}' }));
		return new Response('Not found', { status: 404 });
	}
});

console.log(`Prueba de vídeo en http://0.0.0.0:${server.port} (abre la IP de este PC en el móvil)`);
