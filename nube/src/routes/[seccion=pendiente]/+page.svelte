<script lang="ts">
	import { page } from '$app/state';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { atHome } from '#lib/nav.ts';
	import type { PageProps } from './$types';

	/** A section still at home, moving to the cloud (#253): said, with the way to it at home. */
	let { data }: PageProps = $props();

	const name = $derived(page.params.seccion!);
	const title = $derived(name[0]!.toUpperCase() + name.slice(1));
</script>

<svelte:head><title>{title} · Nube</title></svelte:head>

<div class="mx-auto mt-16 max-w-md text-center">
	<SectionIcon name={name as never} class="mx-auto mb-4 h-16 w-16 text-zinc-500" />
	<h1 class="mb-2 text-2xl font-bold">{title}</h1>
	<p class="mb-6 text-zinc-400">
		Esto todavía está en casa: pronto estará también aquí, en la nube.
	</p>
	{#if data.webUrl}
		<a
			href={atHome(data.webUrl, `/${name}`)}
			class="rounded-md bg-amber-500 px-5 py-2 font-medium text-zinc-950 hover:bg-amber-400"
			>Abrirlo en casa</a
		>
		<p class="mt-3 text-xs text-zinc-500">Solo abre en casa o con la VPN.</p>
	{:else}
		<p class="text-sm text-zinc-400">
			Para ir desde aquí, pon la dirección de jellycartoon en
			<a href="/ajustes?seccion=familia#casa" class="text-amber-400 hover:underline">Ajustes</a>.
		</p>
	{/if}
</div>
