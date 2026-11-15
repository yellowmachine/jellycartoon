/** Enchufes → Temperatura (#508): how far back its chart goes, in days. */
export const TEMPERATURE_RANGES = [2, 7, 30] as const;

/** One line of its chart (TemperatureChart.svelte). */
export interface TemperatureSeries {
	name: string;
	points: { at: string; temperature: number }[];
	/** Its stroke: a Tailwind text colour class, the line drawn in currentColor. */
	color: string;
	dashed?: boolean;
}
