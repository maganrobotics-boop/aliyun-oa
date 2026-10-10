-- Run after personnel-auto-weekly-20261010.sql. No historical backfill.
-- A submission event is written after all revision parts, in the same transaction.
DROP TRIGGER IF EXISTS personnel_auto_knowledge;

CREATE VIEW IF NOT EXISTS personnel_knowledge_weekly_source AS
SELECT i.id AS item_id, i.submitter_member_id, i.submitter_email, i.mutation_revision,
 i.current_revision_id, i.title, i.category,
 CASE WHEN EXISTS(SELECT 1 FROM knowledge_revision_parts WHERE revision_id=r.id AND item_id=i.id)
 THEN (SELECT group_concat(content,'') FROM
   (SELECT content FROM knowledge_revision_parts WHERE revision_id=r.id AND item_id=i.id ORDER BY part_no))
 ELSE r.content END AS source_text,
 CASE WHEN i.title LIKE '%周会%' OR i.category LIKE '%周会%' THEN 'meeting' ELSE 'weekly' END AS kind
FROM knowledge_items i JOIN knowledge_revisions r ON r.id=i.current_revision_id AND r.item_id=i.id
WHERE i.revoked_at IS NULL AND i.status IN ('pending','active')
 AND (i.title LIKE '%周报%' OR i.category LIKE '%周报%' OR i.title LIKE '%周会%' OR i.category LIKE '%周会%')
 AND r.source_label NOT LIKE 'OA AI 成果归档 · %';

CREATE TRIGGER IF NOT EXISTS personnel_auto_knowledge_event AFTER INSERT ON knowledge_events
WHEN NEW.action IN ('submitted','resubmitted','admin_edited') BEGIN
 INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-knowledge-'||s.item_id||'-'||m.id,m.id,'knowledge-item:'||s.item_id,s.title,s.source_text,s.title,
 CASE WHEN s.kind='weekly' AND length(s.source_text)<=3500 THEN s.source_text ELSE '' END,
 'weekly-auto-'||lower(hex(randomblob(16))),NEW.created_at,NEW.created_at,'auto:'||NEW.revision_id
 FROM personnel_knowledge_weekly_source s JOIN members m ON m.id=s.submitter_member_id
  AND lower(m.chatgpt_account)=lower(s.submitter_email)
 WHERE s.item_id=NEW.item_id AND s.current_revision_id=NEW.revision_id AND length(trim(s.source_text))>0
  AND m.status='active' AND m.account_user_id IS NOT NULL AND m.nda_accepted_at IS NOT NULL
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;

CREATE TABLE IF NOT EXISTS personnel_knowledge_participants (
 item_id TEXT NOT NULL REFERENCES knowledge_items(id),
 member_id TEXT NOT NULL REFERENCES members(id), account_user_id TEXT NOT NULL,
 added_by_member_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(item_id,member_id)
);
CREATE TRIGGER IF NOT EXISTS personnel_auto_knowledge_participant AFTER INSERT ON personnel_knowledge_participants BEGIN
 INSERT INTO personnel_weekly_entries(id,member_id,source_key,source_title,source_text,title,content,client_key,created_at,updated_at,mutation_token)
 SELECT 'auto-knowledge-'||NEW.item_id||'-'||m.id,m.id,w.source_key,w.source_title,w.source_text,w.source_title,'',
 'weekly-auto-'||lower(hex(randomblob(16))),NEW.created_at,NEW.created_at,'auto-participant:'||NEW.item_id
 FROM personnel_weekly_entries w JOIN knowledge_items i ON i.id=NEW.item_id
 JOIN members m ON m.id=NEW.member_id AND m.account_user_id=NEW.account_user_id
 WHERE w.member_id=i.submitter_member_id AND w.source_key='knowledge-item:'||i.id
  AND m.status='active' AND m.nda_accepted_at IS NOT NULL
 ON CONFLICT(member_id,source_key) DO NOTHING;
END;
CREATE TRIGGER IF NOT EXISTS personnel_knowledge_participants_freeze_insert BEFORE INSERT ON personnel_knowledge_participants WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_knowledge_participants_freeze_update BEFORE UPDATE ON personnel_knowledge_participants WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
CREATE TRIGGER IF NOT EXISTS personnel_knowledge_participants_freeze_delete BEFORE DELETE ON personnel_knowledge_participants WHEN EXISTS(SELECT 1 FROM migration_control WHERE deactivated_at IS NULL) BEGIN SELECT RAISE(ABORT,'migration write freeze active'); END;
