import {
	bigint,
	doublePrecision,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';
import type { LngLat } from 'comun/road.ts';
import type { RouteStop } from 'comun/saved-places.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Viajes (#253; jellycartoon's #81, #151, #164): each person's trips and photos from the road mode,
 * their places and routes kept with a name, and the family's devices that keep routes' maps.
 */

const familyId = () =>
	text('family_id')
		.notNull()
		.references(() => family.id, { onDelete: 'cascade' });

const userId = () =>
	text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' });

/**
 * A trip in the road mode, from the browser's GPS while it is open: positions in a row, a new trip
 * after a long stop. Only for whoever turned it on in Ajustes.
 */
export const trip = pgTable(
	'trip',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		userId: userId(),
		startedAt: timestamp('started_at').notNull(),
		/** Its last position's time. */
		endedAt: timestamp('ended_at').notNull(),
		/** Metres, along its positions. */
		distance: real('distance').notNull().default(0),
		/** m/s, the fastest the GPS said. */
		maxSpeed: real('max_speed'),
		/** The road mode's route, if there was one: «Plaza de Zocodover, Toledo». */
		destination: text('destination'),
		/** Its positions, [longitude, latitude, seconds since 1970], one every ~25 m. */
		line: jsonb('line').$type<[number, number, number][]>().notNull().default([])
	},
	(t) => [
		unique('trip_family_id').on(t.familyId, t.id),
		index('trip_user_started_idx').on(t.userId, t.startedAt),
		familyRows('trip_own', t.familyId)
	]
).enableRLS();

/**
 * A photo taken from the road mode: its JPEG in the family's storage (storage.ts, `fotos/<id>.jpg`),
 * here when and where, and the trip being kept then, if any. Only for whoever took it.
 */
export const tripPhoto = pgTable(
	'trip_photo',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		userId: userId(),
		/** The trip gone, the photo stays without it. Its own id is enough: RLS keeps it the family's. */
		tripId: integer('trip_id').references(() => trip.id, { onDelete: 'set null' }),
		takenAt: timestamp('taken_at').notNull(),
		/** Where, if the GPS said. */
		lon: real('lon'),
		lat: real('lat')
	},
	(t) => [
		index('trip_photo_user_taken_idx').on(t.userId, t.takenAt),
		familyRows('trip_photo_own', t.familyId)
	]
).enableRLS();

/**
 * A place kept with its name: «Casa», «Trabajo», «Centro comercial tal». The road mode offers them
 * first, and the voice knows them by their name. Only for whoever kept it.
 */
export const savedPlace = pgTable(
	'saved_place',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		userId: userId(),
		name: text('name').notNull(),
		lon: doublePrecision('lon').notNull(),
		lat: doublePrecision('lat').notNull(),
		/** Its address, if it was found by searching: «Calle Mayor 5, Toledo, España». */
		address: text('address')
	},
	(t) => [index('saved_place_user_idx').on(t.userId), familyRows('saved_place_own', t.familyId)]
).enableRLS();

/**
 * A route kept with its name: its stops in order, the first where it starts, the last where it
 * ends, and the way by car between them as openrouteservice gave it when it was kept.
 */
export const savedRoute = pgTable(
	'saved_route',
	{
		familyId: familyId(),
		id: serial('id').primaryKey(),
		userId: userId(),
		name: text('name').notNull(),
		stops: jsonb('stops').$type<RouteStop[]>().notNull(),
		line: jsonb('line').$type<LngLat[]>().notNull(),
		/** Metres and seconds, all of it. */
		distance: real('distance').notNull(),
		duration: real('duration').notNull()
	},
	(t) => [
		unique('saved_route_family_id').on(t.familyId, t.id),
		index('saved_route_user_idx').on(t.userId),
		familyRows('saved_route_own', t.familyId)
	]
).enableRLS();

/**
 * A device of the family that keeps routes' maps, such as the car's tablet: named on itself, its id
 * made there and kept in its browser.
 */
export const mapDevice = pgTable(
	'map_device',
	{
		familyId: familyId(),
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at').notNull().defaultNow()
	},
	(t) => [
		unique('map_device_family_id').on(t.familyId, t.id),
		familyRows('map_device_own', t.familyId)
	]
).enableRLS();

/**
 * A route's map on a device: ordered from any device, done by that one when the app opens on it.
 * `remove`, ordered away; the row goes once it is.
 */
export const routeMapState = pgEnum('route_map_state', [
	'pending',
	'downloading',
	'ready',
	'failed',
	'remove'
]);

export const routeMap = pgTable(
	'route_map',
	{
		familyId: familyId(),
		routeId: integer('route_id').notNull(),
		deviceId: text('device_id').notNull(),
		state: routeMapState('state').notNull().default('pending'),
		/** 0 to 1, while downloading. */
		progress: real('progress').notNull().default(0),
		bytes: bigint('bytes', { mode: 'number' }),
		/** The map and the route it was cut from (route-maps.ts): another now, it is old. */
		version: text('version'),
		/** Why it failed, as the device says it. */
		problem: text('problem'),
		updatedAt: timestamp('updated_at').notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.routeId, t.deviceId] }),
		foreignKey({
			name: 'route_map_route_fk',
			columns: [t.familyId, t.routeId],
			foreignColumns: [savedRoute.familyId, savedRoute.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'route_map_device_fk',
			columns: [t.familyId, t.deviceId],
			foreignColumns: [mapDevice.familyId, mapDevice.id]
		}).onDelete('cascade'),
		familyRows('route_map_own', t.familyId)
	]
).enableRLS();
