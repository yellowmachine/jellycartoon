<script lang="ts">
	import { enhance } from '$app/forms';
	import { SHADERS, shaderName, type Shader } from '#lib/game-shaders.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const all = $derived<Shader>(data.all ?? 'disabled');
	const systemShader = (id: string) => data.systems.find((s) => s.id === id)?.shader ?? all;

	let search = $state('');
	/** The games with their own, and those found: a console may have hundreds. */
	const games = $derived.by(() => {
		const words = search.trim().toLowerCase();
		return data.systems
			.flatMap((s) => s.games.map((g) => ({ ...g, system: s.id, systemName: s.name })))
			.filter((g) => g.shader || (words && g.title.toLowerCase().includes(words)))
			.slice(0, 40);
	});
</script>

<svelte:head>
	<title>Shaders · Juegos · JellyCartoon</title>
</svelte:head>

<!-- A select that saves as soon as it changes; `inherit` names what an empty one leaves. -->
{#snippet choose(fields: Record<string, string>, value: string | null, inherit: string | null)}
	<form
		method="post"
		action="?/set"
		use:enhance={() =>
			({ update }) =>
				update({ reset: false })}
	>
		{#each Object.entries(fields) as [name, v] (name)}
			<input type="hidden" {name} value={v} />
		{/each}
		<select
			name="shader"
			value={value ?? ''}
			onchange={(e) => e.currentTarget.form?.requestSubmit()}
			class="w-full rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm sm:w-72"
		>
			{#if inherit}
				<option value="">{inherit}</option>
			{/if}
			{#each SHADERS as s (s.id)}
				<option value={s.id}>{s.name} · {s.description}</option>
			{/each}
		</select>
	</form>
{/snippet}

<p class="mb-6 text-zinc-400">
	Cómo se ve la imagen de los juegos, para toda la casa: como en una tele de tubo, suavizada o con
	sus píxeles tal cual. Manda el del juego, si tiene; si no, el de su consola, y si no, el de todos.
	Se aplica al empezar cada juego.
</p>

{#if form?.message}
	<p class="mb-4 text-sm text-red-400">{form.message}</p>
{/if}

<section class="mb-8">
	<h2 class="mb-2 text-lg font-semibold">Todos los juegos</h2>
	{@render choose({}, all, null)}
</section>

<section class="mb-8">
	<h2 class="mb-2 text-lg font-semibold">Por consola</h2>
	<ul class="divide-y divide-white/10 rounded-xl border border-white/10 bg-zinc-900">
		{#each data.systems as s (s.id)}
			<li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<span>{s.name}</span>
				{@render choose({ system: s.id }, s.shader, `Como todos (${shaderName(all)})`)}
			</li>
		{/each}
	</ul>
</section>

<section>
	<h2 class="mb-2 text-lg font-semibold">Por juego</h2>
	<input
		type="search"
		bind:value={search}
		placeholder="Buscar un juego"
		aria-label="Buscar un juego para darle su shader"
		class="mb-3 w-full rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm sm:w-72"
	/>
	{#if games.length}
		<ul class="divide-y divide-white/10 rounded-xl border border-white/10 bg-zinc-900">
			{#each games as g (`${g.system}/${g.file}`)}
				<li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
					<span>{g.title} <span class="text-sm text-zinc-500">· {g.systemName}</span></span>
					{@render choose(
						{ system: g.system, file: g.file },
						g.shader,
						`Como su consola (${shaderName(systemShader(g.system))})`
					)}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-zinc-500">
			{search.trim() ? 'Ningún juego con ese nombre.' : 'Ningún juego tiene uno propio.'}
		</p>
	{/if}
</section>
