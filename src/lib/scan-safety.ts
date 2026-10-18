/**
 * Whether a scan found so few of the files it knew that the folder is more likely not mounted
 * than emptied: then nothing is marked missing (a nightly scan has nobody watching it). Only
 * with enough files known to tell.
 */
export function looksUnmounted(found: number, known: number) {
	return known >= 20 && found < known * 0.1;
}
