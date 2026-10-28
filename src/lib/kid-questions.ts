import { HISTORY_TURNS, type VoiceTurn } from 'comun/voice.ts';

/** Questions about what the children watch, in /infantil: shared by the server and the page. */

export interface KidQuestion {
	text: string;
	/** The exchanges before, so that «¿y la anterior?» means something. */
	history: VoiceTurn[];
}

const text = (value: unknown, max: number) =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** A question from the page, only if it is well formed; the history, the last turns and valid ones. */
export function parseKidQuestion(body: unknown): KidQuestion | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	const asked = text(b.text, 500);
	if (!asked) return null;
	const history = (Array.isArray(b.history) ? b.history : []).flatMap((turn: unknown) => {
		const t = turn as Record<string, unknown> | null;
		const content = text(t?.content, 2000);
		return (t?.role === 'user' || t?.role === 'assistant') && content
			? [{ role: t.role, content } as VoiceTurn]
			: [];
	});
	return { text: asked, history: history.slice(-HISTORY_TURNS) };
}
