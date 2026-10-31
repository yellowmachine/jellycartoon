import type { RuleSpec } from '#lib/rules.ts';

/**
 * Rules ready to turn on (#331, phase 7), in Ajustes → Reglas: to find out what rules can do
 * without having to think of one. Written here as data, as the AI would (no AI to turn them on);
 * each one's person's, theirs. A ready one may be several rules: the washing machine's deduces,
 * and the rain's tells.
 */

export interface RuleTemplate {
	id: string;
	title: string;
	/** What it does, for whoever turns it on. */
	does: string;
	rules: { said: string; understood: string; spec: Omit<RuleSpec, 'template'> }[];
}

const toMe = (text: string, say = false) => ({
	notice: { to: 'yo' as const, userIds: [], names: [], text, level: 'normal' as const },
	once: false,
	say
});

export const RULE_TEMPLATES: RuleTemplate[] = [
	{
		id: 'ropa-lluvia',
		title: 'Ropa tendida y lluvia',
		does: 'Cuando le dices a Alexa que pones la lavadora, recuerda que ese día hay ropa tendida; si va a llover en las próximas 3 horas, te avisa para recogerla (también en voz alta en casa).',
		rules: [
			{
				said: 'Si digo que pongo la lavadora, ese día hay ropa tendida',
				understood:
					'Cuando digas algo con «lavadora», recordaré hasta esta noche: «Hay ropa tendida».',
				spec: {
					when: { kind: 'dicho', words: ['lavadora'], minutesBefore: 0, time: null },
					conditions: [],
					then: 'deducir',
					deduce: { text: 'Hay ropa tendida', days: 0 },
					...toMe('')
				}
			},
			{
				said: 'Si va a llover y hay ropa tendida, avísame para recogerla',
				understood:
					'Si va a llover en casa en las próximas 3 horas y recuerdo que hay ropa tendida, te avisaré: «Va a llover: recoge la ropa».',
				spec: {
					when: {
						kind: 'tiempo',
						words: [],
						minutesBefore: 0,
						time: null,
						weather: { what: 'lluvia', hours: 3, threshold: 60, where: 'casa' }
					},
					conditions: [{ kind: 'recuerdo', words: ['ropa', 'tendida'], negate: false }],
					then: 'avisar',
					deduce: null,
					...toMe('Va a llover: recoge la ropa', true)
				}
			}
		]
	},
	{
		id: 'paraguas',
		title: 'Paraguas por la mañana',
		does: 'Cada día a las 8:00, si va a llover en las próximas 12 horas, te recuerda el paraguas.',
		rules: [
			{
				said: 'Todas las mañanas a las 8, si va a llover hoy, recuérdame el paraguas',
				understood:
					'Todos los días a las 08:00, si va a llover en casa en las próximas 12 horas, te avisaré: «Hoy va a llover: coge el paraguas».',
				spec: {
					when: { kind: 'cada_dia', words: [], minutesBefore: 0, time: '08:00' },
					conditions: [
						{
							kind: 'tiempo',
							words: [],
							negate: false,
							weather: { what: 'lluvia', hours: 12, threshold: 60, where: 'donde_este' }
						}
					],
					then: 'avisar',
					deduce: null,
					...toMe('Hoy va a llover: coge el paraguas')
				}
			}
		]
	},
	{
		id: 'helada',
		title: 'Helada esta noche',
		does: 'Cada día a las 20:00, si va a helar en casa esta noche, te recuerda tapar las plantas.',
		rules: [
			{
				said: 'Todas las noches a las 8, si va a helar, recuérdame tapar las plantas',
				understood:
					'Todos los días a las 20:00, si va a helar en casa en las próximas 14 horas, te avisaré: «Esta noche hiela: tapa las plantas».',
				spec: {
					when: { kind: 'cada_dia', words: [], minutesBefore: 0, time: '20:00' },
					conditions: [
						{
							kind: 'tiempo',
							words: [],
							negate: false,
							weather: { what: 'helada', hours: 14, threshold: 0, where: 'casa' }
						}
					],
					then: 'avisar',
					deduce: null,
					...toMe('Esta noche hiela: tapa las plantas')
				}
			}
		]
	},
	{
		id: 'plantas-viaje',
		title: 'Plantas antes de un viaje',
		does: 'La víspera de un viaje tuyo de Viajes, te recuerda dejar a alguien al cargo de las plantas.',
		rules: [
			{
				said: 'La víspera de irme de viaje, recuérdame lo de las plantas',
				understood:
					'Un día antes de que empiece un viaje tuyo, te avisaré: «Mañana te vas: deja a alguien al cargo de las plantas».',
				spec: {
					when: { kind: 'viaje_empieza', words: [], minutesBefore: 24 * 60, time: null },
					conditions: [],
					then: 'avisar',
					deduce: null,
					...toMe('Mañana te vas: deja a alguien al cargo de las plantas')
				}
			}
		]
	},
	{
		id: 'toma-olvidada',
		title: 'Toma sin marcar',
		does: 'Si una toma de Medicación de cualquiera de la familia sigue sin marcar media hora después de su hora, te avisa.',
		rules: [
			{
				said: 'Si una toma sigue sin marcar media hora después, avísame',
				understood:
					'Cuando una toma de Medicación siga sin marcar 30 minutos después de su hora, te avisaré: «Hay una toma sin marcar».',
				spec: {
					when: {
						kind: 'toma_sin_marcar',
						words: [],
						minutesBefore: 0,
						time: null,
						minutesAfter: 30
					},
					conditions: [],
					then: 'avisar',
					deduce: null,
					...toMe('Hay una toma sin marcar')
				}
			}
		]
	}
];
