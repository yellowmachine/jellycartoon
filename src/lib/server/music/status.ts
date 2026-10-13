/**
 * What the music catalogue is doing now, for the page to show it: looking for files, reading their
 * tags, or looking for covers. In memory: after a restart it is only `idle` until the next scan.
 */
export const musicProgress = {
	phase: 'idle' as 'idle' | 'scanning' | 'reading' | 'covers',
	/** The last scan's result, or why it failed. */
	lastScan: null as {
		at: number;
		added: number;
		changed: number;
		missing: number;
		waiting: number;
	} | null,
	lastError: null as string | null,
	/** FLAC files found so far while scanning. */
	found: 0,
	coversDone: 0,
	coversTotal: 0
};
