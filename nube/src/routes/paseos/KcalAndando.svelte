<!--
@component
Paseos: the kcal of going on foot, week by week, the walks and OwnTracks together; one's own.
-->
<script lang="ts">
	import { kcalText, type FootWeek } from '#lib/walk-kcal.ts';

	let { weeks }: { weeks: FootWeek[] } = $props();

	let picked = $state<string | null>(null);
	const last = $derived(weeks[weeks.length - 1]!);
	const shown = $derived(weeks.find((w) => w.week === picked) ?? last);
	const highest = $derived(Math.max(...weeks.map((w) => w.kcal ?? 0), 1));

	const shortDay = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const km = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`;
</script>

<section class="mb-8 rounded-md border border-zinc-800 p-3">
	<h2 class="mb-1 text-sm text-zinc-400">Kcal gastadas andando, por semana</h2>
	<p class="mb-3 text-sm text-zinc-300">
		Semana del {shortDay(shown.week)}{shown.week === last.week ? ' (va por aquí)' : ''}:
		<span class="font-semibold text-sky-300 tabular-nums">{kcalText(shown.kcal ?? 0)}</span>
		· {km(shown.km)}
	</p>
	<div class="flex h-24 items-end gap-1">
		{#each weeks as w (w.week)}
			<button
				class="flex h-full flex-1 items-end"
				aria-label="Semana del {shortDay(w.week)}: {kcalText(w.kcal ?? 0)}, {km(w.km)}"
				aria-pressed={w.week === shown.week}
				onclick={() => (picked = w.week)}
			>
				<span
					class={[
						'block w-full rounded-t',
						w.week === last.week ? 'bg-sky-500/50' : 'bg-sky-500',
						w.week === shown.week && 'ring-2 ring-zinc-100'
					]}
					style:height="{((w.kcal ?? 0) / highest) * 100}%"
				></span>
			</button>
		{/each}
	</div>
	<div class="mt-1 flex gap-1 text-center text-[0.65rem] text-zinc-500">
		{#each weeks as w (w.week)}
			<span class="flex-1 truncate">{shortDay(w.week)}</span>
		{/each}
	</div>
	<details class="mt-2 text-xs text-zinc-500">
		<summary class="cursor-pointer">Cómo se calcula</summary>
		<p class="mt-1">
			Por tus km y <a href="/ajustes?seccion=mi#peso" class="text-amber-400 hover:underline"
				>tu peso</a
			>
			de entonces: unas 0,5 kcal por kilo y km andando, y 1 corriendo. Es lo que gastas de más por andar,
			no el total del día, y en llano: las cuestas no cuentan. Orientativo.
		</p>
	</details>
</section>
