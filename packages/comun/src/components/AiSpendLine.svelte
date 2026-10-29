<script lang="ts">
	import { cost, dollars, type AiSpend } from '../ai-spend.ts';

	/**
	 * The AI's spending (#193), in a line under the header when one turns it on in Ajustes, at home
	 * and in the cloud: on the left, OpenRouter's total, month and week for the key; on the right,
	 * the last requests. Live (SSE, `/api/gasto-ia`), as each request comes back and as OpenRouter
	 * says every few minutes.
	 */

	let spend = $state<AiSpend | null>(null);
	$effect(() => {
		const events = new EventSource('/api/gasto-ia');
		events.onmessage = (e) => (spend = JSON.parse(e.data));
		return () => events.close();
	});

	const time = (at: string) =>
		new Date(at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
</script>

{#if spend}
	<div class="flex flex-wrap justify-between gap-x-4 text-xs text-zinc-500">
		<p class="shrink-0 tabular-nums">
			IA: <span class="text-zinc-300">{dollars(spend.total)}</span> en total ·
			<span class="text-zinc-300">{dollars(spend.month)}</span> este mes ·
			<span class="text-zinc-300">{dollars(spend.week)}</span> esta semana
		</p>
		{#if spend.recent.length}
			<p class="min-w-0 truncate">
				{#each spend.recent as last, i (last.at + last.label)}
					{#if i}·{/if}
					<span title={time(last.at)}
						>{last.label} <span class="text-zinc-300 tabular-nums">{cost(last.cost)}</span></span
					>
				{/each}
			</p>
		{/if}
	</div>
{/if}
