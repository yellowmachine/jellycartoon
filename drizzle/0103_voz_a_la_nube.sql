-- The voice's brain is the cloud's now (#253): its character, the web search and the «horas de
-- silencio» are set there (Ajustes → La voz), with each person's style (0102 drops that column).
DELETE FROM "app_setting" WHERE "key" IN ('voice_style', 'voice_web', 'voice_quiet');
