import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
import cloud_activity as activity


class ActivityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.now = 2000000
        self.store = activity.ActivityStore(self.tmp.name, 'a' * 64, now=1000000)

    def test_exact_windows_accounts_guests_and_future_exclusion(self):
        for uid, age in [('today', 2), ('edge', 86400), ('three', 86401), ('week', 259201), ('old', 604801), ('future', -1)]:
            self.store.touch(uid, uid, '', self.now-age)
        self.store.touch(None, '', 'g1', self.now-2)
        result = self.store.dashboard({}, self.now)
        self.assertEqual(result['summary']['onlineCounts'], {
            '24h': {'accounts': 2, 'guests': 1}, '3d': {'accounts': 3, 'guests': 1}, '7d': {'accounts': 4, 'guests': 1}})
        self.assertEqual(len(result['records']), 3)

    def test_heartbeats_deduplicate_visits_and_survive_restart(self):
        self.store.touch('u1', 'alice', '', self.now-2000)
        self.store.touch('u1', 'alice', '', self.now-1990)
        restored = activity.ActivityStore(self.tmp.name, 'a'*64)
        restored.touch('u1', 'alice', '', self.now)
        result = restored.dashboard({}, self.now)
        self.assertEqual(result['records'][0]['visits'], 2)
        self.assertEqual(result['summary']['onlineCounts']['24h']['accounts'], 1)
        self.assertEqual(result['trackingStartedAt'], 1000000000)

    def test_guests_distinct_from_accounts_and_no_raw_identifiers(self):
        self.store.touch(None, '', 'browser1', self.now-2)
        self.store.touch(None, '', 'browser1', self.now-1)
        self.store.touch('private-id', 'alice', 'browser1', self.now)
        result = self.store.dashboard({}, self.now)
        self.assertEqual(result['summary']['onlineCounts']['24h'], {'accounts': 1, 'guests': 1})
        self.assertNotIn('private-id', str(result))
        self.assertNotIn('browser1', str(result))

    def test_filters_pagination_and_search_literal(self):
        for n in range(25): self.store.touch(str(n), 'user%02d' % n, '', self.now-n)
        page = self.store.dashboard({'page': ['2']}, self.now)
        self.assertEqual(len(page['records']), 5)
        self.assertEqual(page['pagination']['total'], 25)
        self.assertEqual(self.store.dashboard({'q': ['%']}, self.now)['pagination']['total'], 0)
        self.assertEqual(self.store.dashboard({'kind': ['guest']}, self.now)['records'], [])
        self.assertEqual(self.store.dashboard({'q': ['USER01']}, self.now)['pagination']['total'], 1)

    def test_bad_filters(self):
        for params in [{'window': ['all']}, {'window': ['24h', '3d']}, {'token': ['x']}, {'page': ['-1']}, {'sort': ['seen;drop']}, {'q': ['x'*101]}]:
            with self.assertRaises(ValueError): self.store.dashboard(params, self.now)

    def test_service_auth_and_cross_origin_heartbeat(self):
        activity.STORE = self.store
        responses = []
        handler = SimpleNamespace(path='/v1/oa-activity', headers={}, respond=lambda *v: responses.append(v))
        activity.handle_get(handler)
        self.assertEqual(responses[-1][0], 401)
        handler.headers = {'Authorization': 'Bearer ' + 'a'*64}
        activity.handle_get(handler)
        self.assertEqual(responses[-1][0], 200)
        handler.path = '/v1/activity'
        handler.headers = {'Origin': 'https://wrong.invalid'}
        handler.valid_origin = lambda: True
        handler.public_origin = 'https://cloud.omindos.cn'
        activity.handle_post(handler)
        self.assertEqual(responses[-1][0], 403)

    def test_failure_does_not_interrupt_workspace(self):
        handler = SimpleNamespace(identity=lambda: 1/0)
        with self.assertLogs(activity.LOG, level='ERROR'):
            activity.record_safely(handler)


if __name__ == '__main__': unittest.main()
