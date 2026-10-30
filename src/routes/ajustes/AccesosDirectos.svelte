<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { enhance } from '$app/forms';
	import { section, select, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Accesos directos de la vista TV (#327): webs de fuera, cada una en su ventana. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.shortcuts}
	<section class={section} id="accesos-directos">
		<h2 class="mb-1 font-semibold">Accesos directos de la tele</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Webs de fuera (NBA League Pass, Crunchyroll…) en la vista TV, cada una en su ventana: el botón
			de encendido del mando va de la web a la vista TV y vuelve. La sesión de cada web se inicia
			una vez a mano en el navegador de la tele. Con la etiqueta «infantil» la ven también los
			peques, y el tiempo que está abierta delante cuenta en su límite del día.
		</p>
		{#snippet shortcutForm(s: { id: number; name: string; url: string; tags: string[] } | null)}
			<form
				method="post"
				action="?seccion={tab}&/saveShortcut"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: !s })}
				class="flex flex-col gap-2"
			>
				{#if s}<input type="hidden" name="id" value={s.id} />{/if}
				<input
					name="name"
					required
					maxlength="40"
					value={s?.name ?? ''}
					placeholder="Crunchyroll"
					aria-label="Nombre"
					class="{select} min-w-0"
				/>
				<input
					name="url"
					type="url"
					required
					value={s?.url ?? ''}
					placeholder="https://www.crunchyroll.com/es/"
					aria-label="Dirección"
					class="{select} min-w-0"
				/>
				<input
					name="tags"
					value={s?.tags.join(', ') ?? ''}
					placeholder="infantil, dibujos"
					aria-label="Etiquetas, separadas por comas"
					class="{select} min-w-0"
				/>
				<div class="flex items-center gap-3">
					<button class={secondary}>{s ? 'Guardar' : 'Añadir'}</button>
					{#if s}
						<button
							formaction="?seccion={tab}&/deleteShortcut"
							formnovalidate
							class="text-sm text-red-400 hover:underline">Borrar</button
						>
					{/if}
				</div>
			</form>
		{/snippet}
		{#if data.shortcuts.length}
			<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
				{#each data.shortcuts as s (s.id)}
					<li>
						<details>
							<summary class="flex cursor-pointer items-center gap-3 p-2">
								<span class="shrink-0 font-medium">{s.name}</span>
								<span class="min-w-0 flex-1 truncate text-zinc-400">{s.url}</span>
								{#each s.tags as t (t)}
									<span class="shrink-0 rounded-full bg-zinc-800 px-2 text-xs text-zinc-300"
										>{t}</span
									>
								{/each}
							</summary>
							<div class="border-t border-zinc-800 p-3">{@render shortcutForm(s)}</div>
						</details>
					</li>
				{/each}
			</ul>
		{/if}
		<h3 class="mb-2 text-sm text-zinc-300">Nuevo acceso directo</h3>
		{@render shortcutForm(null)}
		<p class="mt-2 text-xs text-zinc-500">
			Borrar uno borra también el tiempo que los peques pasaron en él.
		</p>
		{#if form && 'section' in form && form.section === 'shortcuts'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{:else if form && 'saved' in form && form.saved === 'shortcut'}
			<Guardado class="mt-3 block text-sm text-amber-400">✓ Guardado</Guardado>
		{/if}
	</section>
{/if}
