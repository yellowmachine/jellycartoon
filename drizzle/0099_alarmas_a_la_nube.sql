-- The alarms and the agenda go to the cloud (#253): the house keeps only its timers. Its alarms
-- are gone first, so that none rings as a timer once their columns go (0100); the agenda's link
-- secret, too.
DELETE FROM "alarm" WHERE "kind" = 'alarma';--> statement-breakpoint
DELETE FROM "app_setting" WHERE "key" = 'agenda_ics_token';
