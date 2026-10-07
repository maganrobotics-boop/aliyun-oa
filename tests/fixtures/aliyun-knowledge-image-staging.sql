-- Existing Aliyun schema: permit a pending replacement while the approved version stays active.
DROP TRIGGER knowledge_revision_assets_pending_insert;
CREATE TRIGGER `knowledge_revision_assets_pending_insert`
BEFORE INSERT ON `knowledge_revision_assets`
BEGIN
	SELECT CASE WHEN EXISTS (SELECT 1 FROM migration_control WHERE deactivated_at IS NULL)
		THEN RAISE(ABORT, 'migration write freeze active') END;
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM knowledge_items i JOIN knowledge_revisions r
		ON r.id = i.current_revision_id AND r.item_id = i.id
		WHERE i.id = NEW.item_id AND r.id = NEW.revision_id
		AND r.status = 'pending'
		AND (i.status = 'pending' OR (i.status = 'active' AND i.active_revision_id <> i.current_revision_id))
	) THEN RAISE(ABORT, 'knowledge revision is not pending') END;
	SELECT CASE WHEN NEW.upload_state = 'staged' AND (
		length(NEW.upload_token) = 0 OR EXISTS (
			SELECT 1 FROM knowledge_revision_assets
			WHERE revision_id = NEW.revision_id AND upload_state = 'ready'
		)
	) THEN RAISE(ABORT, 'knowledge upload is already finalized or has no token') END;
END;
