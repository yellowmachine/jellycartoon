/**
 * When each thumbnail was taken again in this tab. The browser keeps an image it already showed
 * for as long as the page lives, whatever Cache-Control says, so a new one needs a new URL.
 * Only touched in the browser.
 */
const versions = $state<Record<number, number>>({});

/** The house's own; the cloud's (#253), the house's through a signed pass (`setThumbBase`). */
let base = '/api/thumb';

export function setThumbBase(own: string) {
	base = own;
}

export const thumbUrl = (episodeId: number) =>
	versions[episodeId] ? `${base}/${episodeId}?v=${versions[episodeId]}` : `${base}/${episodeId}`;

export function thumbChanged(episodeId: number) {
	versions[episodeId] = Date.now();
}
