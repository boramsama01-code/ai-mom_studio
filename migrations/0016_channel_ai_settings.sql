-- Null uses role defaults: Gemini summaries, GPT copy, and OpenAI images.
-- Existing content, credentials and provider conversation data are unchanged.
ALTER TABLE channels ADD COLUMN ai_settings jsonb;
