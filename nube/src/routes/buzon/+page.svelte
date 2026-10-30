<script lang="ts">
	import { enhance } from '$app/forms';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * Tu Buzón (#331): lo que te ha avisado la app (la Agenda, las alarmas, la medicación, los
	 * deberes, la voz) y los recados que te dejan, lo último arriba; y para dejar uno a alguien de la
	 * familia. Solo lo ves tú.
	 */
	let { data, form }: PageProps = $props();

	const unread = $derived(data.items.filter((n) => !n.readAt).length);
	const when = (d: Date) => {
		const day = d.toDateString() === new Date().toDateString();
		return d.toLocaleString('es-ES', {
			...(day ? {} : { weekday: 'short', day: 'numeric', month: 'short' }),
			hour: '2-digit',
			minute: '2-digit'
		});
	};
	const KIND: Record<string, string> = {
		agenda: 'Agenda',
		alarma: 'Alarma',
		medicacion: 'Medicación',
		deberes: 'Deberes',
		voz: 'La voz',
		recado: 'Recado'
	};
</script>

<svelte:head>
	<title>Buzón · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
		<h1 class="text-2xl font-bold">Buzón</h1>
		{#if unread}
			<form method="post" action="?/readAll" use:enhance>
				<button class="text-sm text-amber-400 hover:underline">Marcar todo como leído</button>
			</form>
		{/if}
	</div>

	<section class={section}>
		{#if data.items.length}
			<ul class="flex flex-col divide-y divide-zinc-800">
				{#each data.items as n (n.id)}
					<li class="flex items-start gap-3 py-2">
						<div class="min-w-0 flex-1">
							<a
								href={n.url}
								class={['block hover:underline', n.readAt ? 'text-zinc-400' : 'font-semibold']}
							>
								{#if n.level === 'urgente'}<span class="text-red-400">¡Urgente! </span>{/if}
								{n.title}
							</a>
							<p class={['text-sm', n.readAt ? 'text-zinc-500' : 'text-zinc-300']}>{n.body}</p>
							<p class="text-xs text-zinc-500">{KIND[n.kind] ?? n.kind} · {when(n.createdAt)}</p>
						</div>
						{#if !n.readAt}
							<form method="post" action="?/read" use:enhance>
								<input type="hidden" name="id" value={n.id} />
								<button class={secondary}>Vale</button>
							</form>
						{/if}
						<form method="post" action="?/remove" use:enhance>
							<input type="hidden" name="id" value={n.id} />
							<button
								class="rounded px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
								aria-label="Borrar «{n.title}»">×</button
							>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-zinc-400">
				Nada todavía. Aquí quedan los avisos de la app y los recados que te dejen.
			</p>
		{/if}
	</section>

	{#if data.people.length}
		<section class={section}>
			<h2 class="mb-1 font-semibold">Dejar un recado</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Le llega a su Buzón y a su móvil. También por voz: «Alexa, déjale un recado a…».
			</p>
			<form
				method="post"
				action="?/leave"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: true })}
				class="flex flex-col gap-3 text-sm"
			>
				<div class="flex flex-wrap gap-3">
					{#each data.people as p (p.id)}
						<label class="flex items-center gap-1">
							<input
								type="checkbox"
								name="to"
								value={p.id}
								class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
							/>
							{p.name}
						</label>
					{/each}
				</div>
				<textarea
					name="text"
					required
					rows="2"
					maxlength={data.maxMessage}
					placeholder="Que compres pan al volver"
					class={field}></textarea>
				<div class="flex items-center gap-3">
					<button class={primary}>Dejar el recado</button>
					{#if form && 'left' in form}
						<span class="text-amber-400">✓ Dejado a {form.left}</span>
					{:else if form && 'problem' in form}
						<span class="text-red-400">{form.problem}</span>
					{/if}
				</div>
			</form>
		</section>
	{/if}
</div>
