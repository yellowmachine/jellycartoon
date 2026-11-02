<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary } from './styles.ts';
	import { EXPRESSIVENESS, MUSIC_DUCK, SPEED, VOICE_GAIN } from '#lib/voice-levels.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * La voz de la casa (#241): con la que dice sus avisos por Snapcast, entre las de Piper
	 * instaladas. Los satélites son de Seilide, con su voz (#329).
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const SAMPLE = 'Hola, soy la voz de la casa. Mañana hará sol y unos veinte grados.';
	const key = (v: { voice: string; speaker: string | null }) => `${v.voice}|${v.speaker ?? ''}`;

	/** As saved, moved before saving; as saved again when the page's data changes. */
	let gainDb = $state(VOICE_GAIN.default);
	let duckDb = $state(MUSIC_DUCK.default);
	let expressiveness = $state(EXPRESSIVENESS.default);
	let speed = $state(SPEED.default);
	/** `on`, the answers in the AI voice; empty, Piper. */
	let aiAnswers = $state('');
	$effect.pre(() => {
		if (!data.houseVoice) return;
		gainDb = data.houseVoice.levels.gainDb;
		duckDb = data.houseVoice.levels.duckDb;
		expressiveness = data.houseVoice.levels.expressiveness;
		speed = data.houseVoice.levels.speed;
		aiAnswers = data.houseVoice.levels.aiAnswers ? 'on' : '';
	});

	/** The one being heard, and a problem playing it. */
	let playing = $state<string | null>(null);
	let problem = $state<string | null>(null);

	/** Played here as the house says it: the sample in a voice. `id`, what shows it is playing. */
	async function listen(
		id: string,
		body: { text: string; voice?: string; speaker?: string | null }
	) {
		playing = id;
		problem = null;
		try {
			const res = await fetch('/api/voice/speak', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error((await res.text()).slice(0, 200));
			const url = URL.createObjectURL(await res.blob());
			const audio = new Audio(url);
			audio.onended = audio.onerror = () => {
				URL.revokeObjectURL(url);
				playing = null;
			};
			await audio.play();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
			playing = null;
		}
	}
</script>

{#if data.houseVoice}
	{@const hv = data.houseVoice}
	<section class={section} id="voz-casa">
		<h2 class="mb-1 font-semibold">Voz de la casa</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Con la que la casa dice sus avisos por los altavoces (los temporizadores y las alarmas que
			suenan en toda la casa). Son las voces de Piper instaladas en el ordenador de la casa;
			escúchalas antes de elegir.
		</p>
		{#if hv.problem}
			<p class="text-sm text-red-400">No se pudo preguntar a Piper: {hv.problem}</p>
		{:else}
			<ul class="mb-2 divide-y divide-zinc-800 text-sm">
				{#each hv.options as v (key(v))}
					{@const chosen = key(v) === key(hv.chosen)}
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{v.label}
							<span class="text-zinc-500">· {v.country}</span>
							{#if chosen}<span class="ml-1 text-amber-400">· la de la casa</span>{/if}
						</span>
						<span class="flex shrink-0 gap-2">
							<button
								type="button"
								class={secondary}
								onclick={() => listen(key(v), { text: SAMPLE, voice: v.voice, speaker: v.speaker })}
							>
								{playing === key(v) ? 'Sonando…' : 'Escuchar'}
							</button>
							{#if !chosen}
								<form method="post" action="?seccion={tab}&/saveHouseVoice" use:enhance>
									<input type="hidden" name="voice" value={v.voice} />
									<input type="hidden" name="speaker" value={v.speaker ?? ''} />
									<button class={primary}>Elegir</button>
								</form>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if problem}<p class="text-sm text-red-400">{problem}</p>{/if}
		{#if form && 'voiceProblem' in form}<p class="text-sm text-red-400">{form.voiceProblem}</p>{/if}
		<p class="text-xs text-zinc-500">
			Para tener más, se instalan en ese ordenador con Piper (<code
				>python -m piper.download_voices</code
			>).
		</p>

		<h3 class="mt-6 mb-1 font-semibold" id="volumen-voz">Cómo suena</h3>
		<p class="mb-2 text-sm text-zinc-400">
			Cómo lee Piper los avisos (100 %, a su manera; con mucha expresividad puede sonar rara), su
			volumen, y cuánto baja la música mientras habla. Guardado, «Escuchar» ya suena así.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveVoiceLevels"
			class="mb-2 flex flex-col gap-3 text-sm"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<fieldset class="flex flex-wrap items-center gap-3">
				<legend class="float-left w-44">Dicho con</legend>
				<label class="flex items-center gap-1.5">
					<input type="radio" name="aiAnswers" value="" bind:group={aiAnswers} />
					Piper
				</label>
				<label class="flex items-center gap-1.5">
					<input type="radio" name="aiAnswers" value="on" bind:group={aiAnswers} />
					Voz IA (Kore)
				</label>
				{#if aiAnswers}
					<span class="basis-full text-xs text-zinc-500">
						Más viva que Piper, pero cada aviso tarda unos 2–3 s más y cuesta algo; si falla, lo
						dice Piper. Expresividad y velocidad son solo de Piper.
					</span>
				{/if}
			</fieldset>
			<label class="flex flex-wrap items-center gap-3">
				<span class="w-44">Expresividad</span>
				<input
					type="range"
					name="expressiveness"
					min={EXPRESSIVENESS.min}
					max={EXPRESSIVENESS.max}
					step="5"
					bind:value={expressiveness}
					class="flex-1"
				/>
				<span class="w-16 text-right tabular-nums">{expressiveness} %</span>
			</label>
			<label class="flex flex-wrap items-center gap-3">
				<span class="w-44">Velocidad</span>
				<input
					type="range"
					name="speed"
					min={SPEED.min}
					max={SPEED.max}
					step="5"
					bind:value={speed}
					class="flex-1"
				/>
				<span class="w-16 text-right tabular-nums">{speed} %</span>
			</label>
			<label class="flex flex-wrap items-center gap-3">
				<span class="w-44">Volumen de la voz</span>
				<input
					type="range"
					name="gainDb"
					min={VOICE_GAIN.min}
					max={VOICE_GAIN.max}
					step="1"
					bind:value={gainDb}
					class="flex-1"
				/>
				<span class="w-16 text-right tabular-nums">+{gainDb} dB</span>
			</label>
			{#if hv.snapcast}
				<label class="flex flex-wrap items-center gap-3">
					<span class="w-44">Música mientras habla</span>
					<input
						type="range"
						name="duckDb"
						min={MUSIC_DUCK.min}
						max={MUSIC_DUCK.max}
						step="1"
						bind:value={duckDb}
						class="flex-1"
					/>
					<span class="w-16 text-right tabular-nums">{duckDb} dB</span>
				</label>
			{:else}
				<input type="hidden" name="duckDb" value={duckDb} />
			{/if}
			<div class="flex items-center gap-2">
				<button class={primary}>Guardar</button>
				{#if form && 'saved' in form && form.saved === 'voiceLevels'}
					<span class="text-green-400">Guardado</span>
				{/if}
			</div>
		</form>
	</section>
{/if}
