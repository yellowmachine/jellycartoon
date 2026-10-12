/**
 * From a playlist (today's or a list): the chosen episode, or the first not watched, and the ones
 * not watched after it.
 */
export function playlistQueue(items: { id: number; watched: boolean }[], episodeId: number | null) {
	let start = items.findIndex((i) => (episodeId === null ? !i.watched : i.id === episodeId));
	if (start < 0) start = 0;
	return items.length
		? [items[start].id, ...items.slice(start + 1).flatMap((i) => (i.watched ? [] : i.id))]
		: [];
}
