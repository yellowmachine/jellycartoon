import { and, asc, gte, lt } from 'drizzle-orm';
import { addDays } from 'comun/agenda.ts';
import { plug, plugEnergy } from '../db/schema.ts';
import type { Kitchen } from '../fridge.ts';
import { priceAt } from '#lib/kwh-price.ts';
import { energyText, euroText } from '#lib/plugs.ts';
import { TIME_ZONE } from '#lib/plug-stats.ts';
import { priceOf } from './plugs.ts';
import { dayStart } from './stats.ts';

/**
 * Preguntar's «read_plug_energy» (#396): what the family's plugs used, day by day, from what each
 * keeps by the hour (plug_energy), with euros at the price Enchufes uses (each hour at its own with
 * a tariff by periods). To cross with the weather (read_weather's degree-days) or the light bills.
 * Of one plug by its name, or of all.
 */

/** Days at once, at most: as read_weather, so both cover the same days. */
export const ENERGY_DAYS = 92;

const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const dayOf = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export async function describePlugEnergy(k: Kitchen, args: Record<string, unknown>) {
	const from = args.from_day;
	const to = args.to_day ?? from;
	if (!isDay(from) || !isDay(to)) return 'Faltan los días, AAAA-MM-DD.';
	const [first, last] = from <= to ? [from, to] : [to, from];
	if (daysBetween(first, last) > ENERGY_DAYS)
		return `Como mucho ${ENERGY_DAYS} días de una vez: pide el periodo por partes.`;

	return k.run(async (tx) => {
		const plugs = await tx
			.select({ id: plug.id, name: plug.name, createdAt: plug.createdAt })
			.from(plug)
			.orderBy(asc(plug.createdAt));
		if (!plugs.length) return 'La familia no tiene enchufes en Enchufes.';
		const asked = typeof args.plug === 'string' ? plain(args.plug.trim()) : '';
		const chosen = asked ? plugs.filter((p) => plain(p.name).includes(asked)) : plugs;
		if (!chosen.length)
			return `Ningún enchufe se llama así. Los de la familia: ${plugs.map((p) => p.name).join(', ')}.`;

		const ids = new Set(chosen.map((p) => p.id));
		const [rows, price] = await Promise.all([
			tx
				.select({ plugId: plugEnergy.plugId, hour: plugEnergy.hour, wh: plugEnergy.wh })
				.from(plugEnergy)
				.where(
					and(
						gte(plugEnergy.hour, dayStart(first)),
						lt(plugEnergy.hour, dayStart(addDays(last, 1)))
					)
				),
			priceOf(tx)
		]);
		const euros = (wh: number, at: Date) => (price ? (wh / 1000) * priceAt(price, at) : 0);
		const byDay = new Map<string, { wh: number; euros: number; plugs: Map<string, number> }>();
		const byPlug = new Map<string, { wh: number; euros: number }>();
		for (const r of rows) {
			if (!ids.has(r.plugId) || !r.wh) continue;
			const day = dayOf.format(r.hour);
			const eur = euros(r.wh, r.hour);
			const d = byDay.get(day) ?? { wh: 0, euros: 0, plugs: new Map() };
			d.wh += r.wh;
			d.euros += eur;
			d.plugs.set(r.plugId, (d.plugs.get(r.plugId) ?? 0) + r.wh);
			byDay.set(day, d);
			const p = byPlug.get(r.plugId) ?? { wh: 0, euros: 0 };
			p.wh += r.wh;
			p.euros += eur;
			byPlug.set(r.plugId, p);
		}

		const nameOf = new Map(chosen.map((p) => [p.id, p.name]));
		const several = chosen.length > 1;
		const money = (eur: number) => (price ? `, ${euroText(eur)}` : '');
		const lines = [
			`Consumo de ${several ? `los enchufes (${chosen.map((p) => p.name).join(', ')})` : `«${chosen[0]!.name}»`} del ${first} al ${last}, día a día${price ? ` (euros al precio de Enchufes, ${price.source === 'mano' ? 'puesto a mano' : 'de la última factura de la luz'})` : ' (sin precio del kWh: ni puesto en Enchufes ni de una factura de la luz)'}:`
		];
		for (let day = first; day <= last; day = addDays(day, 1)) {
			const d = byDay.get(day);
			const notYet = chosen.every((p) => dayOf.format(p.createdAt) > day);
			if (notYet) continue;
			if (!d) {
				lines.push(`${day}: nada`);
				continue;
			}
			const parts = several
				? ` (${[...d.plugs]
						.sort((a, b) => b[1] - a[1])
						.map(([id, wh]) => `${nameOf.get(id)} ${energyText(wh)}`)
						.join(', ')})`
				: '';
			lines.push(`${day}: ${energyText(d.wh)}${money(d.euros)}${parts}`);
		}
		if (lines.length === 1)
			return `Esos días aún no había ${several ? 'enchufes' : `«${chosen[0]!.name}»`} en Enchufes.`;
		const total = [...byPlug.values()].reduce(
			(s, p) => ({ wh: s.wh + p.wh, euros: s.euros + p.euros }),
			{ wh: 0, euros: 0 }
		);
		lines.push(
			`En total: ${energyText(total.wh)}${money(total.euros)}${
				several
					? ` (${chosen
							.map((p) => `${p.name} ${energyText(byPlug.get(p.id)?.wh ?? 0)}`)
							.join(', ')})`
					: ''
			}.`
		);
		const since = chosen.filter((p) => dayOf.format(p.createdAt) > first);
		if (since.length)
			lines.push(
				`Ojo: ${since.map((p) => `«${p.name}» está desde el ${dayOf.format(p.createdAt)}`).join('; ')}; antes no hay datos suyos.`
			);
		lines.push(
			'«Nada» es que no gastó o que estuvo apagado o sin conexión: el enchufe no guarda la diferencia.'
		);
		return lines.join('\n');
	});
}
