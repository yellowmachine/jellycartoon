<script lang="ts">
	import { enhance } from '$app/forms';

	interface Props {
		/** After deleting: e.g. to clear a selection. */
		ondeleted?: () => void;
	}

	let { ondeleted }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	let ids = $state<number[]>([]);
	/** The episode's title, when there is only one. */
	let title = $state<string | null>(null);
	let deleting = $state(false);

	export function open(episodeIds: number[], episodeTitle: string | null = null) {
		ids = episodeIds;
		title = episodeTitle;
		dialog?.showModal();
	}
</script>

<dialog
	bind:this={dialog}
	closedby="any"
	class="m-auto w-lg max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 p-5 text-sm text-zinc-100 shadow-lg backdrop:bg-zinc-950/70"
>
	<h2 class="mb-3 font-semibold">
		{title ? `¿Borrar «${title}»?` : `¿Borrar ${ids.length} capítulos?`}
	</h2>
	<p class="text-zinc-300">
		Se borran para siempre: el original de la carpeta de medios (y sus subtítulos), lo convertido,
		el progreso y su sitio en las listas. No se puede deshacer, y el escaneo no los vuelve a traer.
	</p>
	<form
		method="post"
		action="?/deleteEpisodes"
		use:enhance={() => {
			deleting = true;
			return async ({ result, update }) => {
				await update();
				deleting = false;
				dialog?.close();
				if (result.type === 'success') ondeleted?.();
			};
		}}
		class="mt-5 flex justify-end gap-2"
	>
		{#each ids as id (id)}
			<input type="hidden" name="id" value={id} />
		{/each}
		<button
			type="button"
			class="rounded-md px-3 py-1 text-zinc-400 hover:text-white"
			onclick={() => dialog?.close()}>Cancelar</button
		>
		<button
			disabled={deleting}
			class="rounded-md bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-500 disabled:opacity-50"
		>
			{deleting ? 'Borrando…' : 'Borrar para siempre'}
		</button>
	</form>
</dialog>
