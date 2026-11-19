<script lang="ts" module>
	/**
	 * The Vista's tab icons (#525): round thick strokes, as the snail's (Caracol.svelte), to read
	 * from across the kitchen. Each a few strokes on a 24 grid; `dot`, a point (a thicker stroke).
	 */
	const ICONS = {
		inicio: ['M3 10.5 12 3l9 7.5', 'M5 9v11h14V9', 'M10 20v-5.5h4V20'],
		receta: [
			'M3 12h14v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z',
			'M17 13.5h4',
			'M8 8.5c0-1.6 1.6-1.6 1.6-3.5',
			'M12 8.5c0-1.6 1.6-1.6 1.6-3.5'
		],
		series: [
			'M4 7.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z',
			'M8.5 3.5 12 7l3.5-3.5'
		],
		canales: [
			'M8.6 15.4a4.8 4.8 0 0 1 0-6.8',
			'M15.4 8.6a4.8 4.8 0 0 1 0 6.8',
			'M5.6 18.4a9 9 0 0 1 0-12.8',
			'M18.4 5.6a9 9 0 0 1 0 12.8'
		],
		musica: [
			'M9 18V5.5l11-2V16',
			'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
			'M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
		],
		radio: [
			'M4 9h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z',
			'M7 9l10-5',
			'M18 14.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
			'M6 13h4',
			'M6 16.5h4'
		],
		podcasts: [
			'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z',
			'M5.5 11a6.5 6.5 0 0 0 13 0',
			'M12 17.5V21',
			'M8.5 21h7'
		],
		ayuda: [
			'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
			'M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4'
		],
		salir: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'M9.5 16 5.5 12l4-4', 'M5.5 12H16']
	} as const;

	/** Points, drawn as a dot: the antenna's, the question mark's. */
	const DOTS: Partial<Record<VistaIconName, [number, number, number]>> = {
		canales: [12, 12, 4],
		ayuda: [12, 17, 3.4]
	};

	export type VistaIconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, class: className = 'h-7 w-7' }: { name: VistaIconName; class?: string } = $props();
	const dot = $derived(DOTS[name]);
</script>

<svg
	viewBox="0 0 24 24"
	class={className}
	fill="none"
	stroke="currentColor"
	stroke-width="2.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#each ICONS[name] as d (d)}<path {d} />{/each}
	{#if dot}<path d="M{dot[0]} {dot[1]}h.01" stroke-width={dot[2]} />{/if}
</svg>
