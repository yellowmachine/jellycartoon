/**
 * When each thumbnail was taken again in this tab. The browser keeps an image it already showed
 * for as long as the page lives, whatever Cache-Control says, so a new one needs a new URL.
 * Only touched in the browser.
 */
const versions = $state<Record<number, number>>({});

export const thumbUrl = (episodeId: number) =>
	versions[episodeId]
		? `/api/thumb/${episodeId}?v=${versions[episodeId]}`
		: `/api/thumb/${episodeId}`;

export function thumbChanged(episodeId: number) {
	versions[episodeId] = Date.now();
}
