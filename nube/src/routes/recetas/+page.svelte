<script lang="ts">
	import { enhance } from '$app/forms';
	import Backdrop from '#lib/components/Backdrop.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Reading the page and preparing its steps: some seconds with the AI. */
	let saving = $state(false);
</script>

<svelte:head>
	<title>Recetario · Nube</title>
</svelte:head>

{#if data.backdrop}<Backdrop src={data.backdrop} />{/if}

<h1 class="mb-1 text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">Recetario</h1>
<p class="mb-4 max-w-2xl text-sm text-zinc-400">
	Las recetas de la familia. Se guardan desde la página de una web de cocina: pega aquí su
	dirección. Con la clave de OpenRouter (Ajustes), sus pasos quedan cortos y con sus temporizadores,
	para cocinarlas por voz en casa.
</p>

<form
	method="post"
	action="?/import"
	class="mb-2 flex max-w-2xl gap-2"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
>
	<input
		type="url"
		name="url"
		value={form?.url ?? data.shared ?? ''}
		required
		autocomplete="url"
		placeholder="https://…/receta-de-macarrones"
		aria-label="Dirección de la receta"
		class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
	/>
	<button
		class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		disabled={saving}>{saving ? 'Leyendo la receta…' : 'Guardar'}</button
	>
</form>
{#if form?.error}
	<p class="mb-4 text-sm text-red-400">{form.error}</p>
{:else if data.shared}
	<p class="mb-4 text-sm text-amber-300">Compartida desde el móvil: pulsa «Guardar».</p>
{/if}

<section class="mt-6">
	{#if !data.recipes.length}
		<p class="text-sm text-zinc-400">Todavía no hay ninguna.</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
			{#each data.recipes as r (r.id)}
				{@const isBackdrop = r.id === data.backdropId}
				<div class="group relative min-w-0">
					<a href="/recetas/{r.id}" class="block">
						{#if r.imageUrl}
							<img
								src={r.imageUrl}
								alt=""
								loading="lazy"
								referrerpolicy="no-referrer"
								class="mb-2 aspect-square w-full rounded-md bg-zinc-800 object-cover group-hover:opacity-80"
							/>
						{:else}
							<span
								class="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-zinc-800 text-zinc-600"
								><span class="text-4xl" aria-hidden="true">🍳</span></span
							>
						{/if}
						<span class="block truncate text-sm group-hover:text-amber-400">{r.title}</span>
						<span class="block truncate text-xs text-zinc-500">{r.sourceName}</span>
					</a>
					<!-- Outside the link, on a layer as big as the picture, in its corner: shown on hover
				     (always by touch, or if it is the background already). -->
					{#if r.imageUrl}
						<div class="pointer-events-none absolute inset-x-0 top-0 aspect-square">
							<form
								method="post"
								action="?/backdrop"
								use:enhance
								class={[
									'pointer-events-auto absolute right-2 bottom-2',
									!isBackdrop &&
										'opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100'
								]}
							>
								<input type="hidden" name="id" value={r.id} />
								<button
									class={[
										'rounded-md p-1.5 backdrop-blur-sm',
										isBackdrop
											? 'bg-amber-500 text-zinc-950'
											: 'bg-zinc-950/70 text-zinc-200 hover:bg-zinc-950'
									]}
									aria-pressed={isBackdrop}
									title={isBackdrop ? 'Quitar esta imagen del fondo' : 'Poner esta imagen de fondo'}
									aria-label={isBackdrop
										? `Quitar la imagen de ${r.title} del fondo`
										: `Poner la imagen de ${r.title} de fondo`}
								>
									<svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
										<g
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<rect x="3" y="4" width="18" height="16" rx="2" />
											<circle cx="9" cy="10" r="1.5" />
											<path d="M21 16l-5-5-8 9" />
										</g>
									</svg>
								</button>
							</form>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
