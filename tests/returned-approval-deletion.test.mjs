import assert from 'node:assert/strict';
import test from 'node:test';
import { returnedApprovalDeletionError } from '../lib/returned-approval-deletion.ts';
const item = { requesterEmail: 'owner@example.com', status: '已退回', updatedAt: '2026-10-01T08:00:00.000Z' };
test('only the requester can delete a returned approval from the reviewed version', () => {
  assert.equal(returnedApprovalDeletionError(item, ' OWNER@example.com ', item.updatedAt), null);
  assert.equal(returnedApprovalDeletionError(item, 'other@example.com', item.updatedAt).status, 404);
  assert.equal(returnedApprovalDeletionError(item, '', item.updatedAt).status, 404);
  assert.equal(returnedApprovalDeletionError(item, 'owner@example.com', 'stale').status, 409);
  assert.equal(returnedApprovalDeletionError(item, 'owner@example.com', undefined).status, 409);
  for (const status of ['草稿','待审核','审批中','已通过','已撤回','已作废','已归档']) assert.equal(returnedApprovalDeletionError({ ...item, status }, 'owner@example.com', item.updatedAt).status, 409);
});
