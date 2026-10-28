import { sql } from 'drizzle-orm';
import {
	boolean,
	date,
	foreignKey,
	index,
	integer,
	pgEnum,
	pgPolicy,
	pgTable,
	primaryKey,
	serial,
	text,
	time,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's agenda and alarms (#253; jellycartoon's #200 and #241), its people, and the phones
 * that get its notices (Web Push). Days and times «on the wall», in the family's time zone (`TZ`),
 * not instants: a change of the clocks moves nothing.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

/**
 * Who the agenda and the alarms can be for: each person of the family with an account (made the
 * first time the agenda is looked at, `userId`), and those without one, the children (#253), with
 * their name, emoji and colour (comun/avatars.ts).
 */
export const familyPerson = pgTable(
	'family_person',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		/** Their account; null, a person without one. Gone, they stay as one without. */
		userId: text('user_id')
			.unique()
			.references(() => user.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		/** An avatar's id (comun/avatars.ts); null, their initial. */
		avatar: text('avatar'),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('family_person_family_idx').on(t.familyId),
		unique('family_person_family_id').on(t.familyId, t.id),
		familyRows('family_person_own', t.familyId)
	]
).enableRLS();

export const calendarRemind = pgEnum('calendar_remind', ['hora', 'dia']);

export const calendarEvent = pgTable(
	'calendar_event',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		title: text('title').notNull(),
		notes: text('notes'),
		startDay: date('start_day').notNull(),
		/** Null: all day. */
		startTime: time('start_time'),
		/** Its last day, if it is longer than one (holidays from the 3rd to the 10th). */
		endDay: date('end_day'),
		endTime: time('end_time'),
		/** An RRULE (RFC 5545) of one of the four repeats (comun/agenda.ts); null, not repeated. */
		repeat: text('repeat'),
		/** The repetitions skipped, «esta vez no»: the days they start on. */
		skipDays: date('skip_days')
			.array()
			.notNull()
			.default(sql`'{}'::date[]`),
		/** Its one notice: an hour before, or the day before; null, none. */
		remind: calendarRemind('remind'),
		/** The day of the last repetition told, so it is told once. */
		remindedDay: date('reminded_day'),
		/** Who wrote it down; null if their account is gone, or the house's voice. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('calendar_event_start_idx').on(t.familyId, t.startDay),
		unique('calendar_event_family_id').on(t.familyId, t.id),
		familyRows('calendar_event_own', t.familyId)
	]
).enableRLS();

/** Who each one is for. Both of its own family: foreign keys are checked without row security. */
export const calendarEventPerson = pgTable(
	'calendar_event_person',
	{
		familyId: familyId(),
		eventId: integer('event_id').notNull(),
		personId: integer('person_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.eventId, t.personId] }),
		foreignKey({
			name: 'calendar_event_person_event_fk',
			columns: [t.familyId, t.eventId],
			foreignColumns: [calendarEvent.familyId, calendarEvent.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'calendar_event_person_person_fk',
			columns: [t.familyId, t.personId],
			foreignColumns: [familyPerson.familyId, familyPerson.id]
		}).onDelete('cascade'),
		familyRows('calendar_event_person_own', t.familyId)
	]
).enableRLS();

/** What one does when it is time: ring, saying its name; or stop the house's music. */
export const alarmAction = pgEnum('alarm_action', ['sonar', 'parar_musica']);

/**
 * The family's alarms (jellycartoon's #241): at `time` from `startDay`, repeated on some weekdays
 * (an RRULE of the agenda's, `repeat`) or once. The cloud keeps the time; when it comes, the house
 * makes it sound (alarms.ts). The timers stay in the house.
 */
export const alarm = pgTable(
	'alarm',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		label: text('label').notNull(),
		time: time('time').notNull(),
		startDay: date('start_day').notNull(),
		repeat: text('repeat'),
		/** «Esta vez no»: the days skipped. */
		skipDays: date('skip_days')
			.array()
			.notNull()
			.default(sql`'{}'::date[]`),
		/** Kept, but not ringing until it is on again. */
		paused: boolean('paused').notNull().default(false),
		/** When it is due next; null, never again. */
		nextAt: timestamp('next_at'),
		action: alarmAction('action').notNull().default('sonar'),
		/** Where it sounds in the house: `casa` (all of it), or `satelite:<id>`. */
		place: text('place').notNull().default('casa'),
		/** Ringing since then, until someone stops it. */
		ringingSince: timestamp('ringing_since'),
		/** Over (it does not repeat, and rang), and when: kept a while to tell the voice. */
		doneAt: timestamp('done_at'),
		/** Who set it; null if their account is gone, or the house's voice. */
		userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('alarm_next_idx').on(t.nextAt),
		unique('alarm_family_id').on(t.familyId, t.id),
		familyRows('alarm_own', t.familyId)
	]
).enableRLS();

/** Who each is for, as an event's; none, the house's. */
export const alarmPerson = pgTable(
	'alarm_person',
	{
		familyId: familyId(),
		alarmId: integer('alarm_id').notNull(),
		personId: integer('person_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.alarmId, t.personId] }),
		foreignKey({
			name: 'alarm_person_alarm_fk',
			columns: [t.familyId, t.alarmId],
			foreignColumns: [alarm.familyId, alarm.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'alarm_person_person_fk',
			columns: [t.familyId, t.personId],
			foreignColumns: [familyPerson.familyId, familyPerson.id]
		}).onDelete('cascade'),
		familyRows('alarm_person_own', t.familyId)
	]
).enableRLS();

/**
 * The agenda's .ics link, for a phone's calendar: read without a session, so found by its secret
 * before knowing the family (`app.ics_token`, as the house's keys), and otherwise only the family's.
 */
export const agendaLink = pgTable(
	'agenda_link',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique()
	},
	(t) => [
		familyRows('agenda_link_own', t.familyId),
		pgPolicy('agenda_link_by_token', {
			for: 'select',
			using: sql`${t.token} = nullif(current_setting('app.ics_token', true), '')`
		})
	]
).enableRLS();

/** A phone that gets the notices of a person of the family, with the app closed (push.ts). */
export const pushSubscription = pgTable(
	'push_subscription',
	{
		id: serial('id').primaryKey(),
		familyId: familyId(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull().unique(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('push_subscription_user_idx').on(t.userId),
		familyRows('push_subscription_own', t.familyId)
	]
).enableRLS();

/**
 * The service's own settings, of no family: the VAPID keys that sign the notices (push.ts). Without
 * row-level security, as `invitation`: only the server touches it.
 */
export const serviceSetting = pgTable('service_setting', {
	key: text('key').primaryKey(),
	value: text('value').notNull(),
	updatedAt: timestamp('updated_at')
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date())
});
