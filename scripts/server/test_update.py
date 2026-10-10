import unittest
from update import eligible_run, protected_path, select_release


class UpdatePolicyTests(unittest.TestCase):
    def run_record(self, **changes):
        return dict(id=10, run_attempt=1, head_sha='a' * 40, head_branch='main',
                    event='push', path='.github/workflows/ci.yml',
                    head_repository={'full_name': 'Pyp-3/Opsis'},
                    status='completed', conclusion='success') | changes

    def test_requires_exact_commit_main_push_and_expected_workflow(self):
        good = self.run_record()
        self.assertEqual(eligible_run([good], 'a' * 40), good)
        for changes in [dict(head_sha='b' * 40), dict(event='pull_request'),
                        dict(head_branch='other'), dict(path='.github/workflows/other.yml'),
                        dict(head_repository={'full_name': 'someone/Opsis'}),
                        dict(status='in_progress'), dict(conclusion='failure'),
                        dict(conclusion='cancelled'), dict(conclusion='skipped')]:
            with self.subTest(changes=changes):
                self.assertIsNone(eligible_run([self.run_record(**changes)], 'a' * 40))

    def test_newer_failed_or_pending_run_blocks_an_older_success(self):
        good = self.run_record()
        for status in ['in_progress', 'completed']:
            newer = self.run_record(id=11, status=status, conclusion='failure')
            self.assertIsNone(eligible_run([good, newer], 'a' * 40))

    def test_protects_dependency_inputs_workflows_and_installed_updater(self):
        for path in ['package.json', 'apps/new/package.json', 'pnpm-lock.yaml',
                     'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs',
                     'packages/engine/Cargo.lock', 'packages/engine/Cargo.toml',
                     '.github/workflows/ci.yml', 'scripts/server/update.py']:
            self.assertTrue(protected_path(path), path)
        self.assertFalse(protected_path('apps/web/src/App.tsx'))

    def test_rerun_can_reuse_its_original_successful_check_job_bundle(self):
        run = {'run_number': 42, 'run_attempt': 2}
        original = {'tag_name': 'v0.1.0-build.42.1.gaaaaaaaaaaaa', 'draft': False}
        unrelated = {'tag_name': 'v0.1.0-build.43.1.gaaaaaaaaaaaa', 'draft': False}
        self.assertEqual(select_release([unrelated, original], '0.1.0', run, 'a' * 40), original)
        self.assertIsNone(select_release([original | {'draft': True}], '0.1.0', run, 'a' * 40))
        self.assertIsNone(select_release([original], '0.1.0', run, 'b' * 40))


if __name__ == '__main__':
    unittest.main()
