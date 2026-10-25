<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { TRIES_OPTIONS } from '#lib/homework.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The AI takes a while: half a minute, a minute. */
	let preparing = $state(false);
	let picked = $state<number[]>([]);
	let band = $state('primaria-2');
	const questions = $derived(data.bands.find((b) => b.id === band)?.questions ?? 8);

	const STATUS = { draft: 'Por revisar', assigned: 'Dados', done: 'Hechos' } as const;
	const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

	const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
	const primary =
		'rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';
</script>

<svelte:head>
	<title>Deberes · JellyCartoon</title>
</svelte:head>

<p class="mb-2 text-sm"><a href="/infantil" class="text-zinc-400 hover:underline">← Infantil</a></p>
<h1 class="mb-1 text-2xl font-bold">Deberes</h1>
<p class="mb-6 text-zinc-400">
	Ejercicios sobre los dibujos que han visto, preparados por la IA solo con lo que se dice en los
	capítulos. Los revisas tú antes de dárselos; los hacen en la tablet o el ordenador, con su cuenta.
</p>

{#if !data.kids.length}
	<p class="text-sm text-zinc-500">No hay cuentas infantiles.</p>
{:else}
	{#if data.homework.length}
		<section class="mb-10">
			<h2 class="mb-3 text-lg font-semibold">Sus deberes</h2>
			<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each data.homework as h (h.id)}
					<li>
						<a
							href="/infantil/deberes/{h.id}"
							class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-zinc-900"
						>
							<span class="font-medium">{h.kid}</span>
							<span class="min-w-0 flex-1 truncate text-zinc-300">{h.title}</span>
							<span
								class={[
									'rounded-full px-2 py-0.5 text-xs',
									h.status === 'draft' && 'bg-zinc-800 text-zinc-300',
									h.status === 'assigned' && 'bg-sky-900 text-sky-200',
									h.status === 'done' && 'bg-emerald-900 text-emerald-200'
								]}>{STATUS[h.status]}</span
							>
							<span class="text-sm text-zinc-400">
								{#if h.status === 'done'}
									{h.marks.right} de {h.marks.closed} bien{h.marks.toRead
										? ` · ${h.marks.toRead} para leer`
										: ''} · {day.format(h.doneAt!)}
								{:else}
									{h.count} ejercicios · {day.format(h.createdAt)}
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="rounded-md border border-zinc-800 p-4">
		<h2 class="mb-3 text-lg font-semibold">Nuevos deberes</h2>
		{#if !data.ai}
			<p class="text-sm text-zinc-400">
				Hace falta la IA: pon la clave de OpenRouter en
				<a href="/ajustes?seccion=casa#ia" class="text-amber-400 hover:underline">Ajustes</a>.
			</p>
		{:else}
			<form
				method="post"
				action="?/propose"
				use:enhance={() => {
					preparing = true;
					return async ({ update }) => {
						await update({ reset: false });
						preparing = false;
					};
				}}
				class="flex flex-col gap-5"
			>
				<label class="flex flex-wrap items-center gap-2 text-sm">
					<span class="text-zinc-300">Para</span>
					<select
						name="kidId"
						class={select}
						value={data.chosen}
						onchange={(e) => {
							picked = [];
							void goto(`?nino=${e.currentTarget.value}`, { reset: false, replace: true });
						}}
					>
						{#each data.kids as kid (kid.id)}
							<option value={kid.id}>{kid.name}</option>
						{/each}
					</select>
					<span class="ml-3 text-zinc-300">Edad</span>
					<select name="band" class={select} bind:value={band}>
						{#each data.bands as b (b.id)}
							<option value={b.id}>{b.label}</option>
						{/each}
					</select>
				</label>

				<fieldset>
					<legend class="mb-2 text-sm text-zinc-300">
						Sobre qué capítulos (lo último que ha visto; hasta tres)
					</legend>
					{#if !data.watched.length}
						<p class="text-sm text-zinc-500">Todavía no ha visto nada.</p>
					{:else}
						<ul class="max-h-80 overflow-y-auto rounded-md border border-zinc-800">
							{#each data.watched as ep (ep.id)}
								<li>
									<label
										class={[
											'flex items-center gap-3 px-3 py-2 text-sm',
											ep.hasDialogue ? 'cursor-pointer hover:bg-zinc-900' : 'opacity-50'
										]}
									>
										<input
											type="checkbox"
											name="episode"
											value={ep.id}
											disabled={!ep.hasDialogue || (picked.length >= 3 && !picked.includes(ep.id))}
											checked={picked.includes(ep.id)}
											onchange={(e) =>
												(picked = e.currentTarget.checked
													? [...picked, ep.id]
													: picked.filter((id) => id !== ep.id))}
											class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
										/>
										<span class="min-w-0 flex-1 truncate">
											{ep.series} · T{ep.season} E{ep.number}
											<span class="text-zinc-400">{ep.title}</span>
										</span>
										<span class="shrink-0 text-xs text-zinc-500">
											{ep.hasDialogue
												? `${ep.completed ? 'visto' : 'empezado'} el ${day.format(ep.watchedAt)}`
												: 'sin subtítulos'}
										</span>
									</label>
								</li>
							{/each}
						</ul>
					{/if}
				</fieldset>

				<div class="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
					<label class="flex items-center gap-2">
						<span class="text-zinc-300">Idioma</span>
						<select name="language" class={select}>
							<option value="es">Español</option>
							<option value="en">Inglés, para practicarlo</option>
						</select>
					</label>
					<label class="flex items-center gap-2">
						<span class="text-zinc-300">Ejercicios</span>
						<input
							type="number"
							name="count"
							min="1"
							max="15"
							value={questions}
							class="{select} w-20"
						/>
					</label>
				</div>

				<label class="flex flex-col gap-1 text-sm">
					<span class="text-zinc-300">Algo en especial (opcional)</span>
					<input
						name="focus"
						maxlength="300"
						placeholder="Por ejemplo: la amistad, por qué se enfadan, vocabulario de animales…"
						class="{select} px-3"
					/>
				</label>

				<fieldset class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
					<legend class="mb-2 text-zinc-300">Al equivocarse</legend>
					<label class="flex items-center gap-2">
						Intentos
						<select name="tries" class={select} value="2">
							{#each TRIES_OPTIONS as t (t)}
								<option value={t ?? 'sin'}>{t ?? 'Sin límite'}</option>
							{/each}
						</select>
					</label>
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							name="hints"
							checked
							class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
						/>
						Darle una pista
					</label>
					<label class="flex items-center gap-2">
						<input
							type="checkbox"
							name="showAnswer"
							checked
							class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
						/>
						Enseñarle la buena al acabar los intentos
					</label>
				</fieldset>

				{#if form?.message}
					<p class="text-sm text-red-400" role="alert">{form.message}</p>
				{/if}
				<div class="flex items-center gap-3">
					<button class={primary} disabled={preparing || !picked.length}>
						{preparing ? 'Preparando…' : 'Preparar con la IA'}
					</button>
					{#if preparing}
						<span class="text-sm text-zinc-400">
							Lee los capítulos y propone los ejercicios: medio minuto o un minuto.
						</span>
					{/if}
				</div>
			</form>
		{/if}
	</section>
{/if}
