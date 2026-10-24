/**
 * The image behind the top of a series' or a film's page (Backdrop.svelte), and a new URL once it
 * is changed: the browser keeps an image it already showed for as long as the page lives, as with
 * thumbnails (thumb.svelte.ts). Only touched in the browser.
 */
type Kind = 'serie' | 'pelicula';

const versions = $state<Record<string, number>>({});

export const backdropUrl = (kind: Kind, id: number) => {
	const v = versions[`${kind}-${id}`];
	return `/api/fondo/${kind}/${id}${v ? `?v=${v}` : ''}`;
};

async function post(url: string, body: unknown) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	}).catch(() => null);
	return res?.ok ? res.json() : null;
}

/** The film's: that frame from now on (`null`: the app's choice again). False if it could not. */
export async function chooseFilmBackdrop(id: number, atSec: number | null) {
	const done = await post(`/api/fondo/pelicula/${id}`, atSec === null ? { auto: true } : { atSec });
	if (done) versions[`pelicula-${id}`] = Date.now();
	return Boolean(done);
}

/** The series': the app's choice again. */
export async function resetSeriesBackdrop(id: number) {
	const done = await post(`/api/fondo/serie/${id}`, { auto: true });
	if (done) versions[`serie-${id}`] = Date.now();
	return Boolean(done);
}

/** From the player: this episode's frame at `atSec`, for its series. */
export async function useFrameAsBackdrop(episodeId: number, atSec: number) {
	const done: { seriesId: number } | null = await post(`/api/fondo/capitulo/${episodeId}`, {
		atSec
	});
	if (done) versions[`serie-${done.seriesId}`] = Date.now();
	return Boolean(done);
}
