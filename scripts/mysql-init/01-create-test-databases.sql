-- Runs once on first MySQL container init (empty data volume), e.g. on a
-- fresh CI runner. Creates the isolated databases used by the integration
-- tests and the e2e stack, so neither ever touches the dev `livechat_db`.
-- On an existing volume this does not re-run; the e2e api-startup script and
-- the integration harness create their database on demand as a fallback.
CREATE DATABASE IF NOT EXISTS livechat_test;
CREATE DATABASE IF NOT EXISTS livechat_e2e;
GRANT ALL PRIVILEGES ON livechat_test.* TO 'livechat_user'@'%';
GRANT ALL PRIVILEGES ON livechat_e2e.* TO 'livechat_user'@'%';
FLUSH PRIVILEGES;
