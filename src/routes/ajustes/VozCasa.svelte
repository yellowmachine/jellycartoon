<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, primary, secondary, select } from './styles.ts';
	import { MAX_FILLER_CHARS, MAX_FILLERS } from '#lib/voice-fillers.ts';
	import type { PageData, ActionData } from './$types';

	/** La voz de la casa (#223): con la que contestan los satélites, entre las de Piper instaladas. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const SAMPLE = 'Hola, soy la voz de la casa. Mañana hará sol y unos veinte grados.';
	const key = (v: { voice: string; speaker: string | null }) => `${v.voice}|${v.speaker ?? ''}`;

	/** The one being heard, and a problem playing it. */
	let playing = $state<string | null>(null);
	let problem = $state<string | null>(null);

	async function listen(v: { voice: string; speaker: string | null }) {
		playing = key(v);
		problem = null;
		try {
			const res = await fetch('/api/voice/speak', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: SAMPLE, voice: v.voice, speaker: v.speaker })
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
			Con la que contestan los satélites de voz. Son las voces de Piper instaladas en el ordenador
			de la casa; escúchalas antes de elegir.
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
							<button type="button" class={secondary} onclick={() => listen(v)}>
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

		<h3 class="mt-6 mb-1 font-semibold" id="frases-espera">Frases de espera</h3>
		<p class="mb-2 text-sm text-zinc-400">
			Si la IA tarda en contestar, el satélite dice una de estas mientras, una distinta cada vez.
			Una por línea; cortas, que solo llenan la espera.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveFillers"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<textarea
				name="fillers"
				rows={Math.min(8, hv.fillers.split('\n').length + 1)}
				maxlength={MAX_FILLERS * (MAX_FILLER_CHARS + 1)}
				value={hv.fillers}
				aria-label="Frases de espera, una por línea"
				class="{select} mb-2 w-full"></textarea>
			<div class="flex flex-wrap items-center gap-2">
				<button class={primary}>Guardar</button>
				<button class={secondary} name="reset" value="1">Volver a las de siempre</button>
				{#if form && 'saved' in form && form.saved === 'fillers'}
					<span class="text-sm text-green-400">Guardadas</span>
				{/if}
			</div>
		</form>
	</section>
{/if}
