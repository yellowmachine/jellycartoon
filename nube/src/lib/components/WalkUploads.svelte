<script lang="ts">
	import { walkUploads as uploads } from '#lib/walk-uploads.svelte.ts';

	/**
	 * How the photos and notes on this device are going (#416): being sent, waiting, or refused by the
	 * server, which stay here until someone decides.
	 */
	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
	const words = (n: number) => (n === 1 ? '1 foto o nota' : `${n} fotos o notas`);

	let asking = $state<string | null>(null);
</script>

{#if uploads.sending && uploads.total}
	<p class="mb-4 rounded-md bg-zinc-800 p-3 text-sm" role="status">
		Subiendo fotos y notas: {Math.min(uploads.done + 1, uploads.total)} de {uploads.total}…
	</p>
{:else if uploads.waiting}
	<div class="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-amber-500/15 p-3 text-sm">
		<p class="min-w-0 flex-1 text-amber-200" role="status">
			{words(uploads.waiting)} sin enviar{uploads.problem ? `: ${uploads.problem}` : ''}. Están
			guardadas en este móvil.
		</p>
		<button class="font-medium text-amber-400 hover:underline" onclick={() => uploads.retry()}
			>Enviar</button
		>
	</div>
{/if}
{#each uploads.rejected as r (r.id)}
	<div class="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-amber-500/15 p-3 text-sm">
		<p class="min-w-0 flex-1 text-amber-200" role="alert">
			{r.kind === 'foto' ? 'La foto' : 'La nota'} de las {time.format(r.at)} no se ha podido subir:
			{r.why}. Sigue en este móvil.
		</p>
		{#if asking === r.id}
			<span>¿Tirarla?</span>
			<button class="font-medium text-red-400" onclick={() => uploads.discard(r.id)}>Sí</button>
			<button class="font-medium" onclick={() => (asking = null)}>No</button>
		{:else}
			<button
				class="font-medium text-amber-400 hover:underline"
				onclick={() => uploads.retryRejected(r.id)}>Reintentar</button
			>
			<button class="font-medium text-zinc-400 hover:underline" onclick={() => (asking = r.id)}
				>Tirar</button
			>
		{/if}
	</div>
{/each}
