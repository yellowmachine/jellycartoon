<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * «Botón de llamar siempre a mano» (#330): theirs in «Para mí», or another's from Personas (an
	 * adult sets it for a grandparent who never opens Ajustes). Its favorites, up to three: one alone
	 * is called with a tap. Each change saves at once.
	 */
	let {
		data,
		tab,
		userId,
		name = null
	}: {
		data: PageData;
		tab: string;
		/** Whose: theirs, or someone else's in the family. */
		userId: string;
		/** Someone else's: their name, and it goes inside their row of Personas. */
		name?: string | null;
	} = $props();

	const MAX = 3;
	const saved = $derived(data.callButtons?.find((b) => b.userId === userId));
	/**
	 * Who may be a favorite: the family's accounts, but them; for an adult, also the adults of the
	 * linked families (#464), with their family's name.
	 */
	const others = $derived([
		...data.people
			.filter((p) => p.userId && p.userId !== userId)
			.map((p) => ({ userId: p.userId!, name: p.name })),
		...(saved?.kid
			? []
			: (data.familyLinks?.linked ?? []).flatMap((f) =>
					f.people.map((p) => ({ userId: p.userId, name: `${p.name} (${f.familyName})` }))
				))
	]);
	let on = $derived(saved?.on ?? false);
	let favorites = $derived(saved?.favorites ?? []);

	let form = $state<HTMLFormElement>();
	/** After the page shows the change: the hidden favorites go in the order they were ticked. */
	const save = () => tick().then(() => form?.requestSubmit());
</script>

{#snippet body()}
	<form
		bind:this={form}
		method="post"
		action="?seccion={tab}&/callButton"
		class="flex flex-col gap-3 text-sm"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<input type="hidden" name="userId" value={userId} />
		{#each favorites as f (f)}
			<input type="hidden" name="favorite" value={f} />
		{/each}
		<label class="flex items-start gap-2">
			<input
				type="checkbox"
				name="on"
				bind:checked={on}
				onchange={save}
				class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
			/>
			<span>
				Botón de llamar siempre a mano
				<span class="block text-xs text-zinc-500"
					>Un botón verde grande abajo a la derecha, en todas las páginas{name
						? ` de ${name}`
						: ''}. Abre Llamadas; con un solo favorito, le llama con un toque. Pensado para quien no
					quiere buscar en el menú. No sale en el modo carretera, que tiene el suyo.</span
				>
			</span>
		</label>
		{#if on}
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-zinc-400">
					Favoritos, hasta {MAX}: salen primero y en grande en Llamadas
				</legend>
				{#each others as p (p.userId)}
					{@const chosen = favorites.includes(p.userId)}
					<label
						class={['flex items-center gap-2', !chosen && favorites.length >= MAX && 'opacity-50']}
					>
						<input
							type="checkbox"
							checked={chosen}
							disabled={!chosen && favorites.length >= MAX}
							onchange={(e) => {
								favorites = e.currentTarget.checked
									? [...favorites, p.userId]
									: favorites.filter((f) => f !== p.userId);
								save();
							}}
							class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
						/>
						{p.name}
					</label>
				{:else}
					<p class="text-zinc-500">Aún no hay nadie más en la familia con cuenta.</p>
				{/each}
			</fieldset>
		{/if}
	</form>
{/snippet}

{#if name}
	<details class="mt-2 text-sm">
		<summary class="cursor-pointer text-zinc-400">
			Botón de llamar{on ? ' · encendido' : ''}
		</summary>
		<div class="mt-2">{@render body()}</div>
	</details>
{:else}
	<section class={section} id="boton-llamar">
		<h2 class="mb-3 font-semibold">Llamar</h2>
		{@render body()}
	</section>
{/if}
