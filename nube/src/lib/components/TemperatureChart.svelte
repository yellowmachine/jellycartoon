<script lang="ts">
	import type { TemperatureSeries } from '#lib/temperature.ts';

	/**
	 * Temperatures hour by hour (Enchufes → Temperatura, #508): one line each, «Fuera» grey and
	 * dashed (beside others: alone, solid) as the reference the rooms' sensors are drawn against. The hours are Spain's, as
	 * written (`YYYY-MM-DDTHH:MM`): placed and told as they are, without time zones. Hovering, the
	 * hour under the pointer and each line's value there.
	 */

	let { series }: { series: TemperatureSeries[] } = $props();

	const HEIGHT = 220;
	const PAD = { top: 12, right: 12, bottom: 24, left: 36 };
	let width = $state(600);

	const time = (at: string) => Date.parse(`${at}:00Z`);
	const all = $derived(series.flatMap((s) => s.points));
	const t0 = $derived(Math.min(...all.map((p) => time(p.at))));
	const t1 = $derived(Math.max(...all.map((p) => time(p.at))));
	/** The degrees shown: whole steps of `step` around the readings, a degree of room. */
	const step = $derived.by(() => {
		const span =
			Math.max(...all.map((p) => p.temperature)) - Math.min(...all.map((p) => p.temperature));
		return span > 20 ? 10 : span > 8 ? 5 : 2;
	});
	const lo = $derived(Math.floor((Math.min(...all.map((p) => p.temperature)) - 1) / step) * step);
	const hi = $derived(Math.ceil((Math.max(...all.map((p) => p.temperature)) + 1) / step) * step);
	const x = (t: number) =>
		PAD.left + ((t - t0) / Math.max(t1 - t0, 1)) * (width - PAD.left - PAD.right);
	const y = (c: number) => PAD.top + ((hi - c) / (hi - lo)) * (HEIGHT - PAD.top - PAD.bottom);

	const yTicks = $derived(
		Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step)
	);
	/** Midnights: each day's line; named every day, or every week over a month. */
	const xTicks = $derived.by(() => {
		const out: { t: number; label: string | null }[] = [];
		const first = new Date(t0);
		first.setUTCHours(24, 0, 0, 0);
		const days = (t1 - t0) / 86_400_000;
		const every = days > 10 ? 7 : 1;
		for (let t = first.getTime(), i = 0; t <= t1; t += 86_400_000, i++) {
			// Over a month, only the named days have their line; none named too near the edge.
			if (every > 1 && i % every) continue;
			out.push({
				t,
				label:
					i % every === 0 && x(t) + 44 <= width - PAD.right
						? new Date(t).toLocaleDateString('es-ES', {
								weekday: 'short',
								day: 'numeric',
								timeZone: 'UTC'
							})
						: null
			});
		}
		return out;
	});

	const path = (points: TemperatureSeries['points']) =>
		points
			.map((p, i) => `${i ? 'L' : 'M'}${x(time(p.at)).toFixed(1)},${y(p.temperature).toFixed(1)}`)
			.join('');

	const degrees = (c: number) =>
		`${c.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`;
	const hourText = (t: number) =>
		new Date(t).toLocaleString('es-ES', {
			weekday: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'UTC'
		});

	/** The hour under the pointer, and each line's reading nearest to it. */
	let hover = $state<number | null>(null);
	const hovered = $derived.by(() => {
		if (hover === null) return null;
		const t = hover;
		const values = series.map((s) => {
			let best = s.points[0];
			for (const p of s.points)
				if (Math.abs(time(p.at) - t) < Math.abs(time(best!.at) - t)) best = p;
			return { s, p: best };
		});
		const at = values[0]?.p ? time(values[0].p.at) : t;
		return { at, values };
	});
	function move(event: PointerEvent) {
		const box = (event.currentTarget as SVGElement).getBoundingClientRect();
		const px = event.clientX - box.left;
		const t = t0 + ((px - PAD.left) / (width - PAD.left - PAD.right)) * (t1 - t0);
		hover = Math.min(Math.max(t, t0), t1);
	}
</script>

{#if all.length > 1}
	<div class="relative" bind:clientWidth={width}>
		<svg
			viewBox="0 0 {width} {HEIGHT}"
			{width}
			height={HEIGHT}
			role="img"
			aria-label="Temperatura hora a hora"
			class="block touch-pan-y select-none"
			onpointermove={move}
			onpointerdown={move}
			onpointerleave={() => (hover = null)}
		>
			{#each yTicks as c (c)}
				<line
					x1={PAD.left}
					x2={width - PAD.right}
					y1={y(c)}
					y2={y(c)}
					class="stroke-zinc-800"
					stroke-width="1"
				/>
				<text x={PAD.left - 6} y={y(c) + 4} text-anchor="end" class="fill-zinc-500 text-[11px]"
					>{c}°</text
				>
			{/each}
			{#each xTicks as tick (tick.t)}
				<line
					x1={x(tick.t)}
					x2={x(tick.t)}
					y1={PAD.top}
					y2={HEIGHT - PAD.bottom}
					class="stroke-zinc-800/60"
					stroke-width="1"
				/>
				{#if tick.label}
					<text x={x(tick.t) + 3} y={HEIGHT - 8} class="fill-zinc-500 text-[11px]"
						>{tick.label}</text
					>
				{/if}
			{/each}
			{#each series as s (s.name)}
				<path
					d={path(s.points)}
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					stroke-dasharray={s.dashed && series.length > 1 ? '5 4' : undefined}
					class={s.color}
				/>
			{/each}
			{#if hovered}
				<line
					x1={x(hovered.at)}
					x2={x(hovered.at)}
					y1={PAD.top}
					y2={HEIGHT - PAD.bottom}
					class="stroke-zinc-500"
					stroke-width="1"
				/>
				{#each hovered.values as v (v.s.name)}
					{#if v.p}
						<circle
							cx={x(time(v.p.at))}
							cy={y(v.p.temperature)}
							r="4"
							fill="currentColor"
							class="{v.s.color} stroke-zinc-950"
							stroke-width="2"
						/>
					{/if}
				{/each}
			{/if}
		</svg>
		{#if hovered}
			<div
				class="pointer-events-none absolute top-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs shadow-lg"
				style:left="{Math.min(Math.max(x(hovered.at) - 70, 0), width - 140)}px"
			>
				<p class="text-zinc-400 first-letter:uppercase">{hourText(hovered.at)}</p>
				{#each hovered.values as v (v.s.name)}
					{#if v.p}
						<p class="text-zinc-100">
							{#if series.length > 1}<span class="text-zinc-400">{v.s.name}</span>{/if}
							<span class="tabular-nums">{degrees(v.p.temperature)}</span>
						</p>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
	{#if series.length > 1}
		<ul class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
			{#each series as s (s.name)}
				<li class="flex items-center gap-1.5">
					<svg viewBox="0 0 20 4" class="h-1 w-5 {s.color}" aria-hidden="true"
						><line
							x1="0"
							x2="20"
							y1="2"
							y2="2"
							stroke="currentColor"
							stroke-width="3"
							stroke-dasharray={s.dashed ? '5 4' : undefined}
						/></svg
					>
					{s.name}
				</li>
			{/each}
		</ul>
	{/if}
{/if}
