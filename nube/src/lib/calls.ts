/**
 * Voice calls between the family's people (#330), browser to browser by WebRTC
 * (https://developer.mozilla.org/docs/Web/API/WebRTC_API): Seilide only puts the two in touch (the
 * signalling: offer, answer and candidates) and keeps each call in the history; the sound goes
 * straight between them, or through the VPS's coturn when they cannot see each other. What the
 * page and the server both know.
 */

/** Unanswered for this long, the call is missed. */
export const RING_SECONDS = 45;

/** How a call ended: in the history, and said on the screen. */
export type CallOutcome = 'answered' | 'missed' | 'rejected' | 'cancelled' | 'busy';

export const OUTCOME_TEXT: Record<CallOutcome, string> = {
	answered: 'Contestada',
	missed: 'Perdida',
	rejected: 'Rechazada',
	cancelled: 'Colgada antes de contestar',
	busy: 'Ocupado'
};

/** A candidate, as RTCIceCandidate.toJSON() gives it. */
export interface IceCandidate {
	candidate: string;
	sdpMid?: string | null;
	sdpMLineIndex?: number | null;
	usernameFragment?: string | null;
}

/** What one side sends the other, relayed as it is. */
export type CallSignal =
	| { type: 'offer'; sdp: string }
	| { type: 'answer'; sdp: string }
	| { type: 'ice'; candidate: IceCandidate };

/** What a side asks of the call. */
export type CallMessage = CallSignal | { type: 'accept' } | { type: 'reject' } | { type: 'hangup' };

/** What a side hears, on its events: the other's signals, and how the call is. */
export type CallEvent =
	| CallSignal
	| { type: 'state'; state: 'ringing' | 'connected' }
	| { type: 'state'; state: 'ended'; outcome: CallOutcome };

/** A call ringing for someone: on their open pages, besides the notice. */
export interface IncomingCall {
	id: string;
	fromName: string;
}

/** Someone of the family to call. */
export interface Callable {
	userId: string;
	name: string;
	/** Whether any of their devices gets Seilide's notices: if not, only an open page rings. */
	notices: boolean;
}

/** A call of the history, as one of its two sees it. */
export interface CallRecord {
	id: string;
	/** Who called: this person, or the other. */
	outgoing: boolean;
	otherName: string;
	startedAt: string;
	/** Seconds talking; null if never answered. */
	seconds: number | null;
	outcome: CallOutcome | null;
}

const MAX_SDP = 30_000;
const MAX_CANDIDATE = 2_000;

const text = (value: unknown, max: number) =>
	typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
const optional = <T>(value: unknown, is: (v: unknown) => v is T): T | null | undefined =>
	value === undefined ? undefined : value === null ? null : is(value) ? value : undefined;
const isString = (v: unknown): v is string => typeof v === 'string' && v.length <= 200;
const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** A page's own id for the calls (a random UUID): which of a person's devices is in the call. */
export function parseDevice(value: unknown): string | null {
	return typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

/** What a page posted, checked: anything else, null. */
export function parseCallMessage(body: unknown): CallMessage | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	switch (b.type) {
		case 'accept':
		case 'reject':
		case 'hangup':
			return { type: b.type };
		case 'offer':
		case 'answer': {
			const sdp = text(b.sdp, MAX_SDP);
			return sdp ? { type: b.type, sdp } : null;
		}
		case 'ice': {
			const c = b.candidate as Record<string, unknown> | null;
			if (!c || typeof c !== 'object') return null;
			// The last one, «no more», has an empty candidate.
			const candidate = c.candidate === '' ? '' : text(c.candidate, MAX_CANDIDATE);
			if (candidate === null) return null;
			return {
				type: 'ice',
				candidate: {
					candidate,
					sdpMid: optional(c.sdpMid, isString) ?? null,
					sdpMLineIndex: optional(c.sdpMLineIndex, isIndex) ?? null,
					usernameFragment: optional(c.usernameFragment, isString) ?? null
				}
			};
		}
		default:
			return null;
	}
}

/** «3:07», «1:02:30». */
export function talkTime(seconds: number) {
	const s = Math.max(0, Math.floor(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
