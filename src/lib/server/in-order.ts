/**
 * Runs what it is given one at a time, in the order it was given: each waits for the one before to
 * end, whether it worked or not. For orders made of several steps that must not mix, e.g. the
 * commands that queue a film in mpv when OK is pressed twice.
 */
export function inOrder() {
	let last: Promise<unknown> = Promise.resolve();
	return <T>(work: () => Promise<T>): Promise<T> => {
		const result = last.then(work, work);
		last = result.catch(() => {});
		return result;
	};
}
