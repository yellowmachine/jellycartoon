/**
 * A pretend house for the screenshots (#495): what Música and Carretera ask jellycartoon's API
 * (house.ts, music.ts), answered with invented records and drawn covers. Never a real one: no
 * songs (the tracks give 404), only what the pages show. Over https, as Seilide only talks to a
 * house that way (house-url.ts), with a certificate made for the run (capturas.ts).
 *
 *   bun scripts/capturas/casa-falsa.ts <port> <cert.pem> <key.pem>
 */
import type { MusicAlbum, MusicTrack } from 'comun/music.ts';

const [port, cert, key] = process.argv.slice(2);
if (!port || !cert || !key) throw new Error('Uso: casa-falsa.ts <puerto> <cert.pem> <key.pem>');
const origin = `https://127.0.0.1:${port}`;

/** Invented bands and records, with the two colours of their cover. */
const RECORDS: [title: string, artist: string, from: string, to: string, songs: string[]][] = [
	[
		'Verano en la orilla',
		'Brisa Sur',
		'#f59e0b',
		'#be123c',
		['Arena', 'Las doce', 'Faro', 'Volver nadando']
	],
	['Luz de tarde', 'Las Lunas de Mayo', '#a78bfa', '#1e3a8a', ['Persianas', 'Domingo', 'Té frío']],
	[
		'Canciones para el coche',
		'Trío Almendra',
		'#34d399',
		'#0f766e',
		['Kilómetro cero', 'Gasolinera', 'Ventanilla']
	],
	['Niebla', 'Niebla Norte', '#94a3b8', '#334155', ['Ría', 'Bruma', 'Puerto viejo']],
	['El patio', 'Coro del Patio', '#fb7185', '#7c2d12', ['Macetas', 'Siesta', 'Geranio']],
	['Azahar', 'Dúo Azahar', '#fde047', '#ea580c', ['Naranjos', 'Marzo', 'Huerta']],
	['Desde el faro', 'Los del Faro', '#38bdf8', '#312e81', ['Señales', 'Marea alta', 'Gaviotas']],
	['Pimentón', 'Orquesta Pimentón', '#ef4444', '#450a0a', ['Verbena', 'Pasodoble raro', 'Fiestas']],
	[
		'Cuentos para dormir',
		'La Tía Tula Canta',
		'#c4b5fd',
		'#4c1d95',
		['La luna', 'El búho', 'Nana del mar']
	],
	['Bicicleta', 'Rueda Libre', '#86efac', '#166534', ['Cuesta abajo', 'Timbre', 'Parque']],
	['Mediterráneo en calma', 'Velas Blancas', '#67e8f9', '#155e75', ['Cala', 'Mistral', 'Barca']],
	['Cocina de domingo', 'Los Sartenes', '#fdba74', '#9a3412', ['Paella', 'Sobremesa', 'Café']]
];

let trackId = 1;
const albums: MusicAlbum[] = RECORDS.map(([title, artist, , , songs], i) => ({
	id: i + 1,
	title,
	artist,
	hasCover: true,
	tracks: songs.map((song, n): MusicTrack => ({
		id: trackId++,
		title: song,
		artist,
		number: n + 1,
		durationSec: 150 + ((i * 37 + n * 53) % 120),
		albumId: i + 1,
		album: title,
		hasCover: true
	}))
}));
const seconds = (tracks: MusicTrack[]) => tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0);
const all = albums.flatMap((a) => a.tracks);
const lists = [
	{ id: 1, name: 'Para el coche', tracks: all.filter((t) => [3, 1, 7].includes(t.albumId)) },
	{ id: 2, name: 'Para dormir a los peques', tracks: all.filter((t) => t.albumId === 9) },
	{ id: 3, name: 'Cocinando', tracks: all.filter((t) => [12, 8, 6].includes(t.albumId)) }
];

/** A cover: the record's two colours and two shapes (its title is written beside it already). */
function cover(id: number) {
	const record = RECORDS[id - 1];
	if (!record) return null;
	const [, , from, to] = record;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="300" height="300">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="300" height="300" fill="url(#g)"/>
<circle cx="${80 + ((id * 47) % 160)}" cy="${70 + ((id * 31) % 120)}" r="${40 + ((id * 13) % 50)}" fill="#fff" fill-opacity=".18"/>
<rect x="${30 + ((id * 23) % 150)}" y="${170 + ((id * 17) % 80)}" width="${60 + ((id * 29) % 90)}" height="${60 + ((id * 11) % 70)}" rx="12" fill="#000" fill-opacity=".15" transform="rotate(${((id * 19) % 40) - 20} 150 150)"/>
</svg>`;
}

const json = (body: unknown) => Response.json(body);
const later = () => new Date(Date.now() + 6 * 3600_000).toISOString();

Bun.serve({
	port: Number(port),
	hostname: '127.0.0.1',
	tls: { cert: Bun.file(cert), key: Bun.file(key) },
	fetch(request) {
		const { pathname } = new URL(request.url);
		const coverMatch = pathname.match(/^\/pase\/portadas\/(\d+)$/);
		if (coverMatch) {
			const svg = cover(Number(coverMatch[1]));
			return svg
				? new Response(svg, {
						headers: { 'content-type': 'image/svg+xml', 'access-control-allow-origin': '*' }
					})
				: new Response('', { status: 404 });
		}
		switch (pathname) {
			case '/api/v1/musica/albumes':
				return json({
					albums: albums.map((a) => ({
						id: a.id,
						title: a.title,
						artist: a.artist,
						hasCover: true,
						tracks: a.tracks.length,
						durationSec: seconds(a.tracks)
					}))
				});
			case '/api/v1/musica/catalogo':
				return json({ albums });
			case '/api/v1/musica/listas':
				return json({
					playlists: lists.map((l) => ({
						id: l.id,
						name: l.name,
						total: l.tracks.length,
						durationSec: seconds(l.tracks)
					}))
				});
			case '/api/v1/musica/aleatorio':
				return json({ tracks: all.slice(0, 10) });
			case '/api/v1/musica/pase':
				return json({ base: `${origin}/pase`, images: `${origin}/pase`, expires: later() });
			case '/api/v1/musica/dj':
				return json({ enabled: false, voices: false, presets: [] });
			case '/api/v1/telegram':
				return json({ connected: false });
		}
		const list = pathname.match(/^\/api\/v1\/musica\/listas\/(\d+)$/);
		if (list) {
			const found = lists.find((l) => l.id === Number(list[1]));
			if (found)
				return json({ playlist: { ...found, items: found.tracks.map((track) => ({ track })) } });
		}
		const album = pathname.match(/^\/api\/v1\/musica\/albumes\/(\d+)$/);
		if (album) {
			const found = albums.find((a) => a.id === Number(album[1]));
			if (found) return json({ album: found });
		}
		return Response.json({ message: 'La casa de ejemplo no tiene esto' }, { status: 404 });
	}
});
console.log(`[casa falsa] en ${origin}`);
