import nodemailer, { type Transporter } from 'nodemailer';
import {
	EMAIL_FROM,
	SMTP_HOST,
	SMTP_PASS,
	SMTP_PORT,
	SMTP_SECURE,
	SMTP_USER
} from '$app/env/private';

/**
 * The app's emails, through SMTP (Proton's, as svelte-thinking's mailer.ts). Without SMTP_HOST none
 * is sent: only logged, which is enough in development.
 */
let transporter: Transporter | null = null;

function smtp(): Transporter | null {
	if (!SMTP_HOST) return null;
	transporter ??= nodemailer.createTransport({
		host: SMTP_HOST,
		port: SMTP_PORT,
		secure: SMTP_SECURE,
		// Failing soon rather than holding the request (nodemailer's defaults: 2–10 minutes).
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		auth: { user: SMTP_USER, pass: SMTP_PASS }
	});
	return transporter;
}

export async function sendMail(mail: {
	to: string;
	subject: string;
	html: string;
	replyTo?: string;
}) {
	const via = smtp();
	if (!via) {
		console.log(`[mailer] Sin SMTP_HOST: no se envía a ${mail.to} «${mail.subject}»`);
		return;
	}
	await via.sendMail({ from: EMAIL_FROM, ...mail });
}
