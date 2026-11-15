<script lang="ts">
	import type { MoveRef } from '#lib/reports.ts';

	/** Under a report's map (#505): each drive and walk drawn, opened in Viajes or Paseos. */
	let { moves }: { moves: MoveRef[] } = $props();

	const when = new Intl.DateTimeFormat('es-ES', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
	const km = (m: number) =>
		`${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;
	const href = (m: MoveRef) =>
		m.from === 'viaje' ? `/viajes/hechos?viaje=${m.id}` : `/paseos?paseo=${m.id}`;
</script>

<ul class="divide-y divide-zinc-800 rounded-xl border border-zinc-800 bg-zinc-900 text-sm">
	{#each moves as m (`${m.from}${m.id}`)}
		<li>
			<a href={href(m)} class="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800">
				<span aria-hidden="true">{m.from === 'viaje' ? '🚗' : '🚶'}</span>
				<span class="w-36 shrink-0 text-zinc-400 first-letter:uppercase"
					>{when.format(new Date(m.at))}</span
				>
				<span class="min-w-0 flex-1 truncate text-zinc-200"
					>{m.destination ?? (m.from === 'viaje' ? 'Trayecto' : 'Paseo')}</span
				>
				<span class="shrink-0 text-zinc-400 tabular-nums">{km(m.distance)}</span>
				<span class="shrink-0 text-zinc-500" aria-hidden="true">→</span>
			</a>
		</li>
	{/each}
</ul>
