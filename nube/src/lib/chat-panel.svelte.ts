import type { ChatMessage } from '#lib/chat.ts';

export interface ChatData {
	messages: ChatMessage[];
	toBuy: string[];
	hasAi: boolean;
}

/** The chat as its page loads it, for the panel and the phone's sheet. */
export async function readChat(): Promise<ChatData> {
	const res = await fetch('/api/preguntar');
	if (!res.ok) throw new Error(String(res.status));
	return res.json();
}

/**
 * «Preguntar» beside any page (#504): on a wide screen, the chat in a panel on the right, opened
 * from the bar's button. Open or closed, remembered in this browser (if it can: a private window
 * may not).
 */

const STORAGE_KEY = 'chat-panel';

class ChatPanel {
	open = $state(false);

	constructor() {
		try {
			this.open = globalThis.localStorage?.getItem(STORAGE_KEY) === 'open';
		} catch {
			// No storage here: closed at first.
		}
	}

	toggle() {
		this.open = !this.open;
		try {
			localStorage.setItem(STORAGE_KEY, this.open ? 'open' : 'closed');
		} catch {
			// Only not remembered.
		}
	}
}

export const chatPanel = new ChatPanel();
