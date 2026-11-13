<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Quién oye lo que se dice: el Whisper de la casa (si no contesta, OpenRouter) u OpenRouter
	 * siempre, para probar la voz como la tiene una familia sin casa. Solo con casa, su administrador.
	 * Vale para los satélites, los móviles y las notas de voz.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.voiceHear}
	<section class={section} id="voz-oir">
		<h2 class="mb-1 font-semibold">Quién oye lo que se dice</h2>
		<form
			method="post"
			action="?seccion={tab}&/saveVoiceHear"
			class="flex flex-col gap-2 text-sm"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<label class="flex items-start gap-2">
				<input
					type="radio"
					name="hear"
					value="casa"
					checked={!data.voiceHear.cloud}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					El Whisper de casa
					<span class="block text-xs text-zinc-500"
						>Conoce los nombres de vuestra música y no gasta saldo. Si la casa no contesta,
						OpenRouter.</span
					>
				</span>
			</label>
			<label class="flex items-start gap-2">
				<input
					type="radio"
					name="hear"
					value="openrouter"
					checked={data.voiceHear.cloud}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					OpenRouter siempre
					<span class="block text-xs text-zinc-500"
						>Como en una familia sin ordenador en casa: sirve para probarlo. Gasta un poco de saldo
						por orden.</span
					>
				</span>
			</label>
			<p class="text-xs text-zinc-500">Vale para los satélites, los móviles y las notas de voz.</p>
		</form>
	</section>
{/if}
