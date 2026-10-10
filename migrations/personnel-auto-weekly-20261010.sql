-- Apply after expense-ledger, review-routing, and migrations/oa/0002-0004.
-- Future source events only. No historical backfill or staff/permission changes.
CREATE TABLE IF NOT EXISTS personnel_task_participants (
 task_id TEXT NOT NULL REFERENCES ai_workbench_tasks(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id), account_user_id TEXT NOT NULL,
 added_by_member_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(task_id,member_id)
);
CREATE TRIGGER IF NOT EXISTS personnel_auto_audit AFTER INSERT ON personnel_weekly_entries
WHEN NEW.id LIKE 'auto-%' BEGIN
 INSERT INTO expense_events(id,target_id,action,actor,occurred_at,before_json,after_json)
 VALUES('auto-event:'||NEW.id,NEW.id,'work_auto_create','system',NEW.created_at,'{}',json_object('memberId',NEW.member_id,'sourceKey',NEW.source_key,'state','draft'));
 UPDATE expense_ledger_meta SET revision=revision+1 WHERE id=1;
END;
CREATE TRIGGER IF NOT EXISTS personnel_auto_task AFTER UPDATE OF status ON ai_workbench_tasks
WHEN NEW.status='succeeded' AND OLD.status<>'succeeded' AND NEW.origin='oa'
 AND NEW.kind IN ('weekly_report','meeting_minutes') BEGIN
 INSERT INTO personnel_task_participants(task_id,member_id,account_user_id,added_by_member_id,created_at)
 VALUES(NEW.id,NEW.member_id,NEW.account_user_id,NEW.member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(task_id,member_id) DO NOTHING;
INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-'||t.id||'-'||m.id,m.id,'ai:'||t.id,t.title,t.result,t.title,
 CASE WHEN t.kind='weekly_report' AND m.id=t.member_id AND length(t.result)<=3500 THEN t.result ELSE '' END,
 'weekly-auto-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'auto:'||t.id
 FROM ai_workbench_tasks t JOIN personnel_task_participants p ON p.task_id=t.id
 JOIN members m ON m.id=p.member_id AND m.account_user_id=p.account_user_id
 WHERE t.id=NEW.id AND t.origin='oa' AND t.kind IN ('weekly_report','meeting_minutes')
 AND t.status='succeeded' AND length(trim(t.result))>0 AND m.status='active'
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS personnel_auto_participant AFTER INSERT ON personnel_task_participants BEGIN
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
CREATE TRIGGER IF NOT EXISTS personnel_auto_knowledge AFTER UPDATE OF current_revision_id ON knowledge_items
WHEN NEW.current_revision_id IS NOT NULL AND NEW.current_revision_id IS NOT OLD.current_revision_id AND NEW.revoked_at IS NULL
 AND (NEW.title LIKE '%周报%' OR NEW.category LIKE '%周报%' OR NEW.title LIKE '%周会%' OR NEW.category LIKE '%周会%') BEGIN
 INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-knowledge-'||NEW.id,m.id,'knowledge-item:'||NEW.id,NEW.title,r.content,NEW.title,
 CASE WHEN length(r.content)<=3500 AND NEW.title NOT LIKE '%周会%' THEN r.content ELSE '' END,
 'weekly-auto-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),'auto:'||r.id
 FROM knowledge_revisions r JOIN members m ON m.id=NEW.submitter_member_id AND lower(m.chatgpt_account)=lower(NEW.submitter_email)
 WHERE r.id=NEW.current_revision_id AND m.status='active' AND length(trim(r.content))>0
 AND r.source_label NOT LIKE 'OA AI 成果归档 · %'
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS personnel_task_participants_freeze_insert BEFORE INSERT ON personnel_task_participants WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_task_participants_freeze_update BEFORE UPDATE ON personnel_task_participants WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_task_participants_freeze_delete BEFORE DELETE ON personnel_task_participants WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_weekly_entries_freeze_insert BEFORE INSERT ON personnel_weekly_entries WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_weekly_entries_freeze_update BEFORE UPDATE ON personnel_weekly_entries WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_weekly_entries_freeze_delete BEFORE DELETE ON personnel_weekly_entries WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
