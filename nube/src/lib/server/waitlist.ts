import { db } from './db/index.ts';
import { waitlist } from './db/schema.ts';
import { sendWaitlistNotice, sendWaitlistReceived } from './emails.ts';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A family asking to come in (the landing page's «Pedir acceso»). Asking again changes nothing and
 * says nothing different, so the form does not tell who has asked or has an account. The emails go
 * after, without holding the answer: the request is kept even if they fail.
 */
export async function askForAccess(request: {
	email: string;
	name: string;
	message: string | null;
}) {
	const [added] = await db
		.insert(waitlist)
		.values({ id: crypto.randomUUID(), ...request })
		.onConflictDoNothing()
		.returning({ id: waitlist.id });
	if (!added) return;
	sendWaitlistReceived(request.email, request.name).catch((error) =>
		console.error(`[waitlist] El correo a ${request.email} no salió:`, error)
	);
	sendWaitlistNotice(request).catch((error) =>
		console.error('[waitlist] El aviso al administrador no salió:', error)
	);
}
