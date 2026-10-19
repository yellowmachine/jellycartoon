<script lang="ts">
	/**
	 * The arrow of a route's step (#78), by openrouteservice's maneuver type: a straight arrow
	 * turned as the maneuver turns; a roundabout and the arrival, their own.
	 */
	let { type, class: className = 'h-16 w-16' }: { type: number; class?: string } = $props();

	// 0 left, 1 right, 2 sharp left, 3 sharp right, 4 slight left, 5 slight right, 6 straight on,
	// 9 U-turn, 11 setting off, 12 keep left, 13 keep right.
	const TURN: Record<number, number> = {
		0: -90,
		1: 90,
		2: -135,
		3: 135,
		4: -45,
		5: 45,
		6: 0,
		9: 180,
		11: 0,
		12: -30,
		13: 30
	};
	const ROUNDABOUT = new Set([7, 8]);
	const ARRIVAL = 10;
</script>

<svg viewBox="0 0 24 24" class={className} fill="none" stroke="currentColor" aria-hidden="true">
	{#if type === ARRIVAL}
		<path d="M6 21V4M6 4h11l-2.5 4L17 12H6" stroke-width="2" stroke-linejoin="round" />
	{:else if ROUNDABOUT.has(type)}
		<circle cx="12" cy="10" r="4.5" stroke-width="2" />
		<path
			d="M12 22v-7.5M16.5 10H22M19.5 7.5 22 10l-2.5 2.5"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	{:else}
		<g transform="rotate({TURN[type] ?? 0} 12 12)">
			<path
				d="M12 21V4M5.5 10.5 12 4l6.5 6.5"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</g>
	{/if}
</svg>
