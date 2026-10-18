/** Kitchen timers' names and times, as shown and as said (#60). */

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** A name for one that was not given any, from its time: «5 minutos», «1 hora y 30 minutos». */
export function timeLabel(seconds: number) {
	seconds = Math.round(seconds);
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const parts = [
		...(h ? [plural(h, 'hora')] : []),
		...(m ? [plural(m, 'minuto')] : []),
		...(s || !seconds ? [plural(s, 'segundo')] : [])
	];
	return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0]!;
}

/** «7:05», «1:02:30». */
export function formatLeft(sec: number) {
	sec = Math.max(0, Math.ceil(sec));
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = String(sec % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** For the AI: «7 min 5 s». */
export function spokenLeft(sec: number) {
	sec = Math.max(0, Math.round(sec));
	const m = Math.floor(sec / 60);
	return m ? `${m} min${sec % 60 ? ` ${sec % 60} s` : ''}` : `${sec} s`;
}

export const sameLabel = (a: string, b: string) =>
	a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0;
