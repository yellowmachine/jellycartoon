<script lang="ts">
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import { enhance } from '$app/forms';
	import { section, select, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Verificación en dos pasos. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.twoFactor}
	{@const tf = data.twoFactor}
	<section class={section} id="dos-pasos">
		<h2 class="mb-1 font-semibold">Verificación en dos pasos</h2>
		{#if !tf.enabled}
			<p class="mb-3 text-sm text-zinc-400">
				Tras la contraseña, un código de una app en tu móvil (Proton Pass, Google Authenticator…):
				aunque alguien sepa tu contraseña, sin el móvil no entra.
			</p>
			<a href="/verificacion" class={primary}>Activar</a>
		{:else}
			<p class="mb-3 text-sm text-zinc-400">
				Activada{tf.required ? ': el administrador siempre la lleva' : ''}. Quedan
				{tf.codesLeft === 1 ? '1 código' : `${tf.codesLeft} códigos`} de recuperación.
			</p>
			{#if form && 'backupCodes' in form && form.backupCodes}
				<div class="mb-3 rounded-md border border-amber-500/40 p-3 text-sm">
					<p class="mb-2">
						Tus nuevos códigos de recuperación; los de antes ya no valen. Guárdalos fuera del móvil:
						no se vuelven a mostrar.
					</p>
					<ul class="grid grid-cols-2 gap-1 rounded bg-zinc-900 p-2 font-mono">
						{#each form.backupCodes as code (code)}
							<li>{code}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<form method="post" action="?seccion={tab}&/newBackupCodes" use:enhance class="space-y-2">
				<label class="block text-sm">
					Tu contraseña, para cambiar algo de esto
					<PasswordInput
						name="password"
						required
						autocomplete="current-password"
						box="mt-1"
						class="{select} w-full"
					/>
				</label>
				<div class="flex flex-wrap gap-2">
					<button class={secondary}>Nuevos códigos de recuperación</button>
					{#if !tf.required}
						<button class={secondary} formaction="?seccion={tab}&/disableTwoFactor"
							>Desactivar</button
						>
					{/if}
				</div>
			</form>
		{/if}
		{#if form && 'twoFactorProblem' in form}
			<p class="mt-2 text-sm text-red-400">{form.twoFactorProblem}</p>
		{/if}
	</section>
{/if}
