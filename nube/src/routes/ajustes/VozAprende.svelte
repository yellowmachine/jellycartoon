<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Aprender de lo que se habla (#331): después de cada orden, la IA mira si se ha contado algo que
	 * merezca recordarse, sin «recuerda». Apagado por defecto: va a la vez que la voz de la respuesta,
	 * y con poco saldo OpenRouter puede rechazar la voz.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.voiceLearn !== null}
	<section class={section} id="voz-aprende">
		<h2 class="mb-1 font-semibold">Aprender de lo que se habla</h2>
		<form
			method="post"
			action="?seccion={tab}&/saveVoiceLearn"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<label class="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					name="on"
					checked={data.voiceLearn}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					Aprender de lo que se le dice a la voz
					<span class="block text-xs text-zinc-500"
						>Después de cada orden, la IA mira si de paso se ha contado algo que merezca recordarse
						(«mañana no hay cole, es fiesta») y lo guarda; cada noche, «Hoy he aprendido» en el
						Buzón. Es una llamada más a OpenRouter por orden, a la vez que la voz de la respuesta:
						con poco saldo, OpenRouter puede rechazar esa voz.</span
					>
				</span>
			</label>
		</form>
	</section>
{/if}
