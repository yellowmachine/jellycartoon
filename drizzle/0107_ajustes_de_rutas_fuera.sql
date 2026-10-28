-- The road mode is the cloud's now (#253): openrouteservice's key is each family's there (Ajustes →
-- Familia), and a shared trip is shown by the cloud itself, with no relay.
DELETE FROM "app_setting" WHERE "key" IN ('ors_api_key', 'ors_url', 'relay_url', 'relay_key');
