import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('betterstack', Path(__file__).parents[1] / 'scripts/betterstack-monitoring.py')
monitoring = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitoring)


class MonitoringTests(unittest.TestCase):
    def test_apply_updates_existing_monitors_and_creates_only_missing(self):
        configs = monitoring.configured_monitors()
        calls = []

        def api(path, method='GET', body=None):
            calls.append((path, method, body))
            if method == 'GET':
                return {'data': [{'id': '1', 'attributes': {'url': configs[0]['url']}}]}
            return {}

        with patch.dict(os.environ, {'BETTERSTACK_TEAM_NAME': ''}):
            monitoring.apply_monitors(api)
        self.assertEqual([row[1] for row in calls], ['GET', 'PATCH', 'POST'])
        for _, _, payload in calls[1:]:
            self.assertEqual(payload['confirmation_period'], 300)
            self.assertEqual(payload['recovery_period'], 180)
            self.assertTrue(payload['email'])
            self.assertIsNone(payload['policy_id'])
            self.assertFalse(any(payload[key] for key in ['sms', 'call', 'push', 'critical_alert', 'paused']))

    def test_digest_paginates_and_keeps_long_running_and_recently_resolved_incidents(self):
        configs = monitoring.configured_monitors()
        monitors = [{'id': str(i), 'attributes': {**config, 'status': 'up'}} for i, config in enumerate(configs)]
        incidents = [
            {'id': 'old-open', 'attributes': {'started_at': '2026-10-01T00:00:00Z', 'resolved_at': None, 'cause': '503'}},
            {'id': 'recently-closed', 'attributes': {'started_at': '2026-10-01T00:00:00Z', 'resolved_at': '2026-10-30T07:00:00Z', 'cause': 'timeout'}},
            {'id': 'old-closed', 'attributes': {'started_at': '2026-10-01T00:00:00Z', 'resolved_at': '2026-10-02T00:00:00Z'}},
        ]
        def api(path):
            if 'monitors?' in path:
                return {'data': monitors}
            if path == '/next':
                return {'data': incidents[1:]}
            return {'data': incidents[:1], 'pagination': {'next': '/next'}}

        text = monitoring.report(api, datetime(2026, 10, 30, 8, tzinfo=timezone.utc))
        self.assertIn('old-open', text)
        self.assertIn('recently-closed', text)
        self.assertNotIn('old-closed', text)

    def test_duplicate_monitor_aborts_instead_of_deleting_history(self):
        url = monitoring.configured_monitors()[0]['url']
        with self.assertRaises(ValueError):
            monitoring.apply_monitors(lambda _: {'data': [{'id': str(i), 'attributes': {'url': url}} for i in range(2)]})

    def test_email_uses_tls_and_configured_recipient(self):
        with patch.dict(os.environ, {
            'MONITORING_EMAIL_FROM': 'monitor@example.com', 'MONITORING_EMAIL_TO': 'owner@example.com',
            'MONITORING_SMTP_HOST': 'smtp.example.com', 'MONITORING_SMTP_PORT': '',
            'MONITORING_SMTP_USERNAME': 'monitor', 'MONITORING_SMTP_PASSWORD': 'test-only',
        }), patch.object(monitoring.smtplib, 'SMTP') as smtp, patch.object(monitoring.Path, 'read_text', return_value='report'):
            monitoring.send_report('/tmp/unused-report.txt')
        session = smtp.return_value.__enter__.return_value
        session.starttls.assert_called_once()
        session.send_message.assert_called_once()
        message = session.send_message.call_args.args[0]
        self.assertEqual(message['To'], 'owner@example.com')


if __name__ == '__main__':
    unittest.main()
