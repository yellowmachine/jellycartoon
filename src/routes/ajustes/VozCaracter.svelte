<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, select, primary } from './styles.ts';
	import { MAX_VOICE_STYLE } from '#lib/voice.ts';
	import type { PageData, ActionData } from './$types';

	/**
	 * Cómo es la voz (la IA que contesta), en texto libre: el de la casa (para todos, también los
	 * satélites) o el de cada uno (cuando sabe que eres tú). Cambia el tono, no lo que hace.
	 */
	let {
		data,
		form,
		tab,
		which
	}: { data: PageData; form: ActionData; tab: string; which: 'casa' | 'mio' } = $props();

	const style = $derived(which === 'casa' ? data.houseStyle : data.myStyle);
	const action = $derived(which === 'casa' ? 'saveHouseStyle' : 'saveMyStyle');
	const savedKey = $derived(which === 'casa' ? 'houseStyle' : 'myStyle');
</script>

{#snippet content()}
	<h2 class="mb-1 font-semibold">
		{which === 'casa' ? 'Cómo es la voz de la casa' : 'Cómo quieres que te hable la voz'}
	</h2>
	<p class="mb-3 text-sm text-zinc-400">
		{#if which === 'casa'}
			Su carácter, para todos y también en los satélites: «con tendencia a tomarnos el pelo»,
			«cariñosa y con algún chiste». Cambia el tono, no lo que hace: sigue contestando corto y
			preguntando antes de mandar un mensaje.
		{:else}
			Solo contigo, cuando sabe que eres tú (el móvil, la tablet, el modo carretera), además del
			carácter de la casa: «llámame jefe y tómame el pelo con lo del Atleti».
		{/if}
	</p>
	<form
		method="post"
		action="?seccion={tab}&/{action}"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<textarea
			name="style"
			rows="3"
			maxlength={MAX_VOICE_STYLE}
			value={style?.text ?? ''}
			placeholder={which === 'casa' ? 'Con tendencia a tomarnos el pelo…' : 'Llámame jefe…'}
			class="{select} mb-2 w-full"></textarea>
		<div class="flex items-center gap-3">
			<button class={primary}>Guardar</button>
			{#if form && 'saved' in form && form.saved === savedKey}
				<span class="text-sm text-amber-400">✓ Guardado</span>
			{/if}
		</div>
	</form>
{/snippet}

{#if style && which === 'casa'}
	<section class={section} id="caracter-casa">{@render content()}</section>
{:else if style}
	<section class={section} id="caracter-mio">{@render content()}</section>
{/if}
