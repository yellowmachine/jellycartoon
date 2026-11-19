<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Mensajes (#551): this person's devices with messages on. One lost or not used any more, out: at
	 * the next change of each conversation it stops reading what is written from then on.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();

	const when = (d: Date) =>
		new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

{#if data.messageDevices.length}
	<section class={section} id="aparatos-mensajes">
		<h2 class="mb-1 font-semibold">Tus aparatos con mensajes</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Los que tienen sus llaves de los mensajes. Si pierdes uno, quítalo: dejará de leer lo que se
			escriba desde entonces.
		</p>
		<ul class="divide-y divide-zinc-800">
			{#each data.messageDevices as d (d.id)}
				<li class="flex items-center gap-3 py-2 text-sm">
					<span class="min-w-0 flex-1">
						{d.name}
						<span class="block text-xs text-zinc-500"
							>Desde el {when(d.createdAt)} · visto el {when(d.seenAt)}</span
						>
					</span>
					<form method="post" action="?seccion={tab}&/revokeMessageDevice" use:enhance>
						<input type="hidden" name="id" value={d.id} />
						<button class="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-800"
							>Quitar</button
						>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}
