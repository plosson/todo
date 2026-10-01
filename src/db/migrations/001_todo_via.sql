-- Which session (ses_…) or API token (tok_…) added / checked off a todo.
-- No foreign key: the id points into either auth_sessions or api_tokens.
ALTER TABLE todos ADD COLUMN created_via TEXT;
ALTER TABLE todos ADD COLUMN done_via TEXT;
