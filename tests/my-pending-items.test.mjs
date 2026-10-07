import test from 'node:test';
import assert from 'node:assert/strict';
import { myReturnedApprovals, myPendingWork } from '../lib/my-pending-items.ts';

test('returned requests belong only to the applicant; terminal and unrelated requests disappear', () => {
  const items = [
    { id: 'mine', status: '已退回', requesterEmail: ' Member@Example.com ' },
    { id: 'other', status: '已退回', requesterEmail: 'other@example.com' },
    ...['草稿', '待审核', '已归档', '已撤回', '已作废'].map(status => ({ id: status, status, requesterEmail: 'member@example.com' })),
  ];
  assert.deepEqual(myReturnedApprovals(items, 'member@example.com').map(x => x.id), ['mine']);
  assert.deepEqual(myReturnedApprovals(items, ''), []);
});
test('personal actions, dispute tasks and milestones stay scoped while reviewers receive submitted evidence', () => {
  const make = (id, kind, status, assigneeEmail, milestone) => ({ id, kind, status, assigneeEmail, milestone });
  const items = [
    make('bill', 'task', 'open', 'MEMBER@example.com'),
    make('dispute-other', 'task', 'open', 'other@example.com'),
    make('done', 'task', 'done', 'member@example.com'),
    make('cancelled', 'risk', 'cancelled', 'member@example.com'),
    make('own-milestone', 'milestone', 'open', 'member@example.com'),
    make('await-evidence', 'milestone', 'open', 'other@example.com'),
    make('review', 'milestone', 'in_progress', 'other@example.com', { evidence: 'test log' }),
    make('accepted', 'milestone', 'done', 'member@example.com', { acceptedAt: '2026-10-07', evidence: 'log' }),
    make('cancelled-milestone', 'milestone', 'cancelled', 'member@example.com', { evidence: 'log' }),
    make('legacy-unverified', 'milestone', 'done', 'other@example.com'),
  ];
  const member = myPendingWork(items, ' member@example.com ', false);
  assert.deepEqual(member.tasks.map(x => x.id), ['bill']);
  assert.deepEqual(member.milestones.map(x => x.id), ['own-milestone']);
  assert.deepEqual(myPendingWork(items, 'reviewer@example.com', true).milestones.map(x => x.id), ['review', 'legacy-unverified']);
  assert.deepEqual(myPendingWork(items, '', true), { tasks: [], milestones: [] });
});
