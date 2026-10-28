-- The family's Telegram bot is the cloud's now (#253): one bot listens from one place only. Its
-- token, forgotten here (@BotFather gives it again: /mybots → API Token).
DELETE FROM "app_setting" WHERE "key" = 'telegram_bot';
