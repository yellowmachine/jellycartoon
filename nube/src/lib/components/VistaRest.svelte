<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { dayName, localDay, localTime } from 'comun/agenda.ts';
	import { formatLeft } from 'comun/timer-names.ts';
	import { skyIcon, type WeatherGlance } from 'comun/weather.ts';
	import type { Alarm } from 'comun/alarms.ts';
	import type { Dose } from 'comun/medication.ts';
	import type { FridgeState } from 'comun/fridge.ts';
	import { coverUrl } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import type { QuietHours } from '#lib/quiet-hours.ts';
	import { upFirst } from '#lib/planned-trips.ts';
	import { timers } from '#lib/timers.svelte.ts';
	import { todayLines } from '#lib/today-lines.ts';
	import { videoPlaying, vista } from '#lib/vista.svelte.ts';
	import { isNight, shouldRest } from '#lib/vista-idle.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { WAKE_WORDS } from 'comun/wake-words.ts';

	/**
	 * The Vista resting (#525): left untouched a while, the whole screen goes dark with only what is
	 * read from across the room: the clock, the weather, what is left of today, the timers, the doses
	 * still to take and who does not answer in «Compañía». Not while a video plays, the voice works
	 * or something rings. A touch, or the voice, wakes it, where it was.
	 *
	 * By day, if this device chose it, its walks' photos behind, one after another. At night (the
	 * family's «Horas de silencio», or 23:00–07:00) it rests sooner, without photos and dim: a web
	 * page cannot lower the screen's light, so what it shows is darker (with the tablet's own
	 * automatic brightness, the rest). While a song or an episode plays, its cover and title instead
	 * of the photos (dimmed with the rest at night). Waiting for the wake word, a small dot in a
	 * corner that breathes as the microphone's halo (MicButton): it is still listening.
	 */

	type Cards = {
		fridge: FridgeState;
		alarms: Alarm[];
		doses: Dose[];
		alerts: { familyId: string; name: string }[];
		weather: (WeatherGlance & { place: string }) | null;
		night: QuietHours | null;
		photos: number[];
	};

	let resting = $state(false);
	let cards = $state<Cards | null>(null);
	let now = $state(new Date());
	let fetchedAt = 0;
	/** Asked again this often while it rests: today moves on, others write post-its. */
	const REFRESH_MS = 5 * 60_000;
	/** Each photo, this long on the screen. */
	const PHOTO_MS = 60_000;
	let photo = $state(0);

	const night = $derived(isNight(cards?.night ?? null, now));
	/** What sounds here, not the radio (no cover): a song or an episode, playing. */
	const sounding = $derived.by(() => {
		if (!music.playing || music.radio) return null;
		const p = music.podcast;
		if (p) return { cover: p.imageUrl ?? null, title: p.title, by: p.podcastTitle };
		const t = music.current;
		if (t) return { cover: t.hasCover ? coverUrl(t.albumId) : null, title: t.title, by: t.artist };
		return null;
	});
	const photos = $derived(vista.photos && !night && !sounding ? (cards?.photos ?? []) : []);

	async function refresh() {
		fetchedAt = Date.now();
		const res = await fetch(vista.photos ? '/api/vista?fotos' : '/api/vista').catch(() => null);
		if (res?.ok) cards = await res.json();
	}

	onMount(() => {
		// Ready before it first rests, so it does not show up empty; and its night hours.
		void refresh();
		const check = setInterval(() => {
			now = new Date();
			const voiceBusy = voice.phase !== 'idle' || voice.speaking;
			// The voice wakes it, and counts as a touch: not resting again right after the answer.
			if (voiceBusy || timers.ringing.length) vista.touchedAt = Date.now();
			resting = shouldRest(
				{
					idleMs: Date.now() - vista.touchedAt,
					videoPlaying: videoPlaying(),
					voiceBusy,
					ringing: timers.ringing.length > 0
				},
				night
			);
			if (resting && Date.now() - fetchedAt > REFRESH_MS) void refresh();
		}, 1000);
		const next = setInterval(() => {
			if (resting && photos.length) photo = (photo + 1) % photos.length;
		}, PHOTO_MS);
		return () => {
			clearInterval(check);
			clearInterval(next);
		};
	});

	function wake() {
		vista.touchedAt = Date.now();
		resting = false;
	}

	const left = $derived(
		cards
			? todayLines(cards.fridge.today, cards.alarms, now)
					.filter((l) => !l.over)
					.slice(0, night ? 2 : 4)
			: []
	);
	const dueDoses = $derived(cards?.doses.filter((d) => d.time <= localTime(now)).length ?? 0);
	const shown = $derived(photos.length ? photos[photo % photos.length] : null);
</script>

{#if resting}
	<button
		class="tema-oscuro fixed inset-0 z-50 cursor-default overflow-hidden bg-black text-left text-zinc-300"
		aria-label="Despertar la Vista"
		onclick={wake}
	>
		{#if shown !== null}
			{#key shown}
				<img
					src="/paseos/fotos/{shown}"
					alt=""
					class="absolute inset-0 h-full w-full object-cover"
					transition:fade={{ duration: 2000 }}
				/>
			{/key}
			<!-- Dark at the top and the bottom, where the words are; the photo in between. -->
			<div
				class="absolute inset-0 bg-gradient-to-b from-black/75 via-black/10 to-black/80"
				aria-hidden="true"
			></div>
		{/if}

		<div
			class={[
				'relative flex h-full flex-col justify-between p-10',
				night && 'opacity-40',
				shown !== null && 'drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]'
			]}
		>
			<div class="flex flex-wrap items-start justify-between gap-6">
				<div>
					<p
						class={['text-9xl font-light tabular-nums', night ? 'text-zinc-400' : 'text-zinc-100']}
					>
						{localTime(now)}
					</p>
					<p class="mt-2 text-3xl text-zinc-400">{upFirst(dayName(localDay(now), true))}</p>
				</div>
				{#if cards?.weather}
					<div class="text-right">
						<p class={['text-6xl', night ? 'text-zinc-400' : 'text-zinc-100']}>
							<span aria-hidden="true">{skyIcon(cards.weather.code)}</span>
							{cards.weather.temperature} °C
						</p>
						<p class="mt-2 text-2xl text-zinc-400">
							{cards.weather.min}–{cards.weather.max} °C{cards.weather.rain >= 30
								? ` · lluvia ${cards.weather.rain} %`
								: ''}
						</p>
					</div>
				{/if}
			</div>

			<div class="flex flex-col gap-4 text-3xl">
				{#if sounding}
					<div class="mb-4 flex items-center gap-6">
						{#if sounding.cover}
							<img
								src={sounding.cover}
								alt=""
								class="h-40 w-40 shrink-0 rounded-xl bg-zinc-800 object-cover shadow-2xl"
							/>
						{/if}
						<div class="min-w-0">
							<p class="truncate text-4xl font-semibold text-zinc-100">🎵 {sounding.title}</p>
							<p class="mt-1 truncate text-2xl text-zinc-400">{sounding.by}</p>
						</div>
					</div>
				{/if}
				{#each timers.list.toSorted((a, b) => a.endsAt - b.endsAt) as t (t.id)}
					<p>
						⏱ {t.label}
						<span class="font-mono text-amber-400 tabular-nums"
							>{formatLeft((t.endsAt - timers.now) / 1000)}</span
						>
					</p>
				{/each}
				{#if dueDoses}
					<p class="text-amber-400">
						💊 {dueDoses === 1 ? 'Una toma' : `${dueDoses} tomas`} sin marcar
					</p>
				{/if}
				{#each left as l (l.key)}
					<p class={l.ringing ? 'text-amber-400' : ''}>
						<span class="inline-block w-44 text-zinc-400 tabular-nums">{l.time}</span>{l.title}
					</p>
				{/each}
			</div>

			{#if wakeWord.status === 'on'}
				<span
					class="breathing absolute bottom-4 left-4 h-3 w-3 rounded-full bg-amber-400"
					role="img"
					aria-label="Esperando «{WAKE_WORDS[wakeWord.word]}»"
				></span>
			{/if}
		</div>

		<!-- Who does not answer: never dimmed, also at night. -->
		{#if cards?.alerts.length}
			<div class="absolute right-10 bottom-10 flex flex-col items-end gap-3 text-3xl">
				{#each cards.alerts as a (a.familyId)}
					<p class="font-semibold text-red-400">⚠️ {a.name}: mira Compañía</p>
				{/each}
			</div>
		{/if}
	</button>
{/if}

<style>
	/* As MicButton's halo: slow, only its opacity. */
	.breathing {
		animation: breathe 4s ease-in-out infinite;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 0.9;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.breathing {
			animation: none;
			opacity: 0.6;
		}
	}
</style>
