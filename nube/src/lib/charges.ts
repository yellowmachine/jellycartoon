import { euros } from 'comun/expenses.ts';

/**
 * «Cargos que vienen»: the fixed expenses about to be paid, told some days before so that there is
 * money in the account. By rules; the bank's balance is not looked at.
 */

/** The days before one may be told. */
export const NOTICE_DAYS = [1, 3, 5, 7] as const;
export const isNoticeDays = (n: unknown): n is number =>
	n === 0 || (NOTICE_DAYS as readonly unknown[]).includes(n);
export const MAX_ACCOUNT = 40;

/** A person's: the usual for a fixed one that does not say, 0 for none, and what they closed. */
export interface ChargeNotices {
	on: boolean;
	monthly: number;
	yearly: number;
	/** The fixed one's id → the day (`YYYY-MM-DD`) of the charge they closed. */
	closed: Record<string, string>;
}
/** Those of every month are known by heart; the rest (`yearly`), forgotten. */
export const noChoice = (): ChargeNotices => ({ on: true, monthly: 0, yearly: 7, closed: {} });

/** One coming. */
export interface Charge {
	id: number;
	name: string;
	amount: number;
	day: string;
	/** Days to it: 0, today. */
	left: number;
	account: string | null;
}

/** «Hoy», «Mañana», «En 3 días». */
export const inDays = (n: number) => (n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : `En ${n} días`);

/** «Mañana, Amazon Prime: 4,99 €. Que haya saldo en Santander.» */
export const chargeText = (c: Charge) =>
	`${inDays(c.left)}, ${c.name}: ${euros(c.amount)}. ${c.account ? `Que haya saldo en ${c.account}.` : 'Asegúrate de que haya saldo.'}`;

/** «En los próximos 5 días, 3 cargos: 54,98 € en Santander y 9,99 € sin cuenta apuntada.» */
export function chargesSummary(list: Charge[]) {
	const sums = new Map<string, { account: string | null; cents: number }>();
	for (const c of list) {
		const key = c.account?.toLowerCase() ?? '';
		const sum = sums.get(key) ?? { account: c.account, cents: 0 };
		sum.cents += c.amount;
		sums.set(key, sum);
	}
	const named = [...sums.values()]
		.sort((a, b) => Number(!a.account) - Number(!b.account) || b.cents - a.cents)
		.map(({ account, cents }) =>
			account
				? `${euros(cents)} en ${account}`
				: sums.size > 1
					? `${euros(cents)} sin cuenta apuntada`
					: euros(cents)
		);
	const most = Math.max(...list.map((c) => c.left));
	const when = most === 0 ? 'Hoy' : most === 1 ? 'De hoy a mañana' : `En los próximos ${most} días`;
	return `${when}, ${list.length} cargos: ${new Intl.ListFormat('es').format(named)}.`;
}
