<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** `<dt>`/`<dd>` pairs. */
		children: Snippet;
	}

	let { title, children }: Props = $props();

	let dialog = $state<HTMLDialogElement>();

	export function open() {
		dialog?.showModal();
	}
</script>

<dialog
	bind:this={dialog}
	closedby="any"
	class="m-auto w-lg max-w-[calc(100vw-2rem)] rounded-md border border-zinc-700 bg-zinc-900 p-5 text-sm text-zinc-100 shadow-lg backdrop:bg-zinc-950/70"
>
	<h2 class="mb-4 font-semibold">{title}</h2>
	<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 [&_dt]:text-zinc-400">
		{@render children()}
	</dl>
	<form method="dialog" class="mt-5 text-right">
		<button class="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800">Cerrar</button>
	</form>
</dialog>
