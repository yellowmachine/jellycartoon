/** The month's AI spending (#193), as the line under the header shows it. In dollars. */
export interface AiSpend {
	/** Spent this month (OpenRouter's month, in UTC) with the house's key. */
	month: number;
	/** Credit left: the account's, with a management key; or what the key's own limit leaves. */
	left: number | null;
}

/** «3,42 $». */
export const dollars = (amount: number) =>
	`${amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
