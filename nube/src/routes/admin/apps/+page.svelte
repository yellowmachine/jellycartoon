<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * The apps that people enter with their cloud account (#284): Langua, Librarian… Each one a
	 * client of the cloud's OpenID provider, its id and secret going into the app's .env.
	 */
	let { data, form }: PageProps = $props();

	const made = $derived(form && 'made' in form ? form.made : null);
	const env = $derived(
		made
			? `SEILIDE_URL=${data.origin}\nSEILIDE_CLIENT_ID=${made.clientId}\nSEILIDE_CLIENT_SECRET=${made.clientSecret}`
			: ''
	);
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
</script>

<svelte:head>
	<title>Apps · Nube</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-1 text-2xl font-bold">Apps</h1>
	<p class="mb-6 text-sm text-zinc-400">
		Las apps en las que se entra con la cuenta de la nube, como Langua o Librarian. Entra cualquiera
		que tenga cuenta, sin pantalla de permiso. Las que son para familias reciben también la familia
		de quien entra; a las demás no se les da. La discovery está en
		<code class="break-all">{data.origin}/api/auth/.well-known/openid-configuration</code>.
	</p>

	{#if made}
		<div class="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			<p class="mb-1 text-zinc-300">El acceso de {made.name}, para su <code>.env</code>:</p>
			<pre
				class="font-mono text-xs break-all whitespace-pre-wrap text-amber-300 select-all">{env}</pre>
			<p class="mt-1 text-xs text-zinc-400">Cópialas ahora: el secreto no se vuelve a enseñar.</p>
		</div>
	{/if}

	{#if data.clients.length}
		<ul class="{section} divide-y divide-zinc-800 text-sm">
			{#each data.clients as c (c.clientId)}
				<li class="flex items-center justify-between gap-2 py-2">
					<span class="min-w-0">
						{c.name}
						{#if c.family}<span class="text-xs text-zinc-400">· para familias</span>{/if}
						<span class="block truncate text-xs text-zinc-500">
							<span class="font-mono">{c.clientId}</span>
							{#if c.createdAt}· creado el {day(c.createdAt)}{/if}
						</span>
						<span class="block truncate text-xs text-zinc-500">{c.redirect}</span>
					</span>
					<form method="post" action="?/remove" use:enhance>
						<input type="hidden" name="id" value={c.clientId} />
						<button class={secondary}>Quitar</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	<form method="post" action="?/create" use:enhance class="{section} space-y-3">
		<h2 class="font-semibold">Nueva app</h2>
		<input name="name" required placeholder="Nombre: Langua" class="{field} w-full" />
		<input
			name="redirect"
			type="url"
			required
			placeholder="https://langua.example.com/api/auth/callback/seilide"
			class="{field} w-full"
		/>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="family" />
			Es para familias: recibe la familia de quien entra (Langua sí, Librarian no)
		</label>
		<button class={primary}>Crear acceso</button>
		{#if form && 'problem' in form}<p class="text-sm text-red-400">{form.problem}</p>{/if}
	</form>
</div>
