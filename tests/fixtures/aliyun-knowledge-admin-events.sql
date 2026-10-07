-- Mirror the existing Aliyun audit trigger, including administrator edits.
DROP TRIGGER IF EXISTS knowledge_events_action_guard;
CREATE TRIGGER knowledge_events_action_guard
BEFORE INSERT ON knowledge_events
WHEN NEW.action NOT IN (
  'submitted', 'resubmitted', 'approved', 'approved_internal', 'approved_public',
  'visibility_changed_internal', 'visibility_changed_public',
  'admin_edit_staged', 'admin_edited', 'returned', 'rejected', 'revoked'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid knowledge event action');
END;
