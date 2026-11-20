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

/** A room's sensor (#508), as Enchufes → Temperatura shows it. */
export interface SensorView {
	id: string;
	name: string;
	/** Its last reading; all null, none yet. */
	tempC: number | null;
	humidity: number | null;
	battery: number | null;
	/** On USB. */
	external: boolean | null;
	/** When it was read (ISO); null, never. */
	at: string | null;
	/** Silent longer than it should be: «sin noticias». */
	silent: boolean;
	/** The one of «la casa» (#557), for the rules: marked, or the only one. */
	home: boolean;
	points: { at: string; temperature: number }[];
}

/** The rooms' lines, in this order; «Fuera» is grey. */
export const SENSOR_COLORS = [
	'text-amber-400',
	'text-sky-400',
	'text-emerald-400',
	'text-rose-400',
	'text-violet-400',
	'text-lime-400'
];
