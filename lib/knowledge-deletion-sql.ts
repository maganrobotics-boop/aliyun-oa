// Legacy returned deletions and explicit owner withdrawals are retained for audit only.
export const DELETED_KNOWLEDGE_ITEM_SQL = `(
  (i.status = 'returned' AND i.revoked_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM knowledge_events AS deletion
    WHERE deletion.item_id = i.id AND deletion.action = 'revoked'
      AND deletion.note = '投稿人删除自己上传的资料'
      AND deletion.actor_member_id = i.submitter_member_id
      AND lower(deletion.actor_email) = lower(i.submitter_email))
)`;

