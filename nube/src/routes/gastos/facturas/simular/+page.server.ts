import type { PageServerLoad } from './$types';
import { offerFromBill, simulate, type TariffOffer } from 'comun/bill-simulation.ts';
import { billsOf } from '#lib/server/expenses/bills.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/**
 * Gastos → Facturas → ¿Y si…? (#232): the light bills worked out with the tariff they say and with
 * up to two others typed in, `?a_…` and `?b_…` (a GET form: nothing kept, the link can be shared).
 */

/** How the power's price is given in an offer: per kW and day, month or year. */
const PER_DAY = { dia: 1, mes: 12 / 365, año: 1 / 365 } as const;
type PowerUnit = keyof typeof PER_DAY;

/** «0,198» or «0.198»: a number; empty or nonsense, null. */
function num(q: URLSearchParams, key: string) {
	const raw = (q.get(key) ?? '').trim().replace(',', '.');
	const n = raw === '' ? NaN : Number(raw);
	return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
}

/** The offer typed in under `prefix`; null if not complete. */
function offerOf(q: URLSearchParams, prefix: string): TariffOffer | null {
	const kind = q.get(`${prefix}tipo`);
	const unit = (q.get(`${prefix}unidad`) ?? 'dia') as PowerUnit;
	const factor = PER_DAY[unit] ?? 1;
	const pp1 = num(q, `${prefix}pp1`);
	const pp2 = num(q, `${prefix}pp2`);
	if (pp1 === null || pp2 === null) return null;
	let energy: TariffOffer['energy'];
	if (kind === 'periodos') {
		const [P1, P2, P3] = ['p1', 'p2', 'p3'].map((p) => num(q, `${prefix}${p}`));
		if (!P1 || !P2 || !P3) return null;
		energy = { kind: 'periodos', P1, P2, P3 };
	} else {
		const price = num(q, `${prefix}precio`);
		if (!price) return null;
		energy = { kind: 'fijo', price };
	}
	const kw1 = num(q, `${prefix}kw1`);
	const kw2 = num(q, `${prefix}kw2`);
	return {
		name:
			(q.get(`${prefix}nombre`) ?? '').trim().slice(0, 40) ||
			(prefix === 'a_' ? 'Oferta A' : 'Oferta B'),
		energy,
		powerPrice: { P1: pp1 * factor, P2: pp2 * factor },
		power: kw1 && kw2 ? { P1: kw1, P2: kw2 } : null,
		monthlyFee: num(q, `${prefix}cuota`) ?? 0
	};
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const bills = (await billsOf(k, 'Luz')).map((b) => ({ ...b, id: b.id, total: b.total }));
	const own = bills.map((b) => offerFromBill(b)).find((o) => o !== null) ?? null;
	const typed = (['a_', 'b_'] as const).map((p) => ({
		prefix: p,
		offer: offerOf(url.searchParams, p)
	}));
	const offers = [...(own ? [own] : []), ...typed.flatMap((t) => (t.offer ? [t.offer] : []))];
	return {
		own,
		offers,
		/** What was typed, to show it again in the form. */
		asked: Object.fromEntries(url.searchParams),
		simulation: simulate(bills, offers),
		latest: bills[0] ? { store: bills[0].store, details: bills[0].details } : null
	};
};
