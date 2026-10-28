<script lang="ts">
	import { enhance } from '$app/forms';
	import KidQuestions from '#lib/components/KidQuestions.svelte';
	import KidsNow from '#lib/components/KidsNow.svelte';
	import KidRulesForm from '#lib/components/KidRulesForm.svelte';
	import { formatRemaining } from 'comun/format.ts';
	import { clock, closedText, type VideoAccess } from '#lib/kid-time.ts';
	import { ANSWER_SECONDS, ASK_EVERY_OPTIONS } from '#lib/still-there.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const ASK: { value: number | null; label: string }[] = [
		{ value: null, label: 'Nunca' },
		...ASK_EVERY_OPTIONS.map((n) => ({ value: n, label: `Cada ${n} capítulos` }))
	];

	const ACCESS: { value: VideoAccess; label: string }[] = [
		{ value: 'yes', label: 'Sí' },
		{ value: 'no', label: 'No' },
		{ value: 'until-tomorrow', label: 'No, hasta mañana' }
	];

	const weekday = new Intl.DateTimeFormat('es', { weekday: 'short', timeZone: 'UTC' });
	const dayMonth = new Intl.DateTimeFormat('es', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	});
	const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
	const date = (day: string) => new Date(`${day}T00:00:00Z`);

	/** «Hoy», «Ayer» or the date. */
	function dayLabel(day: string) {
		if (day === data.today) return 'Hoy';
		if (day === data.days.at(-2)) return 'Ayer';
		return dayMonth.format(date(day));
	}
</script>

<svelte:head>
	<title>Infantil · JellyCartoon</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Infantil</h1>
<p class="mb-6 text-zinc-400">
	Lo que ven las cuentas infantiles. El tiempo es el que de verdad ha avanzado el vídeo, en el
	navegador o en el salón: las pausas y los saltos no cuentan.
</p>

{#if !data.kids.length}
	<p class="text-sm text-zinc-500">
		No hay cuentas infantiles. Las crea quien creó la primera cuenta, desde
		<a href="/ajustes" class="text-amber-400 hover:underline">Ajustes</a>.
	</p>
{/if}

{#if data.kids.length && data.ai}
	<a
		href="/infantil/deberes"
		class="mb-6 flex items-center gap-3 rounded-md border border-zinc-800 p-3 hover:border-sky-500/60 hover:bg-zinc-900"
	>
		<span class="text-2xl" aria-hidden="true">📚</span>
		<span>
			<span class="block font-semibold">Deberes</span>
			<span class="text-sm text-zinc-400"
				>Ejercicios sobre lo que han visto, preparados con la IA y revisados por ti.</span
			>
		</span>
	</a>
{/if}

{#if data.kids.length}
	<KidsNow
		kids={data.kids}
		initial={data.watchingNow}
		initialStopped={data.stoppedLately}
		initialTogether={data.together}
	/>
{/if}

{#if data.kids.length && data.ai}
	<KidQuestions voice={data.voice} />
{/if}

{#each data.kids as kid (kid.id)}
	{@const week = data.days.reduce((sum, day) => sum + (kid.perDay[day] ?? 0), 0)}
	{@const top = Math.max(...data.days.map((day) => kid.perDay[day] ?? 0), 1)}
	<section class="mb-10 rounded-md border border-zinc-800 p-4">
		<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-xl font-semibold">{kid.name}</h2>
			<p class="text-sm text-zinc-400">
				{kid.lastActivity
					? `Última actividad: ${dateTime.format(kid.lastActivity)}`
					: 'Todavía no ha visto nada'}
			</p>
		</div>

		<!-- Over the schedule: off is no video at all, and the schedule stays as it is. -->
		<form
			method="post"
			action="?/access"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mb-6 flex flex-wrap items-center gap-2 text-sm"
		>
			<input type="hidden" name="userId" value={kid.id} />
			<span class="mr-1 text-zinc-300">Puede ver vídeos</span>
			{#each ACCESS as option (option.value)}
				<button
					name="access"
					value={option.value}
					aria-pressed={kid.rules.access === option.value}
					class={[
						'rounded-full border px-3 py-1',
						kid.rules.access === option.value
							? option.value === 'yes'
								? 'border-amber-500 text-amber-400'
								: 'border-red-500 text-red-400'
							: 'border-zinc-700 hover:bg-zinc-900'
					]}>{option.label}</button
				>
			{/each}
		</form>

		<!-- #77: with «siguiente automático», whether anyone is still there. -->
		<form
			method="post"
			action="?/askEvery"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="mb-6 text-sm"
		>
			<input type="hidden" name="userId" value={kid.id} />
			<div class="flex flex-wrap items-center gap-2">
				<span class="mr-1 text-zinc-300">Preguntar «¿Sigues ahí?»</span>
				{#each ASK as option (option.value)}
					<button
						name="askEvery"
						value={option.value ?? ''}
						aria-pressed={kid.askEvery === option.value}
						class={[
							'rounded-full border px-3 py-1',
							kid.askEvery === option.value
								? 'border-amber-500 text-amber-400'
								: 'border-zinc-700 hover:bg-zinc-900'
						]}>{option.label}</button
					>
				{/each}
			</div>
			<p class="mt-1 text-zinc-500">
				Tras esos capítulos seguidos sin tocar nada, el siguiente espera a que conteste; si en
				{ANSWER_SECONDS / 60} minutos nadie lo hace, se para.
			</p>
		</form>

		<div class="mb-6 flex flex-wrap gap-8">
			<p>
				<span class="block text-3xl font-semibold text-amber-400">
					{formatRemaining(kid.perDay[data.today] ?? 0)}
				</span>
				<span class="text-sm text-zinc-400">hoy</span>
			</p>
			<p>
				<span class="block text-3xl font-semibold">{formatRemaining(week)}</span>
				<span class="text-sm text-zinc-400">en {data.days.length} días</span>
			</p>
			<p class="self-center text-sm">
				{#if !kid.video.allowed}
					<span class="text-red-400">{closedText(kid.video, data.weekday)}</span>
				{:else if kid.video.until !== null}
					Ahora puede ver vídeos hasta las {clock(kid.video.until)}.
				{:else if kid.rules.dailyMinutes !== null}
					Ahora puede ver vídeos.
				{:else}
					<span class="text-zinc-400">Sin horario ni límite.</span>
				{/if}
				{#if kid.video.allowed && kid.rules.dailyMinutes !== null}
					Le quedan {formatRemaining(
						Math.max(0, kid.rules.dailyMinutes * 60 - (kid.perDay[data.today] ?? 0))
					)} hoy.
				{/if}
			</p>
		</div>

		<!-- One bar per day, the tallest the day with most. -->
		<ol class="mb-8 grid h-40 max-w-xl grid-cols-7 items-end gap-2" aria-label="Minutos por día">
			{#each data.days as day (day)}
				{@const seconds = kid.perDay[day] ?? 0}
				<li class="flex h-full flex-col items-center justify-end gap-1 text-xs">
					<span class="text-zinc-400">{seconds ? Math.ceil(seconds / 60) : ''}</span>
					<span
						class={['w-full rounded-t', day === data.today ? 'bg-amber-500' : 'bg-zinc-600']}
						style:height="{(seconds / top) * 100}%"
						title="{dayLabel(day)}: {formatRemaining(seconds)}"
					></span>
					<span class="text-zinc-400 capitalize">{weekday.format(date(day))}</span>
				</li>
			{/each}
		</ol>

		<div class="grid gap-8 md:grid-cols-3">
			<div>
				<h3 class="mb-2 font-semibold">Estos días</h3>
				{#if kid.watched.length}
					<ul class="space-y-2 text-sm">
						{#each kid.watched as item (`${item.episodeId}:${item.movieId}:${item.channelId}`)}
							<li>
								<a
									href={item.channelId
										? '/canales'
										: item.movieId
											? `/cine/${item.movieId}`
											: `/series/${item.seriesId}`}
									class="block hover:text-amber-400"
								>
									<span class="block truncate">{item.title}</span>
									<span class="block truncate text-xs text-zinc-400">
										{item.channelId
											? 'Canal, en directo'
											: item.movieId
												? 'Película'
												: `${item.seriesTitle} · T${item.season} E${item.number}`}
										· {formatRemaining(item.seconds)} · {dayLabel(item.lastDay!)}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-zinc-500">Nada en estos {data.days.length} días.</p>
				{/if}
			</div>

			<div>
				<h3 class="mb-2 font-semibold">A medias</h3>
				{#if kid.halfway.length}
					<ul class="space-y-2 text-sm">
						{#each kid.halfway as item (item.href + item.title)}
							<li>
								<a href={item.href} class="block hover:text-amber-400">
									<span class="block truncate">{item.title}</span>
									<span class="block truncate text-xs text-zinc-400">{item.detail}</span>
									{#if item.durationSec}
										<span class="mt-1 block h-1 overflow-hidden rounded bg-zinc-800">
											<span
												class="block h-full bg-amber-400"
												style:width="{(item.positionSec / item.durationSec) * 100}%"
											></span>
										</span>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-zinc-500">Nada a medias.</p>
				{/if}
			</div>

			<div>
				<h3 class="mb-2 font-semibold">Terminado</h3>
				{#if kid.finished.length}
					<ul class="space-y-2 text-sm">
						{#each kid.finished as item (item.href + item.title + item.at.getTime())}
							<li>
								<a href={item.href} class="block hover:text-amber-400">
									<span class="block truncate">{item.title}</span>
									<span class="block truncate text-xs text-zinc-400">
										{item.detail} · {dateTime.format(item.at)}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-zinc-500">Nada terminado todavía.</p>
				{/if}
			</div>
		</div>

		<details class="mt-8 border-t border-zinc-800 pt-4" open={form?.userId === kid.id}>
			<summary class="cursor-pointer font-semibold">Horario</summary>
			<div class="mt-4">
				<KidRulesForm
					userId={kid.id}
					rules={kid.rules}
					message={form?.userId === kid.id && 'message' in form ? form.message : undefined}
					saved={form?.userId === kid.id && 'saved' in form}
				/>
			</div>
		</details>
	</section>
{/each}
