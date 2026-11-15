<script lang="ts">
	import { SURE_DAYS } from '#lib/energy-forecast.ts';

	/**
	 * The next days' cold (Energía → Previsión, #513): a bar a day, its heating degree-days; past the
	 * first week, paler, as the forecast is less sure. Hovering or touching, that day's figures.
	 */
	let {
		days
	}: { days: { day: string; min: number; max: number; mean: number; degrees: number }[] } =
		$props();

	const HEIGHT = 160;
	const PAD = { top: 10, bottom: 22, left: 28, right: 4 };
	let width = $state(600);
	const top = $derived(Math.max(5, Math.ceil(Math.max(...days.map((d) => d.degrees)) / 5) * 5));
	const slot = $derived((width - PAD.left - PAD.right) / days.length);
	const y = (v: number) => PAD.top + (1 - v / top) * (HEIGHT - PAD.top - PAD.bottom);
	const ticks = $derived(top <= 10 ? [0, 5, 10].filter((t) => t <= top) : [0, top / 2, top]);
	const n1 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
	const label = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	let hover = $state<number | null>(null);
</script>

<div class="relative" bind:clientWidth={width}>
	<svg
		viewBox="0 0 {width} {HEIGHT}"
		{width}
		height={HEIGHT}
		role="img"
		aria-label="Grados-día de calefacción de los próximos días"
		class="block touch-pan-y select-none"
		onpointerleave={() => (hover = null)}
	>
		{#each ticks as t (t)}
			<line
				x1={PAD.left}
				x2={width - PAD.right}
				y1={y(t)}
				y2={y(t)}
				class="stroke-zinc-800"
				stroke-width="1"
			/>
			<text x={PAD.left - 6} y={y(t) + 4} text-anchor="end" class="fill-zinc-500 text-[11px]"
				>{t}</text
			>
		{/each}
		{#each days as d, i (d.day)}
			{@const h = y(0) - y(d.degrees)}
			<!-- The whole slot catches the pointer: bigger than the bar. -->
			<rect
				x={PAD.left + i * slot}
				y={PAD.top}
				width={slot}
				height={HEIGHT - PAD.top - PAD.bottom}
				fill="transparent"
				role="presentation"
				onpointerenter={() => (hover = i)}
				onpointerdown={() => (hover = i)}
			/>
			{#if h > 0}
				<rect
					x={PAD.left + i * slot + 1}
					y={y(d.degrees)}
					width={Math.max(slot - 2, 1)}
					height={h}
					rx={Math.min(4, (slot - 2) / 2)}
					class={[
						'pointer-events-none',
						hover === i ? 'fill-sky-300' : i < SURE_DAYS ? 'fill-sky-500' : 'fill-sky-500/40'
					]}
				/>
			{/if}
			{#if i % (days.length > 8 && width < 500 ? 2 : 1) === 0}
				<text
					x={PAD.left + i * slot + slot / 2}
					y={HEIGHT - 6}
					text-anchor="middle"
					class="pointer-events-none fill-zinc-500 text-[10px]">{label(d.day).split(' ')[1]}</text
				>
			{/if}
		{/each}
	</svg>
	{#if hover !== null}
		{@const d = days[hover]!}
		<div
			class="pointer-events-none absolute top-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs shadow-lg"
			style:left="{Math.min(Math.max(PAD.left + hover * slot + slot / 2 - 75, 0), width - 150)}px"
		>
			<p class="text-zinc-400 first-letter:uppercase">
				{label(d.day)}{hover >= SURE_DAYS ? ' · menos seguro' : ''}
			</p>
			<p class="text-zinc-100 tabular-nums">{n1(d.min)} a {n1(d.max)} °C, media {n1(d.mean)}</p>
			<p class="text-zinc-100 tabular-nums">{n1(d.degrees)} grados-día</p>
		</div>
	{/if}
</div>
