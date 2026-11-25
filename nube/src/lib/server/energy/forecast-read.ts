import { energyForecast, type Way } from './forecast.ts';
import { fuelStates } from './fuel.ts';
import { solarState } from './solar.ts';
import type { Kitchen } from '../fridge.ts';
import { FUEL_KINDS } from '#lib/fuel.ts';
import { euroText } from '#lib/plugs.ts';
import type { SolarDay } from '#lib/solar.ts';

/**
 * Preguntar's «read_energy_forecast» (#513, phase 4): Energía → Previsión in words, all of it at
 * once: the cold of the next days, the light it will take (from the plugs and from the bills),
 * butane or pellet (how long what is at home lasts) and the solar panels (what they will make,
 * the grid, the battery, the hours with sun to spare). Only what the page shows; nothing invented
 * where it is still learning.
 */

const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');
const n1 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

function wayText(name: string, w: Way, learning: string) {
	if (!w) return null;
	if (!('learned' in w)) return `${name}: aún aprendiendo (${learning}: ${w.have} de ${w.need}).`;
	const l = w.learned;
	const euros = l.euros
		? ` (${euroText(l.euros.kwh)}, entre ${euroText(l.euros.low)} y ${euroText(l.euros.high)})`
		: '';
	const how =
		l.fit.perDegree > 0
			? `${n1(l.fit.base)} kWh al día sin frío y ${n1(l.fit.perDegree)} más por grado-día`
			: `unos ${n1(l.fit.base)} kWh al día, el frío apenas lo cambia`;
	return `${name}: unos ${n0(l.expected.kwh)} kWh, entre ${n0(l.expected.low)} y ${n0(l.expected.high)}${euros}. Aprendido de ${l.fit.n}: ${how}.`;
}

export async function describeEnergyForecast(k: Kitchen) {
	const [forecast, fuels, solar] = await Promise.all([
		energyForecast(k),
		fuelStates(k),
		solarState(k)
	]);
	if (forecast === null) return 'La familia no ha dicho dónde vive (Ajustes → «Dónde vivís»).';
	if (typeof forecast === 'string') return forecast;
	const lines: string[] = [];
	const n = forecast.days.length;
	lines.push(
		`El frío de los próximos ${n} días en ${forecast.place}: ${n0(forecast.degrees)} grados-día de calefacción${forecast.degreesBefore !== null ? ` (los ${n} anteriores, ${n0(forecast.degreesBefore)})` : ''}. Pasada la primera semana, la previsión es menos segura.`
	);
	lines.push(
		'Cada día: ' +
			forecast.days
				.map((d) => `${d.day} media ${n1(d.mean)} °C, ${n1(d.degrees)} grados-día`)
				.join('; ') +
			'.'
	);

	const light = [
		wayText('Lo enchufado (solo los enchufes de Energía)', forecast.plugs, 'días de enchufes'),
		wayText(
			solar
				? 'De la red según las facturas (con placas, solo lo que viene de la red)'
				: 'Toda la casa según las facturas de la luz',
			forecast.bills,
			'facturas'
		)
	].filter(Boolean);
	lines.push(
		light.length
			? `La luz de esos ${n} días. ${light.join(' ')}`
			: 'La luz: no hay de dónde aprenderla (ni enchufes ni facturas de la luz leídas).'
	);

	for (const f of fuels) {
		const meta = FUEL_KINDS[f.kind];
		const o = f.outlook;
		const many = f.spots.length > 1;
		const home = `${f.full} ${f.full === 1 ? `${meta.unit} llena` : `${meta.units} llenas`} en casa`;
		const going = f.spots.filter((s) => s.unit);
		const each = going.map(
			(s) =>
				`${many ? `en ${s.name}, ` : 'la de ahora, '}empezada el ${s.unit!.startedOn}${s.left !== null ? `, le queda un ${n0(s.left * 100)} %` : ''}${many && s.ends ? `, hasta el ${s.ends}` : ''}`
		);
		if (!o) {
			lines.push(
				`${meta.name}: ${home}${each.length ? `; ${each.join('; ')}` : ''}. Aún no se puede calcular cuánto llega (falta cuándo se empezó la de ahora o cuánto dura).`
			);
			continue;
		}
		const how = going.some((s) => s.by === 'aprendido')
			? going.every((s) => s.by === 'aprendido')
				? 'Aprendido de lo gastado.'
				: 'En parte aprendido, en parte lo que dijo la familia.'
			: 'Con lo que dijo la familia.';
		lines.push(
			`${meta.name}: ${home}; ${each.join('; ')}. ${o.allEnds ? `Lo que hay llega hasta el ${o.allEnds}` : 'Llega para más de dos semanas'}; en ${n} días harán falta unas ${n1(o.needed.kwh)} ${meta.units}${o.toBuy ? `, hay que comprar ${o.toBuy}` : ''}. ${how}${f.uncounted.length ? ` Sin contar ${f.uncounted.join(', ')}: aún no se sabe cuánto dura.` : ''}`
		);
	}

	if (solar) {
		const kwp = solar.row.groups.reduce((t, g) => t + g.kwp, 0);
		const what = `Placas: ${n1(kwp)} kWp${solar.row.batteryKwh ? `, batería de ${n1(solar.row.batteryKwh)} kWh` : ', sin batería'}.`;
		const s = solar.forecast;
		if (s === null) lines.push(`${what} Sin «Dónde vivís» no se puede prever.`);
		else if (typeof s === 'string') lines.push(`${what} ${s}`);
		else if (!s.days.length)
			lines.push(
				`${what} Falta lo que gasta la casa al día (Energía → Previsión → Placas → Ajustes).`
			);
		else {
			const days = s.days;
			const sum = (pick: (d: SolarDay) => number) => days.reduce((t, d) => t + pick(d), 0);
			const grid = sum((d) => d.fromGrid);
			lines.push(
				`${what} En ${s.days.length} días darán unos ${n0(sum((d) => d.made))} kWh; de la red, unos ${n0(grid)} kWh${s.price ? ` (${euroText(grid * s.price)})` : ''}; sobrarán ${n0(sum((d) => d.toGrid))} kWh para la red. Lo que gasta la casa: ${s.use.by === 'dicho' ? `${n1(s.use.kwh)} kWh al día, lo dijo la familia` : s.use.by === 'facturas' ? 'aprendido de las facturas de antes de las placas' : 'no se sabe'}.`
			);
			lines.push(
				'Cada día: ' +
					s.days
						.map(
							(d) =>
								`${d.day} placas ${n1(d.made)} kWh, casa ${n1(d.used)}, red ${n1(d.fromGrid)}` +
								(solar.row.batteryKwh
									? d.emptyAt === null
										? ', la batería llega a la mañana'
										: `, la batería se acaba a las ${d.emptyAt}${d.emptyAt < 12 ? ' de madrugada' : ''}`
									: '') +
								(d.spare
									? `, sobra sol de ${d.spare.from} a ${d.spare.to} (${n1(d.spare.kwh)} kWh)`
									: '')
						)
						.join('; ') +
					'.'
			);
		}
	}
	return lines.join('\n');
}
