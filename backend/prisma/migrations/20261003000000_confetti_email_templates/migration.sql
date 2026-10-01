-- Switch saved guest email templates to the Confetti design.
-- The new defaults live in code (backend/src/automation/email.service.ts). Removing the saved
-- rows makes SettingsService fall back to them. The old designs are kept under *_backup_20261003
-- keys so they can be restored by hand if needed.
INSERT INTO "app_settings" ("key", "value", "updated_at")
SELECT "key" || '_backup_20261003', "value", now()
FROM "app_settings"
WHERE "key" IN ('email_template', 'email_template_tenant', 'email_template_visitor_viewing')
ON CONFLICT ("key") DO NOTHING;

DELETE FROM "app_settings"
WHERE "key" IN ('email_template', 'email_template_tenant', 'email_template_visitor_viewing');
