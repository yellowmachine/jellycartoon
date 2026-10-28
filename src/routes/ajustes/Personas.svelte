<script lang="ts">
	import Guardado from './Guardado.svelte';
	import { enhance } from '$app/forms';
	import { AVATARS, avatar } from '#lib/avatars.ts';
	import AvatarPicker from './AvatarPicker.svelte';
	import { section, select, primary, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Personas de la casa: adultos, peques y dispositivos. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	/** Until when an adult's link works (#157): «el lunes 26 a las 12:00». */
	const until = (date: Date) =>
		`el ${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' })} a las ${date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;

	const initialOf = (name: string) => [...name.trim()][0]?.toLocaleUpperCase('es') ?? '?';

	/** The link, to paste in WhatsApp. */
	let copied = $state(false);
	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Without the clipboard (http, an old browser): the field is selected on focus, to copy by hand.
		}
	}

	/** A new child enters with permission by default: no email nor password to make up. */
	let newKidByApproval = $state(true);
</script>

{#if data.kids && data.people}
	<section class={section} id="personas">
		<h2 class="mb-1 font-semibold">Personas de la casa</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Tú creas las cuentas de todos, adultos y peques. Solo tú ves esta sección.
		</p>

		{#snippet guardians(kidId: string | null, chosen: string[])}
			<fieldset class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
				<legend class="mb-1 text-zinc-400">Le dejan entrar (sus padres o tutores)</legend>
				{#each data.kids!.adults as adult (adult.id)}
					<label class="flex items-center gap-1.5">
						<input
							type="checkbox"
							name="guardian"
							value={adult.id}
							checked={chosen.includes(adult.id)}
							class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
						/>
						{adult.name}
					</label>
				{/each}
			</fieldset>
			{#if !chosen.length && kidId}
				<p class="text-xs text-zinc-500">Sin ninguno, te lo pide a ti.</p>
			{/if}
		{/snippet}

		{#if form && 'invited' in form && form.invited}
			{@const invited = form.invited}
			<!-- Shown once: the token is only in the link, the server keeps its hash. -->
			<div class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				<p class="mb-2 font-medium text-amber-300">El enlace de {invited.name}</p>
				<div class="flex flex-wrap items-start gap-4">
					<div class="w-44 shrink-0 rounded bg-white p-1" aria-label="Código QR del enlace">
						{@html invited.qr}
					</div>
					<div class="min-w-0 flex-1 space-y-2">
						<p>
							Que apunte la cámara de su móvil al código, o mándale el enlace por WhatsApp. Ahí
							elige su contraseña y entra.
						</p>
						<p class="text-zinc-400">
							Vale una vez, hasta {until(invited.until)}. Solo funciona en la wifi de casa o con
							WireGuard encendido.
						</p>
						<div class="flex flex-wrap gap-2">
							<input
								readonly
								value={invited.url}
								aria-label="Enlace"
								class="{select} min-w-0 flex-1 font-mono text-xs"
								onfocus={(e) => e.currentTarget.select()}
							/>
							<button type="button" class={secondary} onclick={() => copyLink(invited.url)}
								>{copied ? '✓ Copiado' : 'Copiar'}</button
							>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<h3 class="mb-2 text-sm text-zinc-300">Adultos</h3>
		<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
			{#each data.people.adults as adult (adult.id)}
				{@const a = adult.avatar ? avatar(adult.avatar) : null}
				<li>
					<details>
						<summary class="flex cursor-pointer items-center gap-3 p-2">
							<span
								class={[
									'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
									a ? `text-lg ${a.color}` : 'bg-amber-500 font-semibold text-zinc-950'
								]}>{a ? a.emoji : initialOf(adult.name)}</span
							>
							<span class="min-w-0 flex-1 truncate"
								>{adult.name} <span class="text-zinc-500">· {adult.email}</span></span
							>
							<span class="shrink-0 text-xs text-zinc-400"
								>{adult.admin
									? 'Administrador'
									: adult.hasPassword
										? ''
										: adult.linkUntil
											? `Sin entrar: su enlace vale hasta ${until(adult.linkUntil)}`
											: 'Sin entrar: su enlace caducó'}</span
							>
						</summary>
						<div class="flex flex-col gap-3 border-t border-zinc-800 p-3">
							<form
								method="post"
								action="?seccion={tab}&/saveAdult"
								use:enhance={() =>
									async ({ update }) =>
										update({ reset: false })}
								class="flex flex-col gap-3"
							>
								<input type="hidden" name="userId" value={adult.id} />
								<AvatarPicker chosen={adult.avatar} label={`Dibujo de ${adult.name}`} />
								<button class="{primary} self-start">Guardar</button>
							</form>
							{#if !adult.admin}
								<form
									method="post"
									action="?seccion={tab}&/newLink"
									use:enhance
									class="flex flex-wrap items-center gap-3"
								>
									<input type="hidden" name="userId" value={adult.id} />
									<button class={secondary}>Nuevo enlace para entrar</button>
									<span class="text-xs text-zinc-500"
										>{adult.hasPassword
											? 'Si ha olvidado su contraseña: con él elige otra.'
											: 'El anterior deja de valer.'}</span
									>
								</form>
							{/if}
						</div>
					</details>
				</li>
			{/each}
		</ul>

		<h3 class="mb-2 text-sm text-zinc-300">Nuevo adulto</h3>
		<form
			method="post"
			action="?seccion={tab}&/createAdult"
			use:enhance
			class="mb-6 flex flex-col gap-3"
		>
			<div class="grid gap-2 sm:grid-cols-2">
				<input
					name="name"
					required
					placeholder="Nombre"
					aria-label="Nombre"
					class="{select} min-w-0"
				/>
				<input
					name="email"
					type="email"
					required
					autocomplete="off"
					placeholder="ana@ejemplo.com"
					aria-label="Email"
					class="{select} min-w-0"
				/>
			</div>
			<AvatarPicker chosen={AVATARS[0].id} label="Dibujo del adulto nuevo" />
			<p class="text-xs text-zinc-500">
				Sin contraseña: la app te da un enlace y un QR para que la elija. El email es para entrar;
				no se le manda nada.
			</p>
			<button class="{primary} self-start">Añadir</button>
		</form>

		<h3 id="cuentas-infantiles" class="mb-1 text-sm text-zinc-300">Peques</h3>
		<p class="mb-3 text-xs text-zinc-500">
			Solo ven las series y películas con la etiqueta «infantil», y no pueden gestionar nada ni
			hablar con la IA. Los más pequeños entran sin contraseña: en un dispositivo de la casa eligen
			su dibujo, y uno de sus padres o tutores les deja entrar desde el móvil.
		</p>

		{#if data.kids.accounts.length}
			<ul class="mb-6 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
				{#each data.kids.accounts as kid (kid.id)}
					{@const a = avatar(kid.avatar)}
					<li>
						<details>
							<summary class="flex cursor-pointer items-center gap-3 p-2">
								<span
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg {a.color}"
									>{a.emoji}</span
								>
								<span class="min-w-0 flex-1 truncate">{kid.name}</span>
								<span class="shrink-0 text-xs text-zinc-400"
									>{kid.byApproval ? 'Entra con permiso' : 'Con contraseña'}</span
								>
							</summary>
							<form
								method="post"
								action="?seccion={tab}&/saveKid"
								use:enhance={() =>
									async ({ update }) =>
										update({ reset: false })}
								class="flex flex-col gap-3 border-t border-zinc-800 p-3"
							>
								<input type="hidden" name="kidId" value={kid.id} />
								<AvatarPicker chosen={kid.avatar} label={`Dibujo de ${kid.name}`} />
								<label class="flex items-center gap-2">
									<input
										type="checkbox"
										name="byApproval"
										checked={kid.byApproval}
										class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
									/>
									Entra con permiso, sin contraseña
								</label>
								{@render guardians(kid.id, kid.guardians)}
								<input
									name="password"
									type="password"
									minlength="8"
									autocomplete="new-password"
									placeholder={kid.byApproval
										? 'Contraseña, si deja de entrar con permiso'
										: 'Nueva contraseña (vacía, la de siempre)'}
									aria-label="Contraseña"
									class="{select} min-w-0"
								/>
								<button class="{primary} self-start">Guardar</button>
							</form>
						</details>
					</li>
				{/each}
			</ul>
		{/if}

		<h3 class="mb-2 text-sm text-zinc-300">Nuevo peque</h3>
		<form method="post" action="?seccion={tab}&/createKid" use:enhance class="flex flex-col gap-3">
			<input
				name="name"
				required
				placeholder="Nombre"
				aria-label="Nombre"
				class="{select} min-w-0"
			/>
			<AvatarPicker chosen={AVATARS[0].id} label="Dibujo del peque nuevo" />
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="byApproval"
					bind:checked={newKidByApproval}
					class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
				/>
				Entra con permiso, sin contraseña
			</label>
			{#if newKidByApproval}
				{@render guardians(null, [])}
			{:else}
				<div class="grid gap-2 sm:grid-cols-2">
					<input
						name="email"
						type="email"
						required
						autocomplete="off"
						placeholder="lucia@casa.local"
						aria-label="Email para entrar"
						class="{select} min-w-0"
					/>
					<input
						name="password"
						type="password"
						required
						minlength="8"
						autocomplete="new-password"
						placeholder="Contraseña"
						aria-label="Contraseña"
						class="{select} min-w-0"
					/>
				</div>
				<p class="text-xs text-zinc-500">
					El email solo sirve para entrar: no hace falta que exista.
				</p>
			{/if}
			<button class="{primary} self-start">Crear</button>
		</form>

		<h3 id="dispositivos-casa" class="mt-6 mb-1 text-sm text-zinc-300">Dispositivos de la casa</h3>
		<p class="mb-2 text-xs text-zinc-500">
			Solo en ellos, cuando nadie ha entrado, se ve «¿Quién eres?» con los dibujos de los peques y
			de los adultos: un adulto entra diciendo que sí desde su móvil.
		</p>
		{#if data.kids.devices.length}
			<ul class="mb-3 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
				{#each data.kids.devices as device (device.id)}
					<li class="flex items-center gap-3 p-2">
						<span class="min-w-0 flex-1 truncate"
							>{device.name}{#if device.id === data.kids.here}
								<span class="text-amber-400"> · este</span>{/if}</span
						>
						<form method="post" action="?seccion={tab}&/forgetDevice" use:enhance>
							<input type="hidden" name="id" value={device.id} />
							<button class="text-red-400 hover:underline">Quitar</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
		{#if !data.kids.here}
			<form
				method="post"
				action="?seccion={tab}&/trustDevice"
				use:enhance
				class="flex flex-wrap gap-2"
			>
				<input
					name="name"
					required
					maxlength="60"
					placeholder="la TV del salón"
					aria-label="Nombre de este dispositivo"
					class="{select} min-w-0 flex-1"
				/>
				<button class={secondary}>Este dispositivo es de la casa</button>
			</form>
		{/if}

		{#if form && 'section' in form && (form.section === 'kids' || form.section === 'people')}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{:else if form && 'saved' in form && form.saved === 'adult'}
			<Guardado class="mt-3 block text-sm text-amber-400">✓ Guardado</Guardado>
		{:else if form && 'saved' in form && form.saved === 'kids'}
			<Guardado class="mt-3 block text-sm text-amber-400">✓ Cuenta creada</Guardado>
		{:else if form && 'saved' in form && form.saved === 'kid'}
			<Guardado class="mt-3 block text-sm text-amber-400">✓ Guardado</Guardado>
		{/if}
	</section>
{/if}
