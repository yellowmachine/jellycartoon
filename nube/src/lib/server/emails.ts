import { ADMIN_EMAIL, ORIGIN } from '$app/env/private';
import { sendMail } from './mailer.ts';

/** The app's name in its emails: one place, while the new one is decided (#253). */
const NAME = 'Nube';

const escape = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

/** One email's page: the name above, the paragraphs, and where it comes from below. */
function page(paragraphs: string[]) {
	const body = paragraphs
		.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#27272a">${p}</p>`)
		.join('');
	return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:system-ui,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="100%" style="max-width:560px;background:#fff;border-radius:8px;border:1px solid #e4e4e7">
<tr><td style="background:#18181b;padding:24px 32px;border-radius:8px 8px 0 0">
<p style="margin:0;font-size:22px;font-weight:bold;color:#fbbf24">${NAME}</p></td></tr>
<tr><td style="padding:32px">${body}</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;font-size:13px;color:#71717a">
<a href="${ORIGIN}" style="color:#71717a">${new URL(ORIGIN).host}</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** To whoever asked to come in: it is written down, and they will hear back. */
export function sendWaitlistReceived(to: string, name: string) {
	return sendMail({
		to,
		subject: `Hemos recibido tu petición para ${NAME}`,
		html: page([
			`Hola, ${escape(name)}:`,
			`Gracias por querer probar ${NAME}. Tenemos apuntada tu petición y la miraremos pronto.`,
			'Cuando tengas acceso te llegará otro correo con el enlace para crear tu familia: de momento no tienes que hacer nada.',
			'Si quieres contarnos algo, responde a este correo.'
		])
	});
}

/** To the service's administrator: who asked, and what for; answering goes to them. */
export function sendWaitlistNotice(request: {
	email: string;
	name: string;
	message: string | null;
}) {
	if (!ADMIN_EMAIL) return Promise.resolve();
	return sendMail({
		to: ADMIN_EMAIL,
		replyTo: request.email,
		subject: `${NAME}: ${request.name} pide acceso`,
		html: page([
			`<strong>${escape(request.name)}</strong> (${escape(request.email)}) pide acceso.`,
			request.message ? `«${escape(request.message)}»` : 'Sin mensaje.'
		])
	});
}

/**
 * An invitation's link: into a family, by who invites; or, with no family, to make one's own (a
 * family let in from the waiting list).
 */
export function sendInvitation(i: {
	to: string;
	link: string;
	inviterName: string;
	familyName: string | null;
}) {
	const button = `<a href="${i.link}" style="display:inline-block;background:#f59e0b;color:#09090b;padding:10px 20px;border-radius:6px;font-weight:600;text-decoration:none">${i.familyName ? 'Ver la invitación' : 'Crear mi familia'}</a>`;
	const lapses = 'El enlace caduca en 7 días.';
	return sendMail({
		to: i.to,
		subject: i.familyName
			? `${i.inviterName} te invita a «${i.familyName}» en ${NAME}`
			: `Ya puedes entrar en ${NAME}`,
		html: page(
			i.familyName
				? [
						`${escape(i.inviterName)} te invita a la familia <strong>${escape(i.familyName)}</strong> en ${NAME}: la nevera, las recetas, la agenda y los gastos de casa, juntos.`,
						button,
						`${lapses} Si no esperabas este correo, no hagas nada.`
					]
				: [
						`¡Ya tienes acceso a ${NAME}! Con este enlace creas tu cuenta y tu familia, y luego invitas a los tuyos desde Ajustes.`,
						button,
						lapses
					]
		)
	});
}
