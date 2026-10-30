/**
 * A rule of the family (#331, phase 2) as data: when it is looked at, what has to hold then, and
 * whom it tells what. The AI writes it from what was said (server/rules.ts, `translateRule`);
 * the server checks it itself, without the AI. Words are matched as the voice's memory does:
 * accents and case aside, the same first five letters («tendida», «tendido»).
 */

/**
 * When: an agenda event that starts (`minutesBefore` it), a post-it or something on the list
 * that goes up, something the voice is asked to remember, a trip that starts or ends (theirs; the
 * house's, anyone's), or every day at `time`.
 */
export const TRIGGERS = [
	'agenda',
	'nevera',
	'recuerdo',
	'viaje_empieza',
	'viaje_acaba',
	'cada_dia'
] as const;
export type TriggerKind = (typeof TRIGGERS)[number];

/**
 * What has to hold too (or not, `negate`): being away on a trip today, something remembered, a
 * post-it or something on the list, something in today's agenda.
 */
export const CONDITIONS = ['de_viaje', 'recuerdo', 'nevera', 'agenda_hoy'] as const;
export type ConditionKind = (typeof CONDITIONS)[number];

export interface Trigger {
	kind: TriggerKind;
	/** For agenda, nevera and recuerdo: the words it has to have («padres»); none, any. */
	words: string[];
	/** For agenda and the trips: this long before it starts; 0, when it starts. */
	minutesBefore: number;
	/** For cada_dia: `HH:MM`. */
	time: string | null;
}

export interface Condition {
	kind: ConditionKind;
	words: string[];
	negate: boolean;
}

export interface RuleNotice {
	/** Who is told: whose it is, the whole family, or these people of it. */
	to: 'yo' | 'casa' | 'personas';
	/** For `personas`: their accounts, and their names to show. */
	userIds: string[];
	names: string[];
	text: string;
	level: 'normal' | 'urgente';
}

export interface RuleSpec {
	when: Trigger;
	conditions: Condition[];
	notice: RuleNotice;
	/** Told once, and then paused. */
	once: boolean;
	/**
	 * Said out loud too, on the family's satellites, when one it is for is at home (not on a trip)
	 * and it is not the quiet hours (an urgent one, even then). Unset (older ones): the house's.
	 */
	say?: boolean;
}

export const MAX_RULE = 500;
const MAX_WORDS = 8;
const MAX_CONDITIONS = 4;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === 'string' && (list as readonly string[]).includes(v);

const wordList = (v: unknown) =>
	(Array.isArray(v) ? v : [])
		.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
		.map((w) => w.trim().slice(0, 40))
		.slice(0, MAX_WORDS);

const clock = (v: unknown) =>
	typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;

/** What the AI answered, as the AI's schema has it (`RULE_SCHEMA`). */
export interface TranslatedRule {
	possible: boolean;
	why_not: string | null;
	understood: string;
	when: { kind: string; words: string[]; minutes_before: number; time: string | null };
	conditions: { kind: string; words: string[]; negate: boolean }[];
	notice: { to: string; people: string[]; text: string; level: string };
	once: boolean;
	say: boolean;
}

/**
 * The AI's answer checked, with the people's names already made accounts (`people`, from the
 * family's, by `resolve`): null if it is not one the server can check, with why.
 */
export function specOf(
	t: TranslatedRule,
	resolve: (name: string) => { userId: string; name: string } | null
): { spec: RuleSpec } | { problem: string } {
	if (!t.possible) return { problem: t.why_not || 'Esa regla no la sé comprobar todavía.' };
	if (!isOneOf(TRIGGERS, t.when?.kind)) return { problem: 'No he entendido cuándo mirarla.' };
	const time = clock(t.when.time);
	if (t.when.kind === 'cada_dia' && !time) return { problem: 'Falta a qué hora mirarla.' };
	const text = (t.notice?.text ?? '').trim().slice(0, MAX_RULE);
	if (!text) return { problem: 'Falta qué avisar.' };
	const to = isOneOf(['yo', 'casa', 'personas'] as const, t.notice.to) ? t.notice.to : 'yo';
	const people =
		to === 'personas' ? (t.notice.people ?? []).map((n) => ({ n, p: resolve(n) })) : [];
	const missing = people.filter((x) => !x.p).map((x) => x.n);
	if (missing.length)
		return { problem: `No hay nadie con cuenta llamado ${missing.join(', ')} en la familia.` };
	if (to === 'personas' && !people.length) return { problem: 'Falta a quién avisar.' };
	return {
		spec: {
			when: {
				kind: t.when.kind,
				words: wordList(t.when.words),
				minutesBefore: Math.max(
					0,
					Math.min(7 * 24 * 60, Math.round(Number(t.when.minutes_before) || 0))
				),
				time
			},
			conditions: (Array.isArray(t.conditions) ? t.conditions : [])
				.filter((c) => isOneOf(CONDITIONS, c?.kind))
				.slice(0, MAX_CONDITIONS)
				.map((c) => ({
					kind: c.kind as ConditionKind,
					words: wordList(c.words),
					negate: c.negate === true
				})),
			notice: {
				to,
				userIds: people.map((x) => x.p!.userId),
				names: people.map((x) => x.p!.name),
				text,
				level: t.notice.level === 'urgente' ? 'urgente' : 'normal'
			},
			once: t.once === true,
			say: t.say === true
		}
	};
}

const words = { type: 'array', items: { type: 'string' } };

/** The AI's answer, strict (every property, no others): what `specOf` takes. */
export const RULE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['possible', 'why_not', 'understood', 'when', 'conditions', 'notice', 'once', 'say'],
	properties: {
		possible: { type: 'boolean' },
		why_not: { type: ['string', 'null'] },
		understood: { type: 'string' },
		when: {
			type: 'object',
			additionalProperties: false,
			required: ['kind', 'words', 'minutes_before', 'time'],
			properties: {
				kind: { type: 'string', enum: [...TRIGGERS] },
				words,
				minutes_before: { type: 'integer' },
				time: { type: ['string', 'null'] }
			}
		},
		conditions: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'words', 'negate'],
				properties: {
					kind: { type: 'string', enum: [...CONDITIONS] },
					words,
					negate: { type: 'boolean' }
				}
			}
		},
		notice: {
			type: 'object',
			additionalProperties: false,
			required: ['to', 'people', 'text', 'level'],
			properties: {
				to: { type: 'string', enum: ['yo', 'casa', 'personas'] },
				people: words,
				text: { type: 'string' },
				level: { type: 'string', enum: ['normal', 'urgente'] }
			}
		},
		once: { type: 'boolean' },
		say: { type: 'boolean' }
	}
} as const;
