<script lang="ts">
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import PlayModes from 'comun/components/PlayModes.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { coverUrl, masterSpeakers, masterVolume, stopTime } from 'comun/music.ts';
	import { musicTarget, watchSnapcast } from 'comun/music-target.svelte.ts';
	import { COUNTRIES } from 'comun/radio.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';

	const snapcast = watchSnapcast();
	const snap = $derived(snapcast.state);
	const track = $derived(snap?.track);
	/** A station is live: no position, no previous or next. */
	const radio = $derived(snap?.radio);
	/** An episode only heard (#223). */
	const episode = $derived(snap?.episode);

	// Rectangular with rounded corners, all the size of «play», like the app's other buttons.
	const base =
		'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40';
	const control = `${base} bg-zinc-800 text-zinc-200 hover:bg-zinc-700`;
	const primary = `${base} bg-amber-500 text-zinc-950 hover:bg-amber-400`;
	const ghost = `${base} text-zinc-400 hover:bg-zinc-800 hover:text-white`;

	let showSpeakers = $state(false);
	/** The speaker whose name is being edited. */
	let renaming = $state<string | null>(null);
	/** While a volume is being dragged it shows the finger, not snapserver. */
	let dragging = $state<{ id: string; value: number } | null>(null);
	let draggingMaster = $state<number | null>(null);

	const on = $derived(masterSpeakers(snap?.speakers ?? []));
	/** Their groups muted, as Snapweb's group mute. */
	const allMuted = $derived(on.length > 0 && on.every((s) => s.groupMuted));
</script>

<!-- Only while something plays on Snapcast, whoever sent it. -->
{#if snap?.active}
	{#snippet modes()}
		<PlayModes
			shuffle={snap.shuffle}
			repeat={snap.repeat}
			single={snap.single}
			onchange={(action, value) => musicTarget.send({ action, value })}
		/>
	{/snippet}
	<div class="rounded-md border border-zinc-700 bg-zinc-900/80 p-2 backdrop-blur">
		{#if showSpeakers}
			<div class="mb-2 border-b border-zinc-800 pb-2">
				{#if !snap.speakers}
					<p class="text-sm text-zinc-400">
						No se puede conectar con el control de snapserver (SNAPSERVER_CONTROL).
					</p>
				{:else if !snap.speakers.length}
					<p class="text-sm text-zinc-400">
						No hay altavoces. Arranca snapclient en alguno, apuntando a este equipo.
					</p>
				{:else}
					<!-- As Snapweb, only with more than one; or to unmute what was muted from here. -->
					{#if on.length > 1 || on.some((s) => s.groupMuted)}
						<div class="mb-1 flex items-center gap-3 border-b border-zinc-800 pb-1">
							<span class="min-w-0 flex-1 truncate pl-5 text-sm font-medium">Todos</span>
							<button
								class="w-6 shrink-0 text-sm"
								aria-label={allMuted ? 'Quitar silencio a todos' : 'Silenciar todos'}
								title={allMuted ? 'Quitar silencio a todos' : 'Silenciar todos'}
								onclick={() => musicTarget.send({ action: 'masterMute', value: !allMuted })}
								>{allMuted ? '🔇' : '🔊'}</button
							>
							<input
								type="range"
								min="0"
								max="100"
								step="1"
								value={draggingMaster ?? masterVolume(on)}
								aria-label="Volumen de todos"
								class="w-28 shrink-0 accent-amber-500 sm:w-40"
								oninput={(e) => (draggingMaster = Number(e.currentTarget.value))}
								onchange={(e) => {
									void musicTarget.send({
										action: 'masterVolume',
										value: Number(e.currentTarget.value)
									});
									draggingMaster = null;
								}}
							/>
							<span class="w-8 shrink-0 text-right font-mono text-xs text-zinc-400 tabular-nums"
								>{draggingMaster ?? masterVolume(on)}</span
							>
						</div>
					{/if}
					<ul class="space-y-1">
						{#each snap.speakers as speaker (speaker.id)}
							<li class={['flex items-center gap-3', !speaker.connected && 'opacity-50']}>
								<span
									class={[
										'h-2 w-2 shrink-0 rounded-full',
										speaker.connected ? 'bg-green-500' : 'bg-zinc-600'
									]}
									title={speaker.connected ? 'Conectado' : 'Desconectado'}
								></span>
								{#if renaming === speaker.id}
									<form
										class="min-w-0 flex-1"
										onsubmit={(e) => {
											e.preventDefault();
											const name = new FormData(e.currentTarget).get('name');
											void musicTarget.send({
												action: 'rename',
												speakerId: speaker.id,
												name: String(name ?? '')
											});
											renaming = null;
										}}
									>
										<!-- svelte-ignore a11y_autofocus -->
										<input
											name="name"
											value={speaker.name === speaker.hostName ? '' : speaker.name}
											placeholder={speaker.hostName}
											aria-label="Nombre del altavoz"
											autofocus
											onkeydown={(e) => e.key === 'Escape' && (renaming = null)}
											onblur={(e) => e.currentTarget.form?.requestSubmit()}
											class="w-full rounded border-zinc-700 bg-zinc-900 py-0.5 text-sm"
										/>
									</form>
								{:else}
									<button
										class="min-w-0 flex-1 truncate text-left text-sm hover:text-amber-400"
										title="Cambiar nombre ({speaker.hostName})"
										onclick={() => (renaming = speaker.id)}
										>{speaker.name}{#if !speaker.connected}
											<span class="text-xs text-zinc-500"> · desconectado</span>{/if}</button
									>
								{/if}
								<button
									class="w-6 shrink-0 text-sm disabled:opacity-50"
									disabled={speaker.groupMuted}
									aria-label={speaker.muted ? 'Quitar silencio' : 'Silenciar'}
									title={speaker.groupMuted
										? 'Silenciados todos'
										: speaker.muted
											? 'Quitar silencio'
											: 'Silenciar'}
									onclick={() =>
										musicTarget.send({
											action: 'mute',
											speakerId: speaker.id,
											value: !speaker.muted
										})}>{speaker.muted || speaker.groupMuted ? '🔇' : '🔊'}</button
								>
								<input
									type="range"
									min="0"
									max="100"
									step="1"
									value={dragging?.id === speaker.id ? dragging.value : speaker.volume}
									aria-label="Volumen de {speaker.name}"
									class="w-28 shrink-0 accent-amber-500 sm:w-40"
									oninput={(e) =>
										(dragging = { id: speaker.id, value: Number(e.currentTarget.value) })}
									onchange={(e) => {
										void musicTarget.send({
											action: 'volume',
											speakerId: speaker.id,
											value: Number(e.currentTarget.value)
										});
										dragging = null;
									}}
								/>
								<span class="w-8 shrink-0 text-right font-mono text-xs text-zinc-400 tabular-nums"
									>{dragging?.id === speaker.id ? dragging.value : speaker.volume}</span
								>
							</li>
						{/each}
					</ul>
				{/if}
				{#if musicTarget.error}
					<p class="mt-2 text-sm text-red-400">{musicTarget.error}</p>
				{/if}
			</div>
		{/if}
		{#if !radio}
			<input
				type="range"
				min="0"
				max={snap.durationSec ?? track?.durationSec ?? episode?.durationSec ?? 0}
				step="1"
				value={snap.positionSec ?? 0}
				aria-label="Posición"
				class="mb-1 block h-1 w-full accent-amber-500"
				onchange={(e) =>
					musicTarget.send({ action: 'seekTo', value: Number(e.currentTarget.value) })}
			/>
		{/if}
		<div class="flex items-center gap-3">
			<a
				href={radio
					? '/radio'
					: episode
						? `/series/${episode.seriesId}`
						: track && !track.clip && !track.src
							? `/musica/${track.albumId}`
							: '/musica'}
				class="flex min-w-0 flex-1 items-center gap-3"
			>
				{#if radio?.favicon}
					<img
						src={radio.favicon}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-white object-contain p-0.5"
						onerror={(e) => e.currentTarget.classList.add('invisible')}
					/>
				{:else if episode}
					<img
						src={thumbUrl(episode.id)}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else if track?.hasCover}
					<img
						src={coverUrl(track.albumId)}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>{track?.clip ? '🎙' : '♪'}</span
					>
				{/if}
				<span class="min-w-0">
					<span class="block truncate text-sm">
						<span class="text-amber-400">Snapcast:</span>
						{radio?.name ?? episode?.title ?? track?.title ?? '…'}
					</span>
					{#if radio}
						<!-- What the station says is on, when it says it (not all do). -->
						<span class="block truncate text-xs text-zinc-400" title={snap.nowPlaying}>
							<span class="text-red-400">●</span>
							{snap.nowPlaying ?? `En directo · ${COUNTRIES[radio.country] ?? radio.country}`}
						</span>
					{:else if episode}
						<span class="block truncate text-xs text-zinc-400">{episode.subtitle} · solo audio</span
						>
					{:else if track}
						<span class="block truncate text-xs text-zinc-400">{track.artist} · {track.album}</span>
					{/if}
				</span>
			</a>
			{#if snap.dj}
				<!-- Modo DJ: what is queued goes on without the DJ when it is left. -->
				<button
					class="shrink-0 rounded-full border border-amber-500/60 px-2 py-0.5 text-xs text-amber-400 hover:bg-zinc-800"
					title="Salir del modo DJ: sigue lo que hay en la cola, sin locutor"
					onclick={() => fetch('/api/music/dj/snapcast', { method: 'DELETE' })}>DJ ✕</button
				>
			{/if}
			{#if snap.stopAfterTrack || snap.stopAt}
				<!-- Asked by voice: «para cuando acabe esta», «apágala en media hora». -->
				<button
					class="shrink-0 rounded-full border border-sky-500/60 px-2 py-0.5 text-xs text-sky-300 hover:bg-zinc-800"
					title="Se parará sola. Tócalo para que no"
					onclick={() => {
						void musicTarget.send({ action: 'stopAfterTrack', value: false });
						void musicTarget.send({ action: 'stopIn', minutes: 0 });
					}}>⏹ {snap.stopAfterTrack ? 'al acabar esta' : stopTime(snap.stopAt!)} ✕</button
				>
			{/if}
			{#if !radio}
				<span class="hidden font-mono text-xs text-zinc-400 tabular-nums sm:inline">
					{formatDuration(snap.positionSec) || '0:00'} / {formatDuration(
						snap.durationSec ?? track?.durationSec
					)}
				</span>
				<span class="hidden gap-1 sm:flex">{@render modes()}</span>
				<button
					class={control}
					aria-label="Anterior"
					onclick={() => musicTarget.send({ action: 'previous' })}
					><MediaIcon name="previous" /></button
				>
			{/if}
			<button
				class={primary}
				aria-label={snap.paused ? 'Seguir' : 'Pausa'}
				onclick={() => musicTarget.send({ action: 'pause', value: !snap.paused })}
				><MediaIcon name={snap.paused ? 'play' : 'pause'} /></button
			>
			{#if !radio}
				<button
					class={control}
					aria-label="Siguiente"
					disabled={snap.playlistPos !== null &&
						snap.playlistPos >= (snap.playlistCount ?? 0) &&
						!snap.repeat}
					onclick={() => musicTarget.send({ action: 'next' })}><MediaIcon name="next" /></button
				>
			{/if}
			<button
				class={[
					base,
					showSpeakers
						? 'bg-zinc-800 text-amber-400'
						: 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
				]}
				aria-label="Altavoces"
				aria-expanded={showSpeakers}
				title="Altavoces"
				onclick={() => (showSpeakers = !showSpeakers)}>🔈</button
			>
			<button
				class={ghost}
				aria-label="Parar"
				title="Parar Snapcast"
				onclick={() => musicTarget.send({ action: 'stop' })}><MediaIcon name="stop" /></button
			>
		</div>
		{#if !radio}
			<!-- On the phone there is no room for them in the row above. -->
			<div class="mt-1 flex items-center justify-between sm:hidden">
				<span class="font-mono text-xs text-zinc-400 tabular-nums">
					{formatDuration(snap.positionSec) || '0:00'} / {formatDuration(
						snap.durationSec ?? track?.durationSec
					)}
				</span>
				<span class="flex gap-1">{@render modes()}</span>
			</div>
		{/if}
	</div>
{/if}
