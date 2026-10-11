-- Additive. No historical backfill, no automatic approvals, no expense/payment mutations.
CREATE TABLE IF NOT EXISTS personnel_material_intakes (
 id TEXT PRIMARY KEY, sender_member_id TEXT NOT NULL REFERENCES members(id),
 sender_account_user_id TEXT NOT NULL, content_sha256 TEXT NOT NULL,
 title TEXT NOT NULL, source_text TEXT NOT NULL, unresolved_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(sender_member_id,sender_account_user_id,content_sha256)
);
CREATE TABLE IF NOT EXISTS personnel_material_assignments (
 intake_id TEXT NOT NULL REFERENCES personnel_material_intakes(id),
 member_id TEXT NOT NULL REFERENCES members(id), account_user_id TEXT NOT NULL,
 entry_id TEXT NOT NULL UNIQUE REFERENCES personnel_weekly_entries(id),
 categories_json TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(intake_id,member_id)
);
CREATE TABLE IF NOT EXISTS personnel_material_task_links (
 task_id TEXT PRIMARY KEY REFERENCES ai_workbench_tasks(id),
 intake_id TEXT NOT NULL REFERENCES personnel_material_intakes(id)
);
-- Once raw material has entered the three-category flow, producing a Word/weekly
-- report from that same material must not create a second personal statement.
DROP TRIGGER IF EXISTS personnel_auto_task;
CREATE TRIGGER personnel_auto_task AFTER UPDATE OF status ON ai_workbench_tasks
WHEN NEW.status='succeeded' AND OLD.status<>'succeeded' AND NEW.origin='oa'
 AND NEW.kind IN ('weekly_report','meeting_minutes')
 AND NOT EXISTS(SELECT 1 FROM personnel_material_task_links WHERE task_id=NEW.id) BEGIN
 INSERT INTO personnel_task_participants(task_id,member_id,account_user_id,added_by_member_id,created_at)
 VALUES(NEW.id,NEW.member_id,NEW.account_user_id,NEW.member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(task_id,member_id) DO NOTHING;
 INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-'||t.id||'-'||m.id,m.id,'ai:'||t.id,t.title,t.result,t.title,
 CASE WHEN t.kind='weekly_report' AND m.id=t.member_id AND length(t.result)<=3500 THEN t.result ELSE '' END,
 'weekly-auto-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'auto:'||t.id
 FROM ai_workbench_tasks t JOIN personnel_task_participants p ON p.task_id=t.id
 JOIN members m ON m.id=p.member_id AND m.account_user_id=p.account_user_id
 WHERE t.id=NEW.id AND t.status='succeeded' AND length(trim(t.result))>0 AND m.status='active'
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;
DROP TRIGGER IF EXISTS personnel_auto_participant;
CREATE TRIGGER personnel_auto_participant AFTER INSERT ON personnel_task_participants
WHEN NOT EXISTS(SELECT 1 FROM personnel_material_task_links WHERE task_id=NEW.task_id) BEGIN
 INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-'||t.id||'-'||m.id,m.id,'ai:'||t.id,t.title,t.result,t.title,
 CASE WHEN t.kind='weekly_report' AND m.id=t.member_id AND length(t.result)<=3500 THEN t.result ELSE '' END,
 'weekly-auto-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'auto:'||t.id
 FROM ai_workbench_tasks t JOIN personnel_task_participants p ON p.task_id=t.id
 JOIN members m ON m.id=p.member_id AND m.account_user_id=p.account_user_id
 WHERE t.id=NEW.task_id AND m.id=NEW.member_id AND t.origin='oa' AND t.kind IN ('weekly_report','meeting_minutes')
 AND t.status='succeeded' AND length(trim(t.result))>0 AND m.status='active'
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;
-- Archiving the identical raw source remains a knowledge-library operation,
-- while the material's original personal confirmations remain the only ones.
DROP TRIGGER IF EXISTS personnel_auto_knowledge_event;
CREATE TRIGGER personnel_auto_knowledge_event AFTER INSERT ON knowledge_events
WHEN NEW.action IN ('submitted','resubmitted','admin_edited') BEGIN
 INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-knowledge-'||s.item_id||'-'||m.id,m.id,'knowledge-item:'||s.item_id,s.title,s.source_text,s.title,
 CASE WHEN s.kind='weekly' AND length(s.source_text)<=3500 THEN s.source_text ELSE '' END,
 'weekly-auto-'||lower(hex(randomblob(16))),NEW.created_at,NEW.created_at,'auto:'||NEW.revision_id
 FROM personnel_knowledge_weekly_source s JOIN members m ON m.id=s.submitter_member_id
  AND lower(m.chatgpt_account)=lower(s.submitter_email)
 WHERE s.item_id=NEW.item_id AND s.current_revision_id=NEW.revision_id AND length(trim(s.source_text))>0
  AND m.status='active' AND m.account_user_id IS NOT NULL AND m.nda_accepted_at IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM personnel_material_intakes i WHERE i.sender_member_id=m.id
    AND i.sender_account_user_id=m.account_user_id
    AND trim(replace(replace(i.source_text,char(13)||char(10),char(10)),char(13),char(10)))=
        trim(replace(replace(s.source_text,char(13)||char(10),char(10)),char(13),char(10)))
    AND EXISTS(SELECT 1 FROM personnel_material_assignments a WHERE a.intake_id=i.id))
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS personnel_material_intakes_freeze_insert BEFORE INSERT ON personnel_material_intakes WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_assignments_freeze_insert BEFORE INSERT ON personnel_material_assignments WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_intakes_freeze_update BEFORE UPDATE ON personnel_material_intakes WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_assignments_freeze_update BEFORE UPDATE ON personnel_material_assignments WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_intakes_freeze_delete BEFORE DELETE ON personnel_material_intakes WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_assignments_freeze_delete BEFORE DELETE ON personnel_material_assignments WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_task_links_freeze_insert BEFORE INSERT ON personnel_material_task_links WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_task_links_freeze_update BEFORE UPDATE ON personnel_material_task_links WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_material_task_links_freeze_delete BEFORE DELETE ON personnel_material_task_links WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
