<script lang="ts">
	import { dollars, type AiSpend } from '#lib/ai-spend.ts';

	/**
	 * The month's AI spending (#193), in a line under the header when an adult turns it on in
	 * Ajustes: live (SSE), as each request comes back and as OpenRouter says every few minutes.
	 */

	let spend = $state<AiSpend | null>(null);
	$effect(() => {
		const events = new EventSource('/api/gasto-ia');
		events.onmessage = (e) => (spend = JSON.parse(e.data));
		return () => events.close();
	});
</script>

{#if spend}
	<p class="truncate text-center text-xs text-zinc-500">
		IA este mes: <span class="text-zinc-300 tabular-nums">{dollars(spend.month)}</span
		>{#if spend.left !== null}
			· quedan <span class="tabular-nums">{dollars(spend.left)}</span> de crédito{/if}
	</p>
{/if}
