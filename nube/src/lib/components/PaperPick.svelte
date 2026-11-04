<script lang="ts">
	/** «Desde una foto» (the camera on a phone) or «Desde un archivo», for a new paper (#384). */
	let { onpick }: { onpick: (file: File) => void } = $props();

	function picked(input: HTMLInputElement) {
		const file = input.files?.[0];
		// The same file can be chosen again after cancelling.
		input.value = '';
		if (file) onpick(file);
	}

	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<label class="{button} cursor-pointer bg-amber-500 font-medium text-zinc-950 hover:bg-amber-400">
	📷 Desde una foto
	<input
		type="file"
		accept="image/*"
		capture="environment"
		class="hidden"
		onchange={(e) => picked(e.currentTarget)}
	/>
</label>
<label class="{button} cursor-pointer bg-zinc-800 hover:bg-zinc-700">
	📄 Desde un archivo
	<input
		type="file"
		accept="application/pdf,image/jpeg,image/png,image/webp"
		class="hidden"
		onchange={(e) => picked(e.currentTarget)}
	/>
</label>
