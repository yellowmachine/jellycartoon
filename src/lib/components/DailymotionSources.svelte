<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * The Dailymotion accounts and playlists the children may watch (#66), chosen by the adults in
	 * Infantil: searched by name or pasted as a link. Only their videos are shown and played.
	 */
	interface Source {
		id: number;
		kind: 'user' | 'playlist';
		xid: string;
		name: string;
		image: string | null;
	}
	interface Candidate {
		kind: 'user' | 'playlist';
		xid: string;
		name: string;
		image: string | null;
		detail: string;
	}

	let {
		sources,
		candidates = null,
		message = null
	}: { sources: Source[]; candidates?: Candidate[] | null; message?: string | null } = $props();

	let searching = $state(false);
	const keep = () => {
		searching = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			searching = false;
			await update({ reset: false });
		};
	};
</script>

<section id="dailymotion" class="mb-10 rounded-md border border-zinc-800 p-4">
	<h2 class="mb-1 text-xl font-semibold">Dibujos de Dailymotion</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Las cuentas y listas de Dailymotion que pueden ver los peques, en la sección Dailymotion: solo
		sus vídeos, siempre con el filtro familiar y con el reproductor de Dailymotion (con su
		publicidad). Cuenta en su tiempo de pantalla, como las series.
	</p>

	{#if sources.length}
		<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
			{#each sources as s (s.id)}
				<li class="flex items-center gap-3 p-2">
					{#if s.image}
						<img
							src={s.image}
							alt=""
							referrerpolicy="no-referrer"
							class={[
								'h-8 w-8 bg-zinc-800 object-cover',
								s.kind === 'user' ? 'rounded-full' : 'rounded'
							]}
						/>
					{/if}
					<a href="/dailymotion/{s.id}" class="min-w-0 flex-1 truncate hover:text-amber-400"
						>{s.name}</a
					>
					<span class="shrink-0 text-xs text-zinc-500"
						>{s.kind === 'user' ? 'Cuenta' : 'Lista'}</span
					>
					<form method="post" action="?/dmRemove" use:enhance>
						<input type="hidden" name="id" value={s.id} />
						<button class="text-red-400 hover:underline">Quitar</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	<form method="post" action="?/dmSearch" use:enhance={keep} class="flex flex-wrap gap-2">
		<input
			name="q"
			required
			placeholder="Pocoyó, o el enlace de una cuenta o de una lista"
			aria-label="Buscar en Dailymotion"
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
		/>
		<button
			disabled={searching}
			class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900 disabled:opacity-50"
			>{searching ? 'Buscando…' : 'Buscar'}</button
		>
	</form>
	{#if message}
		<p class="mt-2 text-sm text-red-400">{message}</p>
	{/if}
	{#if candidates}
		{#if candidates.length}
			<ul class="mt-3 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
				{#each candidates as c (c.kind + c.xid)}
					<li class="flex items-center gap-3 p-2">
						{#if c.image}
							<img
								src={c.image}
								alt=""
								referrerpolicy="no-referrer"
								class={[
									'h-10 w-10 bg-zinc-800 object-cover',
									c.kind === 'user' ? 'rounded-full' : 'rounded'
								]}
							/>
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate">{c.name}</span>
							<span class="block truncate text-xs text-zinc-500">{c.detail}</span>
						</span>
						{#if sources.some((s) => s.kind === c.kind && s.xid === c.xid)}
							<span class="text-xs text-zinc-500">Ya está</span>
						{:else}
							<form method="post" action="?/dmAdd" use:enhance>
								<input type="hidden" name="kind" value={c.kind} />
								<input type="hidden" name="xid" value={c.xid} />
								<button
									class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950 hover:bg-amber-400"
									>Añadir</button
								>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-2 text-sm text-zinc-500">Dailymotion no encuentra nada con eso.</p>
		{/if}
	{/if}
</section>
