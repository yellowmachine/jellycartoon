<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const link = (href: string) =>
		`rounded-md px-3 py-1 ${page.url.pathname === href ? 'bg-zinc-800 text-amber-300' : 'text-zinc-300 hover:bg-zinc-900'}`;
</script>

<svelte:head><title>Nube</title></svelte:head>

{#if data.user}
	<header class="border-b border-zinc-800">
		<nav class="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 text-sm">
			<a href="/" class="mr-auto font-bold text-amber-400">
				Nube{#if data.family}<span class="font-normal text-zinc-400">
						· {data.family.name}</span
					>{/if}
			</a>
			<a href="/nevera" class={link('/nevera')}>Nevera</a>
			<a href="/recetas" class={link('/recetas')}>Recetas</a>
			<a href="/ajustes" class={link('/ajustes')}>Ajustes</a>
			<form method="post" action="/logout">
				<button class="rounded-md px-3 py-1 text-zinc-400 hover:bg-zinc-900">Salir</button>
			</form>
		</nav>
	</header>
{/if}

<main class="mx-auto max-w-3xl px-4 py-6">
	{#if data.user && !data.family}
		<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
			Tu cuenta no está en ninguna familia. Pide a quien administra la tuya que te invite.
		</p>
	{:else}
		{@render children()}
	{/if}
</main>
