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

/** Rang and stopped, or taken away, lately: told to the AI so that it does not set it again. */
export interface DoneTimer {
	label: string;
	how: 'sonó' | 'quitado';
	at: number;
}

/**
 * For the AI, with each command, as a phone or a satellite has them: «¿cuánto le queda?» is answered
 * from it. `done`, only those still worth telling (no other with their name).
 */
export function describeTimers(
	{
		done,
		running,
		ringing,
		prepared
	}: {
		done: DoneTimer[];
		running: { label: string; endsAt: number }[];
		ringing: { label: string }[];
		prepared: { label: string; seconds: number; trigger: string }[];
	},
	now: number
) {
	return [
		...done.map(
			(d) =>
				`${d.label}, ya ${d.how === 'sonó' ? 'sonó y se paró' : 'se quitó'} hace ${spokenLeft((now - d.at) / 1000)}: no lo vuelvas a poner si no lo pide`
		),
		...running.map((t) => `${t.label}, quedan ${spokenLeft((t.endsAt - now) / 1000)}`),
		...ringing.map((t) => `${t.label}, ya ha terminado y está sonando`),
		...prepared.map(
			(t) => `${t.label}, ${spokenLeft(t.seconds)}, preparado: arranca cuando ${t.trigger}`
		)
	];
}
