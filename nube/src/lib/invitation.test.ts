import { describe, expect, test } from 'bun:test';
import { invitationExpiry, invitationStatus } from './invitation.ts';

describe('invitationStatus', () => {
	const now = new Date('2026-10-29T12:00:00Z');
	const open = { usedAt: null, cancelledAt: null, expiresAt: invitationExpiry(now) };

	test('pending until it lapses, then expired', () => {
		expect(invitationStatus(open, now)).toBe('pending');
		expect(invitationStatus({ ...open, expiresAt: now }, now)).toBe('expired');
	});

	test('accepted or cancelled, whatever its date', () => {
		const late = new Date('2027-01-01T00:00:00Z');
		expect(invitationStatus({ ...open, usedAt: now }, late)).toBe('accepted');
		expect(invitationStatus({ ...open, cancelledAt: now }, late)).toBe('cancelled');
	});

	test('lasts seven days', () => {
		expect(invitationExpiry(now).toISOString()).toBe('2026-11-05T12:00:00.000Z');
	});
});
