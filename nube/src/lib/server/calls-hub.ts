import { and, desc, eq, inArray, ne, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
	RING_SECONDS,
	type CallEvent,
	type CallMessage,
	type CallOutcome,
	type CallRecord,
	type Callable,
	type IncomingCall
} from '#lib/calls.ts';
import { call, familyMember, familyPerson, pushSubscription, user } from './db/schema.ts';
import type { AnyDb, familyOnlyScope, familyScope } from './family-scope.ts';
import type { PushMessage } from './push.ts';

/**
 * The calls while they ring and last (#330): who is in each, and what one side sends the other,
 * relayed by the events each page listens to (SSE). In this server's memory: Seilide runs as one
 * process, and a call is only of now; its row (calls.schema.ts) is the history. Made with what it
 * needs, so the tests give it a PGlite and fake notices (calls.ts gives it the real ones).
 */

type Listener = (event: CallEvent) => void;

interface Side {
	userId: string;
	name: string;
	/** Their pages listening, each with its device's id: several devices of theirs may be open. */
	listeners: Map<Listener, string>;
	/**
	 * The device in the call: the one that called, or that answered. Only it gets the other's
	 * signals; any of theirs hears how the call is (another one stops ringing when it is answered).
	 */
	device: string | null;
	/** What came for it while no page of it listened: the callee's page opens after the offer. */
	queue: CallEvent[];
	/** Gone (its page closed) for a while: the call ends, unless it comes back. */
	gone: ReturnType<typeof setTimeout> | null;
}

interface Live {
	id: string;
	familyId: string;
	caller: Side;
	callee: Side;
	state: 'ringing' | 'connected';
	ring: ReturnType<typeof setTimeout>;
}

export interface CallInfo {
	id: string;
	role: 'caller' | 'callee';
	otherName: string;
	state: 'ringing' | 'connected' | 'ended';
	outcome: CallOutcome | null;
}

export interface HubDeps {
	withFamily: ReturnType<typeof familyScope>;
	asFamily: ReturnType<typeof familyOnlyScope>;
	notify: (familyId: string, userIds: string[], message: PushMessage) => Promise<void>;
	ringMs?: number;
	goneMs?: number;
}

/** Their name in the family (Agenda's people), or their account's. */
async function namesOf(tx: AnyDb, userIds: string[]) {
	const rows = await tx
		.select({ id: user.id, account: user.name, person: familyPerson.name })
		.from(user)
		.leftJoin(familyPerson, eq(familyPerson.userId, user.id))
		.where(inArray(user.id, userIds));
	return new Map(rows.map((r) => [r.id, r.person ?? r.account]));
}

export function callHub({
	withFamily,
	asFamily,
	notify,
	ringMs = RING_SECONDS * 1000,
	goneMs = 20_000
}: HubDeps) {
	const live = new Map<string, Live>();
	const incomingListeners = new Map<string, Set<(calls: IncomingCall[]) => void>>();

	const side = (c: Live, userId: string) =>
		c.caller.userId === userId ? c.caller : c.callee.userId === userId ? c.callee : null;
	const other = (c: Live, s: Side) => (s === c.caller ? c.callee : c.caller);
	const inCall = (userId: string) =>
		[...live.values()].some((c) => c.caller.userId === userId || c.callee.userId === userId);

	/** Its listeners on the device in the call; before one is chosen, all of theirs. */
	const inCallHere = (s: Side) =>
		[...s.listeners].filter(([, device]) => !s.device || device === s.device).map(([l]) => l);

	function send(s: Side, event: CallEvent) {
		if (event.type === 'state') {
			for (const l of s.listeners.keys()) l(event);
			return;
		}
		const here = inCallHere(s);
		if (here.length) for (const l of here) l(event);
		// What the other side needs to connect waits for that device's page.
		else s.queue.push(event);
	}

	function incomingOf(userId: string): IncomingCall[] {
		return [...live.values()]
			.filter((c) => c.state === 'ringing' && c.callee.userId === userId)
			.map((c) => ({ id: c.id, fromName: c.caller.name }));
	}

	function tellIncoming(userId: string) {
		const calls = incomingOf(userId);
		for (const l of incomingListeners.get(userId) ?? []) l(calls);
	}

	async function end(c: Live, outcome: CallOutcome) {
		if (live.get(c.id) !== c) return;
		live.delete(c.id);
		clearTimeout(c.ring);
		for (const s of [c.caller, c.callee]) if (s.gone) clearTimeout(s.gone);
		const event: CallEvent = { type: 'state', state: 'ended', outcome };
		send(c.caller, event);
		send(c.callee, event);
		tellIncoming(c.callee.userId);
		await asFamily(c.familyId, (tx) =>
			tx.update(call).set({ endedAt: new Date(), outcome }).where(eq(call.id, c.id))
		);
		// The ringing notice, replaced: by «perdida», or quietly by how it ended.
		const missed = outcome === 'missed' || outcome === 'cancelled';
		await notify(c.familyId, [c.callee.userId], {
			title: missed ? `Llamada perdida de ${c.caller.name}` : `Llamada de ${c.caller.name}`,
			body: missed ? 'Toca para devolverla' : outcome === 'answered' ? 'Terminada' : 'Rechazada',
			tag: `llamada-${c.id}`,
			url: '/llamadas',
			ttl: missed ? 86_400 : 60
		});
	}

	/** Its page gone: a moment to come back (a reload, the network), then the call ends. */
	function left(c: Live, s: Side) {
		if (inCallHere(s).length || s.gone) return;
		// The callee's page closed while it rings: their notice still rings.
		if (c.state === 'ringing' && s === c.callee) return;
		s.gone = setTimeout(() => {
			s.gone = null;
			if (!inCallHere(s).length)
				void end(
					c,
					c.state === 'connected' ? 'answered' : s === c.caller ? 'cancelled' : 'rejected'
				);
		}, goneMs);
	}

	return {
		/** The family's people this one can call: with an account, but themselves. */
		async callable(userId: string): Promise<Callable[]> {
			return withFamily(userId, async (tx) => {
				const people = await tx
					.select({ userId: familyMember.userId, account: user.name, person: familyPerson.name })
					.from(familyMember)
					.innerJoin(user, eq(user.id, familyMember.userId))
					.leftJoin(familyPerson, eq(familyPerson.userId, familyMember.userId))
					.where(ne(familyMember.userId, userId));
				const subscribed = new Set(
					(await tx.selectDistinct({ userId: pushSubscription.userId }).from(pushSubscription)).map(
						(r) => r.userId
					)
				);
				return people
					.map((p) => ({
						userId: p.userId,
						name: p.person ?? p.account,
						notices: subscribed.has(p.userId)
					}))
					.sort((a, b) => a.name.localeCompare(b.name, 'es'));
			});
		},

		/** A call to someone of the family: its id, or why not. */
		async start(
			userId: string,
			to: string,
			device: string
		): Promise<{ id: string } | { problem: string; id?: string }> {
			if (to === userId) return { problem: 'No te puedes llamar a ti.' };
			if (inCall(userId)) return { problem: 'Ya estás en una llamada.' };
			const id = crypto.randomUUID();
			const made = await withFamily(userId, async (tx, { familyId }) => {
				const [member] = await tx
					.select({ userId: familyMember.userId })
					.from(familyMember)
					.where(eq(familyMember.userId, to));
				if (!member) return null;
				const names = await namesOf(tx, [userId, to]);
				const busy = inCall(to);
				const now = new Date();
				await tx.insert(call).values({
					id,
					familyId,
					callerId: userId,
					calleeId: to,
					startedAt: now,
					...(busy ? { endedAt: now, outcome: 'busy' as const } : {})
				});
				return { familyId, busy, callerName: names.get(userId)!, calleeName: names.get(to)! };
			});
			if (!made) return { problem: 'No está en tu familia.' };
			if (made.busy) return { problem: `${made.calleeName} está en otra llamada.`, id };

			const fresh = (s: { userId: string; name: string }, device: string | null): Side => ({
				...s,
				device,
				listeners: new Map(),
				queue: [],
				gone: null
			});
			const c: Live = {
				id,
				familyId: made.familyId,
				caller: fresh({ userId, name: made.callerName }, device),
				callee: fresh({ userId: to, name: made.calleeName }, null),
				state: 'ringing',
				ring: setTimeout(() => void end(c, 'missed'), ringMs)
			};
			live.set(id, c);
			tellIncoming(to);
			await notify(made.familyId, [to], {
				title: `${made.callerName} te llama`,
				body: 'Toca para contestar',
				tag: `llamada-${id}`,
				url: `/llamada/${id}`,
				ttl: Math.ceil(ringMs / 1000),
				sticky: true,
				actions: [
					{ action: 'contestar', title: 'Contestar', url: `/llamada/${id}?contestar=1` },
					{ action: 'rechazar', title: 'Rechazar', post: `/api/llamadas/${id}/rechazar` }
				]
			});
			return { id };
		},

		/** For its page: who is on the other side, and how it is (or how it ended). */
		async info(userId: string, id: string): Promise<CallInfo | null> {
			const c = live.get(id);
			const s = c && side(c, userId);
			if (c && s)
				return {
					id,
					role: s === c.caller ? 'caller' : 'callee',
					otherName: other(c, s).name,
					state: c.state,
					outcome: null
				};
			return withFamily(userId, async (tx) => {
				const [row] = await tx
					.select()
					.from(call)
					.where(and(eq(call.id, id), or(eq(call.callerId, userId), eq(call.calleeId, userId))));
				if (!row) return null;
				const outgoing = row.callerId === userId;
				const otherId = outgoing ? row.calleeId : row.callerId;
				const names = otherId ? await namesOf(tx, [otherId]) : new Map<string, string>();
				return {
					id,
					role: outgoing ? 'caller' : 'callee',
					otherName: (otherId && names.get(otherId)) || 'Alguien que ya no está',
					state: 'ended',
					// A row left open (the server restarted mid-call): over all the same.
					outcome: row.outcome ?? 'cancelled'
				};
			});
		},

		/** Whether this is a call of theirs, ringing or lasting. */
		isIn(userId: string, id: string) {
			const c = live.get(id);
			return Boolean(c && side(c, userId));
		},

		/**
		 * A page of one of the two, listening: told how the call is now, and what waited for it.
		 * Null: not a call of theirs, or over.
		 */
		join(userId: string, id: string, device: string, listener: Listener): (() => void) | null {
			const c = live.get(id);
			const s = c && side(c, userId);
			if (!c || !s) return null;
			if (s.gone) {
				clearTimeout(s.gone);
				s.gone = null;
			}
			s.listeners.set(listener, device);
			listener({ type: 'state', state: c.state });
			if (!s.device || s.device === device) for (const event of s.queue.splice(0)) listener(event);
			return () => {
				s.listeners.delete(listener);
				if (live.get(id) === c) left(c, s);
			};
		},

		/** What a side asks: null, done; otherwise why not. */
		async message(
			userId: string,
			id: string,
			m: CallMessage,
			device: string | null
		): Promise<string | null> {
			const c = live.get(id);
			const s = c && side(c, userId);
			if (!c || !s) return 'La llamada ya terminó.';
			switch (m.type) {
				case 'accept': {
					if (s !== c.callee || c.state !== 'ringing') return 'Ya no se puede contestar.';
					if (!device) return 'Falta el aparato.';
					c.state = 'connected';
					c.callee.device = device;
					clearTimeout(c.ring);
					const event: CallEvent = { type: 'state', state: 'connected' };
					send(c.caller, event);
					send(c.callee, event);
					tellIncoming(c.callee.userId);
					await asFamily(c.familyId, (tx) =>
						tx.update(call).set({ answeredAt: new Date() }).where(eq(call.id, id))
					);
					// The callee's other devices stop ringing.
					await notify(c.familyId, [c.callee.userId], {
						title: `Llamada de ${c.caller.name}`,
						body: 'Contestada',
						tag: `llamada-${id}`,
						url: `/llamada/${id}`,
						ttl: 60
					});
					return null;
				}
				case 'reject':
					if (s !== c.callee || c.state !== 'ringing') return 'Ya no se puede rechazar.';
					await end(c, 'rejected');
					return null;
				case 'hangup':
					await end(
						c,
						c.state === 'connected' ? 'answered' : s === c.caller ? 'cancelled' : 'rejected'
					);
					return null;
				default:
					if (c.state !== 'connected') return 'Todavía no han contestado.';
					if (device !== s.device) return 'La llamada está en otro aparato.';
					send(other(c, s), m);
					return null;
			}
		},

		/** The calls ringing for this person, now and on every change: for their open pages. */
		watchIncoming(userId: string, listener: (calls: IncomingCall[]) => void) {
			const set = incomingListeners.get(userId) ?? new Set();
			set.add(listener);
			incomingListeners.set(userId, set);
			listener(incomingOf(userId));
			return () => {
				set.delete(listener);
				if (!set.size) incomingListeners.delete(userId);
			};
		},

		/** Their calls, the newest first. */
		async history(userId: string, limit = 50): Promise<CallRecord[]> {
			return withFamily(userId, async (tx) => {
				const caller = alias(user, 'caller');
				const callee = alias(user, 'callee');
				const rows = await tx
					.select({
						id: call.id,
						callerId: call.callerId,
						calleeId: call.calleeId,
						startedAt: call.startedAt,
						answeredAt: call.answeredAt,
						endedAt: call.endedAt,
						outcome: call.outcome,
						callerName: caller.name,
						calleeName: callee.name
					})
					.from(call)
					.leftJoin(caller, eq(caller.id, call.callerId))
					.leftJoin(callee, eq(callee.id, call.calleeId))
					.where(or(eq(call.callerId, userId), eq(call.calleeId, userId)))
					.orderBy(desc(call.startedAt))
					.limit(limit);
				const others = rows
					.map((r) => (r.callerId === userId ? r.calleeId : r.callerId))
					.filter((x): x is string => Boolean(x));
				const names = others.length ? await namesOf(tx, others) : new Map<string, string>();
				return rows.map((r) => {
					const outgoing = r.callerId === userId;
					const otherId = outgoing ? r.calleeId : r.callerId;
					return {
						id: r.id,
						outgoing,
						otherName:
							(otherId && names.get(otherId)) ||
							(outgoing ? r.calleeName : r.callerName) ||
							'Alguien que ya no está',
						startedAt: r.startedAt.toISOString(),
						seconds:
							r.answeredAt && r.endedAt
								? Math.round((r.endedAt.getTime() - r.answeredAt.getTime()) / 1000)
								: null,
						outcome: r.outcome ?? (live.has(r.id) ? null : 'cancelled')
					};
				});
			});
		}
	};
}

export type CallHub = ReturnType<typeof callHub>;
