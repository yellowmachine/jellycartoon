/**
 * A call ringing in the road mode (#330), answered by voice: «contesta», «cógelo», «sí» answer;
 * «no contestes», «rechaza», «ahora no» do not. Said after the wake word and understood here, with
 * no round of the AI: whoever calls is waiting. Anything else goes to the AI as always.
 */
export type CallReply = 'answer' | 'reject';

const fold = (text: string) =>
	text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-zñ ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Words that answer, and words that go with them («la llamada», «por favor»). */
const ANSWERS =
	'si|vale|venga|dale|contesta|contestala|contestale|contestar|coge|cogela|cogelo|coger|descuelga|descolgar|acepta|aceptala|aceptar|pasamela|pasamelo|pasala|ponmela';
const NOT_ANSWERING =
	'no|nop|ahora no|luego|despues|mas tarde|no contestes|no lo cojas|no la cojas|no cojas|rechaza|rechazala|rechazar|cuelga|cuelgala|colgar|que llame luego|que llame despues|que llame mas tarde';
const FILLERS = 'ya|ahora|la llamada|el telefono|por favor|gracias';
const whole = (words: string) => new RegExp(`^(${words})( (${words}|${FILLERS}))*$`);

/** Checked first: «no contestes» has «contest» in it. */
const REJECT = whole(NOT_ANSWERING);
const ANSWER = whole(ANSWERS);

/** What was said about the call ringing; null if it was something else. */
export function callReplySaid(text: string): CallReply | null {
	const said = fold(text);
	if (!said) return null;
	if (REJECT.test(said)) return 'reject';
	if (ANSWER.test(said)) return 'answer';
	return null;
}
