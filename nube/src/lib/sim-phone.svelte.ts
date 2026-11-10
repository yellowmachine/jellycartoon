import { cleanNumber, isCallable } from '#lib/sim-number.ts';

/**
 * Normal phone calls, with this device's SIM (#330): turned on per device in Ajustes → Este aparato
 * («Este aparato puede llamar por teléfono»), since no web API tells whether there is a SIM. A web
 * page cannot call by itself: a `tel:` link opens Android's phone app with the number written, and
 * a tap there calls; hung up, Android goes back to the page.
 *
 * Its contacts stay on this device, in the browser: picked from the phone's contacts (Contact
 * Picker, Chrome on Android) or written by hand. Only their names go to the voice («llama a la
 * farmacia»); the numbers never leave it.
 */

const ON_KEY = 'nube:telefono';
const CONTACTS_KEY = 'nube:telefono-contactos';
/** Enough for a car; more, and the list for the voice gets long. */
export const MAX_PHONE_CONTACTS = 60;

export interface PhoneContact {
	name: string;
	number: string;
}

/** What the voice asked to call: shown big, to be tapped (the browser wants a touch for `tel:`). */
export interface PendingDial {
	name: string | null;
	number: string;
}

function read<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

function keep(key: string, value: unknown) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private window: only forgotten.
	}
}

function validContacts(value: unknown): PhoneContact[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(
			(c): c is PhoneContact =>
				Boolean(c) &&
				typeof c.name === 'string' &&
				typeof c.number === 'string' &&
				isCallable(c.number)
		)
		.slice(0, MAX_PHONE_CONTACTS);
}

/** The Contact Picker, where there is one: https://developer.mozilla.org/docs/Web/API/Contact_Picker_API */
interface ContactsManager {
	select(
		properties: ('name' | 'tel')[],
		options?: { multiple?: boolean }
	): Promise<{ name?: string[]; tel?: string[] }[]>;
}

const picker = (): ContactsManager | null =>
	typeof navigator !== 'undefined' && 'contacts' in navigator
		? (navigator as unknown as { contacts: ContactsManager }).contacts
		: null;

class SimPhone {
	on = $state(typeof window !== 'undefined' && read<boolean>(ON_KEY, false) === true);
	contacts = $state<PhoneContact[]>(
		typeof window === 'undefined' ? [] : validContacts(read(CONTACTS_KEY, []))
	);
	/** Asked by voice, waiting for a tap. */
	pending = $state<PendingDial | null>(null);

	/** This browser can open the phone's contacts to pick some. */
	get canPick() {
		return picker() !== null;
	}

	set(on: boolean) {
		this.on = on;
		keep(ON_KEY, on ? true : null);
		if (!on) this.pending = null;
	}

	add(contact: PhoneContact): boolean {
		const name = contact.name.trim().slice(0, 60);
		if (!name || !isCallable(contact.number)) return false;
		const number = cleanNumber(contact.number);
		const rest = this.contacts.filter((c) => c.name !== name);
		this.contacts = [...rest, { name, number }]
			.sort((a, b) => a.name.localeCompare(b.name, 'es'))
			.slice(0, MAX_PHONE_CONTACTS);
		keep(CONTACTS_KEY, this.contacts);
		return true;
	}

	remove(name: string) {
		this.contacts = this.contacts.filter((c) => c.name !== name);
		keep(CONTACTS_KEY, this.contacts.length ? this.contacts : null);
	}

	/** From the phone's contacts, several at once: how many were added. Closed, none. */
	async pick(): Promise<number> {
		const contacts = picker();
		if (!contacts) return 0;
		const chosen = await contacts.select(['name', 'tel'], { multiple: true }).catch(() => []);
		let added = 0;
		for (const c of chosen) {
			const name = c.name?.[0];
			const number = c.tel?.find(isCallable);
			if (name && number && this.add({ name, number })) added++;
		}
		return added;
	}

	/** By voice: one of the contacts, by its place in the list said to the AI, or a number said. */
	ask(dial: { contact?: number; number?: string; name?: string | null }) {
		if (!this.on) return;
		const contact = dial.contact === undefined ? null : this.contacts[dial.contact];
		if (contact) this.pending = { name: contact.name, number: contact.number };
		else if (dial.number && isCallable(dial.number))
			this.pending = { name: dial.name ?? null, number: cleanNumber(dial.number) };
	}

	/** The names, in order, for the voice: their place is how it says which one. */
	names(): string[] {
		return this.on ? this.contacts.map((c) => c.name) : [];
	}
}

export const simPhone = new SimPhone();
