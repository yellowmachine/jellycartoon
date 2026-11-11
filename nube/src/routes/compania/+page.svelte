<script lang="ts">
	import { enhance } from '$app/forms';
	import CompanionChecks from '#lib/components/CompanionChecks.svelte';
	import { primary, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/** «Compañía» (#469), as a linked family sees it. */
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Compañía · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-2 text-2xl font-bold">Compañía</h1>
	<p class="mb-6 text-sm text-zinc-400">
		Quien vive solo en una familia vinculada con la tuya: su satélite le pregunta cada rato cómo
		está. Aquí ves si contestó (✓) o no (✗), nunca lo que dijo.
	</p>

	{#if form && 'problem' in form}
		<p class="mb-4 text-sm text-red-400">{form.problem}</p>
	{/if}

	{#each data.companions as c (c.familyId)}
		<section class={section}>
			<h2 class="mb-2 text-lg font-semibold">
				{c.name}
				{#if c.name !== c.familyName}<span class="text-sm font-normal text-zinc-500">
						· {c.familyName}</span
					>{/if}
			</h2>
			<CompanionChecks view={c} />
			<div class="mt-4 flex flex-wrap gap-2">
				{#if c.alert}
					<form method="post" action="?/seen" use:enhance>
						<input type="hidden" name="familia" value={c.familyId} />
						<button class={primary}>Ya lo he mirado</button>
					</form>
				{/if}
				<a href="/llamadas" class={secondary}>Llamar</a>
				{#if c.paused}
					<form method="post" action="?/resume" use:enhance>
						<input type="hidden" name="familia" value={c.familyId} />
						<button class={secondary}>Reanudar</button>
					</form>
				{:else}
					<form
						method="post"
						action="?/pause"
						use:enhance
						class="flex flex-wrap items-center gap-2"
					>
						<input type="hidden" name="familia" value={c.familyId} />
						<span class="text-sm text-zinc-400">Pausar:</span>
						<button name="length" value="1h" class={secondary}>1 h</button>
						<button name="length" value="3h" class={secondary}>3 h</button>
						<button name="length" value="manana" class={secondary}>hasta mañana</button>
					</form>
				{/if}
			</div>
		</section>
	{:else}
		<p class="text-sm text-zinc-400">
			Ninguna familia vinculada con la tuya tiene Compañía puesta. Se pone en Ajustes → Familia de
			la familia de quien vive solo.
		</p>
	{/each}
</div>
