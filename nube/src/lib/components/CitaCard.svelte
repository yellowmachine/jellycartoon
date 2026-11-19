<script lang="ts">
	import type { Snippet } from 'svelte';
	import { citaWhen, type Cita } from '#lib/cita.ts';

	/** A plan (#555): what, when, and a note; with whatever may be done with it (`children`). */
	let { cita, children }: { cita: Cita; children?: Snippet } = $props();
</script>

<div class="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
	<p class="font-semibold">📅 {cita.title}</p>
	<p class="text-sm text-zinc-300 first-letter:uppercase">{citaWhen(cita)}</p>
	{#if cita.notes}<p class="mt-1 text-sm text-zinc-400">{cita.notes}</p>{/if}
	{#if children}<div class="mt-3 flex flex-wrap items-center gap-2">{@render children()}</div>{/if}
</div>
