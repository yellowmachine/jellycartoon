<script lang="ts">
	/** The bin on a saved game's card (the TV view and the browser's): it goes at once, unasked. */
	let {
		saveId,
		label,
		ondeleted,
		onfailed,
		class: className
	}: {
		saveId: number;
		/** Which one, for screen readers: all the cards have the same bin. */
		label: string;
		ondeleted: () => void;
		onfailed: () => void;
		class?: string;
	} = $props();

	/** Not `disabled`: that would take the focus away from the remote while it is asked. */
	let busy = false;

	async function remove() {
		if (busy) return;
		busy = true;
		const res = await fetch(`/api/juegos/partida/${saveId}`, { method: 'DELETE' }).catch(
			() => null
		);
		busy = false;
		if (res?.ok) ondeleted();
		else onfailed();
	}
</script>

<button
	type="button"
	onclick={remove}
	aria-label="Borrar la partida del {label}"
	title="Borrar"
	class={[
		'flex shrink-0 items-center justify-center rounded-lg text-zinc-400 transition duration-150 hover:text-red-300 focus-visible:scale-110 focus-visible:bg-red-900 focus-visible:text-red-100',
		className
	]}
>
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class="h-3/5 w-3/5"
	>
		<path
			d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"
		/>
		<path d="M10 11v6M14 11v6" />
	</svg>
</button>
