<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	/**
	 * The family's AI stopped (ai-block.ts), to who runs it: why, where to recharge and «Ya he
	 * recargado»; the key's own limit reached, where to raise it; a key OpenRouter refuses, to
	 * Ajustes, where another one sets it going.
	 */
	let { why }: { why: string } = $props();

	const badKey = $derived(why.startsWith('OpenRouter no acepta la clave'));
	const keyLimit = $derived(why.startsWith('La clave de OpenRouter ha llegado a su límite'));
	let sending = $state(false);

	async function recharged() {
		sending = true;
		await fetch('/api/ajustes/ia-recargada', { method: 'POST' }).catch(() => {});
		await invalidateAll();
		sending = false;
	}
</script>

<!-- Nothing goes to the AI until then: the voice, the DJ, receipts… -->
<div
	class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-sm text-red-300"
	role="alert"
>
	{#if badKey}
		<span>
			La IA de la familia está parada: OpenRouter no acepta la clave. Pon otra en
			<a href="/ajustes?seccion=familia#ia" class="underline">Ajustes</a>.
		</span>
	{:else if keyLimit}
		<span>
			La IA de la familia está parada: la clave de OpenRouter ha llegado a su límite de gasto.
			Súbelo en
			<a href="https://openrouter.ai/keys" class="underline" target="_blank" rel="noreferrer"
				>openrouter.ai/keys</a
			>, o espera a que se reinicie.
		</span>
		<button
			class="rounded-md bg-red-500/20 px-3 py-1 text-red-100 hover:bg-red-500/30 disabled:opacity-50"
			disabled={sending}
			onclick={recharged}>Ya lo he subido</button
		>
	{:else}
		<span>
			La IA de la familia está parada: {why.toLowerCase()}. No funcionan la voz, el DJ ni los
			tickets. Recárgalo en
			<a
				href="https://openrouter.ai/settings/credits"
				class="underline"
				target="_blank"
				rel="noreferrer">openrouter.ai</a
			>.
		</span>
		<button
			class="rounded-md bg-red-500/20 px-3 py-1 text-red-100 hover:bg-red-500/30 disabled:opacity-50"
			disabled={sending}
			onclick={recharged}>Ya he recargado</button
		>
	{/if}
</div>
