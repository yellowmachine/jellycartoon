import type { Shader } from 'comun/game-shaders.ts';

/** What the games' pages get (#176, #405), from the house itself or, in Seilide, through it. */

export interface ConsoleCard {
	id: string;
	name: string;
	count: number;
	images: string[];
}

export interface ConsoleGame {
	file: string;
	title: string;
}

export interface GameSave {
	id: number;
	createdAt: string;
	picture: string | null;
}

export interface GameInfo {
	status: string | null;
	year: number | null;
	developers: string[];
	genres: string[];
	modes: string[];
	composers: string[];
	synopsis: string | null;
}

export interface GameSummary {
	title: string;
	system: string;
	saves: GameSave[];
	played: { seconds: number; last: string | null };
}

/** What the player needs (GamePlayer.svelte). */
export interface PlayerData {
	title: string;
	core: string;
	rom: string;
	bios: string | null | undefined;
	gameId: number;
	backdrop: string;
	cartridge: string;
	controls: unknown;
	shader: { own: Shader | null; inherited: Shader };
}

/** What the player needs from the app's router, which a shared component cannot import. */
export interface PlayerNavigation {
	beforeNavigate(
		callback: (nav: {
			type: string;
			delta?: number;
			to: { url: URL } | null;
			cancel(): void;
		}) => void
	): void;
	goto(url: URL): Promise<void>;
	pushState(url: string, state: never): void;
}
