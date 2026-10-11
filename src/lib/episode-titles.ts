/** Titles and numbering of a series' episodes, as the AI proposes them. */

export interface TitleProposal {
	episodeId: number;
	/** `false`: an opening, extras, a repeated track or something else; it goes to season 0. */
	isEpisode: boolean;
	season: number;
	number: number;
	title: string;
}

/** Few enough files for their frames to fit in one request (Anthropic takes up to 100 images). */
export const BATCH_SIZE = 25;

const collator = new Intl.Collator('es', { numeric: true });

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/**
 * The episodes in the order of their file names (a disc's tracks are in the order they were
 * broadcast), in batches that keep each folder together when it fits.
 */
export function titleBatches<T extends { sourcePath: string }>(episodes: T[], size = BATCH_SIZE) {
	const sorted = episodes.toSorted((a, b) => collator.compare(a.sourcePath, b.sourcePath));
	const folders = Map.groupBy(sorted, (e) => folderOf(e.sourcePath));
	const batches: T[][] = [];
	let current: T[] = [];
	for (const folder of folders.values()) {
		if (current.length && current.length + folder.length > size) {
			batches.push(current);
			current = [];
		}
		for (const ep of folder) {
			if (current.length === size) {
				batches.push(current);
				current = [];
			}
			current.push(ep);
		}
	}
	if (current.length) batches.push(current);
	return batches;
}
