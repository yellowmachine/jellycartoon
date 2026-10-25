<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import GamepadDrawing from '#lib/components/GamepadDrawing.svelte';
	import { assign, PAD_BUTTONS, type PadButton } from '#lib/game-controls.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** As shown: changed here at once, and saved right after. */
	let controls = $derived(data.controls ?? {});
	/** The gamepad's button being given another of the console's. */
	let selected = $state<PadButton | null>(null);
	let saveForm = $state<HTMLFormElement>();

	const padLabel = (name: PadButton) => PAD_BUTTONS.find((b) => b.name === name)!.label;

	async function choose(id: number) {
		if (!selected) return;
		controls = assign(controls, selected, id);
		selected = null;
		await tick();
		saveForm?.requestSubmit();
	}
</script>

<svelte:head>
	<title>Botones del mando · Juegos · JellyCartoon</title>
</svelte:head>

{#if !data.system}
	<p class="text-zinc-400">No hay juegos todavía.</p>
{:else}
	<nav class="mb-6 flex flex-wrap gap-2" aria-label="Consola">
		{#each data.systems as s (s.id)}
			<a
				href="?consola={s.id}"
				class={[
					'rounded-full border px-3 py-1 text-sm',
					s.id === data.system
						? 'border-lime-300 bg-lime-300 font-medium text-zinc-950'
						: 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
				]}
				aria-current={s.id === data.system ? 'page' : undefined}>{s.name}</a
			>
		{/each}
	</nav>

	<p class="mb-4 text-zinc-400">
		Toca un botón del mando y elige qué hace en los juegos de {data.name}. Si eso ya lo hacía otro
		botón, se intercambian. Son tus botones: cada persona tiene los suyos. La cruceta, los sticks y
		Select + Start para el menú no cambian.
	</p>

	<GamepadDrawing
		{controls}
		buttons={data.buttons ?? []}
		{selected}
		onchoose={(pad) => (selected = selected === pad ? null : pad)}
	/>

	<div class="mt-6 min-h-24 rounded-xl border border-white/10 bg-zinc-900 p-4">
		{#if selected}
			<p class="mb-3">El <strong>{padLabel(selected)}</strong> del mando hace…</p>
			<div class="flex flex-wrap gap-2">
				{#each data.buttons ?? [] as b (b.id)}
					<button
						type="button"
						class={[
							'rounded-lg border px-4 py-2 font-semibold',
							controls[b.id] === selected
								? 'border-lime-300 bg-lime-300 text-zinc-950'
								: 'border-zinc-700 bg-zinc-800 hover:border-lime-300'
						]}
						onclick={() => choose(b.id)}>{b.label}</button
					>
				{/each}
			</div>
		{:else}
			<p class="mb-2 text-sm text-zinc-500">Botón de la consola · botón del mando</p>
			<ul class="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
				{#each data.buttons ?? [] as b (b.id)}
					<li>
						<span class="font-semibold">{b.label}</span>
						<span class="text-zinc-500">·</span>
						<span class="text-zinc-300">{padLabel(controls[b.id])}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if form?.message}
		<p class="mt-3 text-sm text-red-400">{form.message}</p>
	{/if}

	<form
		method="post"
		action="?consola={data.system}&/save"
		use:enhance
		bind:this={saveForm}
		class="hidden"
	>
		<input type="hidden" name="system" value={data.system} />
		<input type="hidden" name="controls" value={JSON.stringify(controls)} />
	</form>
	<form method="post" action="?consola={data.system}&/reset" use:enhance class="mt-4">
		<input type="hidden" name="system" value={data.system} />
		<button class="text-sm text-zinc-400 underline hover:text-white"
			>Volver a los botones de siempre</button
		>
	</form>
{/if}
