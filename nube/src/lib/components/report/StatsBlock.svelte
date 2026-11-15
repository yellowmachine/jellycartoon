<script lang="ts">
	import { euros } from 'comun/expenses.ts';
	import { keptExpenses, type StatsBlock } from '#lib/reports.ts';

	/** A report's figures (#505): tiles, the spent without the expenses taken away. */
	let { block, excluded }: { block: StatsBlock; excluded: number[] } = $props();

	const km = (m: number) => `${Math.round(m / 1000).toLocaleString('es-ES')} km`;
	const spent = $derived(keptExpenses(block.expenses, excluded).reduce((s, e) => s + e.total, 0));
	const tiles = $derived([
		{ label: block.days === 1 ? 'día' : 'días', value: String(block.days) },
		{
			label: `en coche · ${block.drives} ${block.drives === 1 ? 'trayecto' : 'trayectos'}`,
			value: km(block.driven)
		},
		{
			label: `andando · ${block.walks} ${block.walks === 1 ? 'paseo' : 'paseos'}`,
			value: km(block.walked)
		},
		{ label: block.photos === 1 ? 'foto' : 'fotos', value: String(block.photos) },
		{ label: 'gastado', value: euros(spent) }
	]);
</script>

<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
	{#each tiles as t (t.label)}
		<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
			<dt class="text-xs text-zinc-400">{t.label}</dt>
			<dd class="mt-1 text-xl font-semibold text-zinc-100 tabular-nums">{t.value}</dd>
		</div>
	{/each}
</dl>
