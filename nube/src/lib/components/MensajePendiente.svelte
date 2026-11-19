<script lang="ts">
	import { messagesVoice } from '#lib/mensajes/voice-messages.svelte.ts';

	/**
	 * Mensajes (#551): a voice message being recorded, or recorded and waiting for its «sí»: also with
	 * a touch, as the voice may not have heard the answer. `big`: the road mode's.
	 */
	let { big = false }: { big?: boolean } = $props();
	const v = messagesVoice;
	const button = $derived(
		big ? 'rounded-xl px-5 py-3 text-lg font-semibold' : 'rounded-md px-3 py-1 text-sm'
	);
</script>

{#if v.recording || v.busy || v.pending}
	<div
		class={[
			'flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10',
			big ? 'p-4 text-lg' : 'px-3 py-2 text-sm'
		]}
		role="status"
	>
		{#if v.recording}
			<span class="flex-1 text-red-300">● Grabando el mensaje… para cuando te calles</span>
		{:else if v.busy}
			<span class="flex-1">{v.busy}</span>
		{:else if v.pending}
			<span class="min-w-0 flex-1"
				>Mensaje para {v.pending.name}{v.pending.transcript
					? `: «${v.pending.transcript}»`
					: ` (audio de ${Math.round(v.pending.seconds)} s)`}</span
			>
			<button
				class={[button, 'bg-amber-500 text-zinc-950 hover:bg-amber-400']}
				onclick={() => void v.answer(true)}>Enviar</button
			>
			<button
				class={[button, 'border border-zinc-700 hover:bg-zinc-800']}
				onclick={() => void v.answer(false)}>Borrar</button
			>
		{/if}
	</div>
{/if}
