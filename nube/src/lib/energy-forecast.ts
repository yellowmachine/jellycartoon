/**
 * Energía → Previsión (#513): what is to be used in the next days, from how much the house uses
 * per degree-day of cold. Each day's use = `base` + `perDegree` × that day's heating degree-days,
 * fitted by least squares on the days (or bills) already known.
 */

/** Days ahead: Open-Meteo forecasts 16 counting today. */
export const FORECAST_AHEAD = 15;
/** From this day on (counting today as 0), the forecast is much less sure. */
export const SURE_DAYS = 7;
/** Days with plugs needed to learn from them; bills needed to learn from them. */
export const MIN_DAYS = 14;
export const MIN_BILLS = 3;

export interface Fit {
	/** kWh a day with no cold. */
	base: number;
	/** kWh more for each heating degree-day; 0 when the cold does not change the use. */
	perDegree: number;
	/** How far the known days stray from the line, kWh a day. */
	spread: number;
	/** How many days (or bills) it was learned from. */
	n: number;
}

/**
 * The line through `points` (x degree-days a day, y kWh a day, `w` how many days each weighs: a
 * bill weighs its days). Never a negative per degree: if the cold does not raise the use (or the
 * days were all alike), the mean.
 */
export function fitLine(points: { x: number; y: number; w?: number }[]): Fit | null {
	if (!points.length) return null;
	const w = (p: { w?: number }) => p.w ?? 1;
	const total = points.reduce((s, p) => s + w(p), 0);
	const mx = points.reduce((s, p) => s + w(p) * p.x, 0) / total;
	const my = points.reduce((s, p) => s + w(p) * p.y, 0) / total;
	const sxx = points.reduce((s, p) => s + w(p) * (p.x - mx) ** 2, 0);
	const sxy = points.reduce((s, p) => s + w(p) * (p.x - mx) * (p.y - my), 0);
	// Less than a degree-day of difference between the days: nothing to learn about the cold.
	let perDegree = sxx / total >= 1 ? sxy / sxx : 0;
	if (perDegree < 0) perDegree = 0;
	let base = my - perDegree * mx;
	if (base < 0) {
		// All of it by the cold: through zero.
		base = 0;
		const sx2 = points.reduce((s, p) => s + w(p) * p.x * p.x, 0);
		perDegree = sx2 ? points.reduce((s, p) => s + w(p) * p.x * p.y, 0) / sx2 : 0;
	}
	const residual = points.reduce((s, p) => s + w(p) * (p.y - base - perDegree * p.x) ** 2, 0);
	return {
		base,
		perDegree,
		spread: Math.sqrt(residual / Math.max(total - 1, 1)),
		n: points.length
	};
}

export interface Expected {
	/** kWh: the likeliest, and a range. */
	kwh: number;
	low: number;
	high: number;
}

/**
 * What `fit` expects over days with these degree-days (the first is today). Its range: how much
 * the known days strayed, over that many days, and the weather's own doubt, a degree-day a day
 * in the first week and two after.
 */
export function expect(fit: Fit, degreeDays: number[]): Expected {
	const kwh = degreeDays.reduce((s, d) => s + fit.base + fit.perDegree * d, 0);
	const weather = degreeDays.reduce((s, _, i) => s + fit.perDegree * (i < SURE_DAYS ? 1 : 2), 0);
	const doubt = fit.spread * Math.sqrt(degreeDays.length) + weather;
	return { kwh, low: Math.max(0, kwh - doubt), high: kwh + doubt };
}
