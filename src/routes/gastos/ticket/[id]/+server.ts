import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { fileResponse } from '#lib/server/file-response.ts';
import { isKid } from '#lib/server/kids.ts';
import { receiptOf } from '#lib/server/expenses/expenses.ts';
import { receiptsDir } from '#lib/server/expenses/receipt.ts';

/** An expense's receipt as photographed (#194), or its bill's PDF (#232): for the adults. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const file = await receiptOf(Number(params.id));
	if (!file) error(404, 'Sin ticket');
	return fileResponse(
		request,
		path.join(receiptsDir, file),
		file.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
		'private, max-age=86400'
	);
};
