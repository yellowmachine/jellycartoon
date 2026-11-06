<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let written = $state('');
	let busy = $state(false);
	const ready = $derived(written.trim().toUpperCase() === data.word);
	const blocked = $derived(data.state.kind === 'handOverFirst');
</script>

<svelte:head>
	<title>Eliminar mi cuenta · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-6">
	<h1 class="mb-4 text-2xl font-bold">Eliminar mi cuenta</h1>

	<section class={section}>
		{#if blocked}
			<p class="mb-3 text-sm text-amber-400">
				Eres quien administra la familia y hay más adultos. Antes tienes que pasar la administración
				a uno de ellos.
			</p>
			<a
				class="text-sm text-amber-500 hover:underline"
				href="/ajustes?seccion=familia#administracion">Ir a Administración</a
			>
		{:else}
			{#if data.state.kind === 'lastAdult'}
				<p class="mb-3 font-medium text-red-400">
					Eres el único adulto: se borra también toda la familia, con todo lo que hay en ella{data
						.state.kids.length
						? `, y las cuentas de ${data.state.kids.join(', ')}`
						: ''}.
				</p>
			{:else if data.state.kind === 'stays'}
				<ul class="mb-3 list-disc space-y-1 pl-5 text-sm text-zinc-300">
					<li>
						<strong>Se borra:</strong> tus viajes, paseos, notas, fotos, lo que recuerda la voz de ti,
						tu medicación, y las citas y los papeles que son solo tuyos.
					</li>
					<li>
						<strong>Se queda en la familia:</strong> los gastos, la nevera, las recetas y lo que compartes
						con otros, como una cita, donde sigue saliendo tu nombre.
					</li>
				</ul>
			{/if}
			<p class="mb-3 text-sm text-zinc-300">
				No se puede deshacer. Lo borrado sigue hasta 7 noches más en las copias de seguridad, y
				luego desaparece. Si quieres conservar algo,
				<a class="text-amber-500 hover:underline" href="/ajustes/mis-datos" download
					>descarga antes tus datos</a
				>.
			</p>

			<form
				method="post"
				class="flex flex-col gap-3"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await update();
						busy = false;
					};
				}}
			>
				<input type="hidden" name="token" value={data.token} />
				<label class="text-sm text-zinc-300">
					Escribe <strong>{data.word}</strong> para confirmarlo
					<input
						name="word"
						bind:value={written}
						autocomplete="off"
						autocapitalize="characters"
						spellcheck="false"
						class="{field} mt-1"
					/>
				</label>
				<button
					disabled={!ready || busy}
					class="self-start rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500 disabled:opacity-40"
				>
					{busy ? 'Eliminando…' : 'Eliminar mi cuenta para siempre'}
				</button>
			</form>
			{#if form?.problem}
				<p class="mt-3 text-sm text-red-400">{form.problem}</p>
			{/if}
		{/if}
		<a
			class="mt-4 inline-block text-sm text-zinc-400 hover:text-white"
			href="/ajustes?seccion=cuenta">No, volver</a
		>
	</section>
</div>
