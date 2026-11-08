<script lang="ts">
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { walkDistanceText } from '#lib/walks.ts';
	import type { PageProps } from './$types';

	/** «Mis paseos compartidos» (#434): every link made, how often it was opened, «Retirar». */
	let { data }: PageProps = $props();

	const day = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short' });
	const when = new Intl.DateTimeFormat('es', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});
	const live = $derived(data.shares.filter((s) => !s.revokedAt));
	const gone = $derived(data.shares.filter((s) => s.revokedAt));
</script>

<svelte:head>
	<title>Paseos compartidos · Seilide</title>
</svelte:head>

<a href="/paseos" class="mb-2 inline-block text-sm text-zinc-400 hover:text-amber-300">← Paseos</a>
<h1 class="mb-1 text-2xl font-bold">Mis paseos compartidos</h1>
<p class="mb-6 text-sm text-zinc-400">
	Cada enlace vale hasta que lo retiras o borras el paseo. Se comparte desde la ficha de cada paseo.
</p>

{#snippet row(s: (typeof data.shares)[number])}
	<li class="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
		<div class="min-w-0 flex-1">
			<p class="font-medium">{s.label ?? 'Sin nombre'}</p>
			<p class="text-sm text-zinc-400">
				Paseo del {day.format(new Date(s.startedAt))} · {walkDistanceText(s.distance)} ·
				{s.photos.length === 1 ? '1 foto' : `${s.photos.length} fotos`}{s.trim
					? ''
					: ' · recorrido entero'}
			</p>
			<p class="text-sm text-zinc-400">
				Creado el {when.format(new Date(s.createdAt))} ·
				{s.opens === 1 ? 'abierto 1 vez' : `abierto ${s.opens} veces`}{s.lastOpenedAt
					? `, la última el ${when.format(new Date(s.lastOpenedAt))}`
					: ''}
			</p>
			{#if s.revokedAt}
				<p class="text-sm text-zinc-500">Retirado el {when.format(new Date(s.revokedAt))}</p>
			{/if}
		</div>
		{#if !s.revokedAt}
			<ConfirmForm
				action="?/revoke"
				fields={{ id: s.id }}
				label="Retirar"
				question="¿Retirar este enlace? Quien lo tenga ya no podrá ver el paseo."
				class="text-sm text-zinc-500 hover:text-red-400"
			/>
		{/if}
	</li>
{/snippet}

{#if live.length}
	<ul class="mb-8 divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each live as s (s.id)}{@render row(s)}{/each}
	</ul>
{:else}
	<p class="mb-8 text-zinc-400">No tienes ningún paseo compartido ahora.</p>
{/if}

{#if gone.length}
	<h2 class="mb-2 text-lg font-semibold text-zinc-300">Retirados</h2>
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800 opacity-70">
		{#each gone as s (s.id)}{@render row(s)}{/each}
	</ul>
{/if}
