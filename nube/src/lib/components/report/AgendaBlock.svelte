<script lang="ts">
	import type { AgendaBlock } from '#lib/reports.ts';

	/** What the agenda had on those days (#505). */
	let { block }: { block: AgendaBlock } = $props();

	const day = (d: string) =>
		new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			timeZone: 'UTC'
		});
</script>

<ul class="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm">
	{#each block.days as d (d.day)}
		<li>
			<a
				href="/agenda?dia={d.day}"
				class="block text-zinc-400 first-letter:uppercase hover:text-white hover:underline"
				>{day(d.day)}</a
			>
			<ul class="ml-4 list-disc text-zinc-200">
				{#each d.events as e, i (i)}<li>{e}</li>{/each}
			</ul>
		</li>
	{/each}
</ul>
