<script lang="ts">
	import Guardado from 'comun/components/Guardado.svelte';
	import { SHORTCUT_KINDS } from '#lib/tv-shortcut-kinds.ts';
	import AccesoDirectoForm from './AccesoDirectoForm.svelte';
	import { section } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Accesos directos de la vista TV: webs de fuera, cada una en su ventana (#327), o cualquier cosa
	 * de la propia vista TV (#343).
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.shortcuts}
	<section class={section} id="accesos-directos">
		<h2 class="mb-1 font-semibold">Accesos directos de la tele</h2>
		<p class="mb-2 text-sm text-zinc-400">
			Lo que más se usa, a mano al abrir la vista TV: una serie, una película, un canal, una
			emisora, un podcast, un álbum, una lista, un juego… Los que tienen ficha la abren; un canal,
			una emisora o un juego de Steam se ponen en marcha directamente. Los peques ven los que son
			para ellos (una serie o película «infantil», sus canales, la radio y la música), sin tener que
			etiquetar el acceso.
		</p>
		<p class="mb-4 text-sm text-zinc-400">
			También webs de fuera (NBA League Pass, Crunchyroll…), cada una en su ventana: el botón de
			encendido del mando va de la web a la vista TV y vuelve. La sesión de cada web se inicia una
			vez a mano en el navegador de la tele. Con la etiqueta «infantil» la ven también los peques, y
			el tiempo que está abierta delante cuenta en su límite del día. El icono sale de la propia
			web, al guardarlo.
		</p>
		{#if data.shortcuts.length}
			<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
				{#each data.shortcuts as s (s.id)}
					<li>
						<details>
							<summary class="flex cursor-pointer items-center gap-3 p-2">
								{#if s.icon}
									<img
										src="/api/accesos/{s.id}/icono?{s.icon}"
										alt=""
										class="h-6 w-6 shrink-0 rounded"
									/>
								{/if}
								<span class="shrink-0 font-medium">{s.name}</span>
								{#if s.gone}
									<span class="min-w-0 flex-1 truncate text-red-400"
										>{SHORTCUT_KINDS[s.kind]} · ya no está</span
									>
								{:else}
									<span class="min-w-0 flex-1 truncate text-zinc-400"
										>{s.url ??
											(s.opens === s.name
												? SHORTCUT_KINDS[s.kind]
												: `${SHORTCUT_KINDS[s.kind]} · ${s.opens}`)}</span
									>
								{/if}
								{#each s.tags as t (t)}
									<span class="shrink-0 rounded-full bg-zinc-800 px-2 text-xs text-zinc-300"
										>{t}</span
									>
								{/each}
							</summary>
							<div class="border-t border-zinc-800 p-3"><AccesoDirectoForm {s} {tab} /></div>
						</details>
					</li>
				{/each}
			</ul>
		{/if}
		<h3 class="mb-2 text-sm text-zinc-300">Nuevo acceso directo</h3>
		<AccesoDirectoForm s={null} {tab} />
		<p class="mt-2 text-xs text-zinc-500">
			Borrar uno borra también el tiempo que los peques pasaron en él.
		</p>
		{#if form && 'section' in form && form.section === 'shortcuts'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{:else if form && 'noIcon' in form && form.noIcon}
			<p class="mt-3 text-sm text-amber-400">
				Guardado, sin icono: la web no deja leerlo desde el servidor o no tiene uno grande. El
				recuadro sale con su nombre.
			</p>
		{:else if form && 'saved' in form && form.saved === 'shortcut'}
			<Guardado class="mt-3 block text-sm text-amber-400">✓ Guardado</Guardado>
		{/if}
	</section>
{/if}
