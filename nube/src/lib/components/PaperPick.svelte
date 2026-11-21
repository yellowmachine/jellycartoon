<script lang="ts">
	/**
	 * «Desde una foto» (the camera on a phone) or «Desde un archivo», for a new paper (#384); with
	 * `adding`, one more page of the paper being written, its sheets put together in one PDF.
	 * Several files can be chosen at once.
	 */
	let { onpick, adding = false }: { onpick: (files: File[]) => void; adding?: boolean } = $props();

	function picked(input: HTMLInputElement) {
		const files = [...(input.files ?? [])];
		// The same file can be chosen again after cancelling.
		input.value = '';
		if (files.length) onpick(files);
	}

	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<label
	class={[
		button,
		'cursor-pointer',
		adding
			? 'bg-zinc-800 hover:bg-zinc-700'
			: 'bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400'
	]}
>
	📷 {adding ? 'Otra página' : 'Desde una foto'}
	<input
		type="file"
		accept="image/*"
		capture="environment"
		class="hidden"
		onchange={(e) => picked(e.currentTarget)}
	/>
</label>
<label class="{button} cursor-pointer bg-zinc-800 hover:bg-zinc-700">
	📄 {adding ? 'Añadir un archivo' : 'Desde un archivo'}
	<input
		type="file"
		accept="application/pdf,image/*"
		multiple
		class="hidden"
		onchange={(e) => picked(e.currentTarget)}
	/>
</label>
