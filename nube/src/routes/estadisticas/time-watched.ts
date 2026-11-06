/** «3 h 20 min», «45 min»; «—» for nothing, less than half a minute being nothing to tell. */
export function timeWatched(seconds: number) {
	const minutes = Math.round(seconds / 60);
	if (!minutes) return '—';
	const hours = Math.floor(minutes / 60);
	if (!hours) return `${minutes} min`;
	return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
