#!/usr/bin/env python3
"""Tests for guard_git.py's command-target and branch resolution."""
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest.mock import patch

HOOKS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HOOKS_DIR))

import guard_git  # noqa: E402


def git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        check=True,
        capture_output=True,
        text=True,
    )


def init_repo(path: Path, branch: str) -> None:
    subprocess.run(
        ["git", "init", "-q", "-b", branch, str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    git(path, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit",
        "-q", "--allow-empty", "-m", "initial")


class ResolveTargetDirTest(unittest.TestCase):
    def test_input_cwd_beats_project_dir(self):
        # SPEC-1 / required test 22: omitted and None commands preserve every tier.
        with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": "/project"}, clear=False):
            self.assertEqual(
                guard_git.resolve_target_dir({"cwd": "/cwd"}),
                ("/cwd", "data.cwd"),
            )
            self.assertEqual(
                guard_git.resolve_target_dir({"cwd": "/cwd"}, None),
                ("/cwd", "data.cwd"),
            )

    def test_project_dir_and_process_cwd_remain_fallbacks(self):
        with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": "/project"}, clear=False):
            self.assertEqual(
                guard_git.resolve_target_dir({}),
                ("/project", "CLAUDE_PROJECT_DIR"),
            )
            self.assertEqual(
                guard_git.resolve_target_dir({}, None),
                ("/project", "CLAUDE_PROJECT_DIR"),
            )
        with patch.dict(os.environ, {}, clear=True), patch(
            "guard_git.os.getcwd", return_value="/process-cwd"
        ):
            self.assertEqual(
                guard_git.resolve_target_dir({}),
                ("/process-cwd", "process cwd"),
            )
            self.assertEqual(
                guard_git.resolve_target_dir({}, None),
                ("/process-cwd", "process cwd"),
            )

    def test_non_string_and_empty_commands_keep_existing_tiers(self):
        # Addendum A14: unusable commands retain every trusted-tier resolution.
        with patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": "/project"}, clear=False):
            for command in ("", [], 42):
                with self.subTest(command=command):
                    self.assertEqual(
                        guard_git.resolve_target_dir({"cwd": "/cwd"}, command),
                        ("/cwd", "data.cwd"),
                    )
                    self.assertEqual(
                        guard_git.resolve_target_dir({}, command),
                        ("/project", "CLAUDE_PROJECT_DIR"),
                    )
        with patch.dict(os.environ, {}, clear=True), patch(
            "guard_git.os.getcwd", return_value="/process-cwd"
        ):
            for command in ("", [], 42):
                with self.subTest(command=command):
                    self.assertEqual(
                        guard_git.resolve_target_dir({}, command),
                        ("/process-cwd", "process cwd"),
                    )


class EvaluateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.main = self.root / "main"
        self.worktree = self.root / "issue-58"
        self.malformed_worktree = self.root / "malformed"
        self.unrelated = self.root / "unrelated"
        self.worktree_symlink = self.root / "issue-58-symlink"
        self.plain_file = self.root / "not-a-directory"
        init_repo(self.main, "main")
        git(self.main, "worktree", "add", "-q", "-b", "issues/58", str(self.worktree))
        git(
            self.main,
            "worktree",
            "add",
            "-q",
            "-b",
            "not-an-issue-branch",
            str(self.malformed_worktree),
        )
        init_repo(self.unrelated, "issues/58")
        os.symlink(self.worktree, self.worktree_symlink)
        self.plain_file.touch()

    def tearDown(self):
        self._tmp.cleanup()

    def evaluate(self, command: str, cwd: Optional[Path] = None):
        with patch.dict(
            os.environ, {"CLAUDE_PROJECT_DIR": str(self.main)}, clear=False
        ):
            return guard_git.evaluate(command, {"cwd": str(cwd or self.main)})

    def test_main_checkout_commit_is_still_blocked(self):
        result = self.evaluate("git commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("Resolved directory", result[1])
        self.assertIn("data.cwd", result[1])
        self.assertIn("Observed branch: main", result[1])
        self.assertIn("Do not retry", result[1])

    def test_compound_branch_switch_and_commit_is_still_blocked(self):
        result = self.evaluate("git switch issues/58 && git commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("branch switching and commit/push", result[1])

    def test_non_commit_push_and_non_git_commands_still_pass_through(self):
        self.assertIsNone(self.evaluate("git status"))
        self.assertIsNone(self.evaluate("echo unchanged"))

    def test_explicit_registered_worktree_is_evaluated_against_that_worktree(self):
        # SPEC-7 / F7: a real, clean registered worktree still promotes.
        self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m message"))
        self.assertIsNone(
            self.evaluate(f"git -C {self.worktree} push -u origin issues/58")
        )

    def test_attached_c_option_evaluates_registered_worktree(self):
        # SPEC-2 / required test 3: attached global -C is a candidate.
        self.assertIsNone(self.evaluate(f"git -C{self.worktree} commit -m message"))

    def test_wrappers_fall_back_to_trusted_directory(self):
        # Addendum B / required test 4: wrappers are outside the promotion form.
        for command in (
            f"env FOO=1 git -C {self.worktree} commit -m message",
            f"sudo git -C {self.worktree} commit -m message",
            f"nice git -C {self.worktree} commit -m message",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def test_non_protected_invocations_do_not_affect_candidate_extraction(self):
        # Addendum A / required test 5: a second command prevents promotion.
        result = self.evaluate(
            f"git -C {self.worktree} status && "
            f"git -C {self.worktree} commit -m message"
        )
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_symlinked_registered_worktree_is_matched_by_realpath(self):
        # SPEC-3 / required test 6: a symlink resolves to the registered worktree.
        self.assertIsNone(
            self.evaluate(f"git -C {self.worktree_symlink} commit -m message")
        )

    def test_resolve_target_dir_returns_registered_worktree_tier(self):
        # SPEC-1 / required test 7: verified candidates take precedence over data.cwd.
        self.assertEqual(
            guard_git.resolve_target_dir(
                {"cwd": str(self.main)}, f"git -C {self.worktree} commit -m message"
            ),
            (os.path.realpath(self.worktree), "git -C (registered worktree)"),
        )

    def test_malformed_registered_worktree_reports_new_resolution_tier(self):
        # SPEC-5 / required test 8: malformed registered branch is blocked at its target.
        result = self.evaluate(f"git -C {self.malformed_worktree} commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("does not match issues/<N>", result[1])
        self.assertIn(os.path.realpath(self.malformed_worktree), result[1])
        self.assertIn("git -C (registered worktree)", result[1])

    def test_leading_cd_linked_worktree_falls_back_to_main_and_is_blocked(self):
        result = self.evaluate(f"cd {self.worktree} && git commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])

    def test_input_cwd_linked_worktree_is_allowed(self):
        self.assertIsNone(self.evaluate("git commit -m message", self.worktree))

    def test_commit_metadata_reuse_flag_does_not_override_main_directory(self):
        # `-C` after `commit` is that subcommand's reuse-message flag, not
        # Git's global directory option. It must therefore retain main's
        # branch protection.
        result = self.evaluate("git commit -C HEAD")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])

    def test_malformed_input_cwd_branch_is_blocked(self):
        invalid = self.root / "invalid"
        init_repo(invalid, "not-an-issue-branch")
        result = self.evaluate("git commit -m message", invalid)
        self.assertIsNotNone(result)
        self.assertIn("does not match issues/<N>", result[1])

    def test_git_timeout_fails_open(self):
        with patch(
            "guard_git.subprocess.run",
            side_effect=subprocess.TimeoutExpired("git", 5),
        ) as run:
            self.assertIsNone(self.evaluate("git commit -m message"))
        self.assertEqual(run.call_args.kwargs["timeout"], 5)

    def test_quoted_prompt_prose_is_not_a_git_invocation(self):
        self.assertIsNone(
            self.evaluate('codex exec "git commit should be reviewed"')
        )
        self.assertIsNone(self.evaluate("echo 'git commit'"))

    def test_quoted_git_binary_and_absolute_path_are_real_invocations(self):
        self.assertIsNotNone(self.evaluate('"git" commit -m x'))
        self.assertIsNotNone(self.evaluate("/usr/bin/git push"))

    def test_environment_prefixes_do_not_hide_git_commit(self):
        self.assertIsNotNone(self.evaluate("env X=1 git commit -m x"))
        self.assertIsNotNone(self.evaluate("X=1 git commit -m x"))
        self.assertIsNotNone(self.evaluate("env -i X=1 git commit -m x"))

    def test_common_shell_wrappers_do_not_hide_git_operations(self):
        for command in (
            "command git commit -m x",
            "sudo git commit -m x",
            "sudo -n git commit -m x",
            "command -p git commit -m x",
            "nice git commit -m x",
            "time git push",
            "time -p git push",
            "command env X=1 git commit -m x",
            "sudo env X=1 git commit -m x",
            "env X=1 command git commit -m x",
        ):
            with self.subTest(command=command):
                self.assertIsNotNone(self.evaluate(command))

    def test_path_qualified_prefixes_cannot_bypass_branch_enforcement(self):
        # Prefix recognition must follow executable basename semantics, just as
        # the Git executable recognizer does. Each of these previously reached
        # main as an unclassified non-Git command.
        for command in (
            "/usr/bin/env X=1 git commit -m x",
            "/usr/bin/sudo git commit -m x",
            "/usr/bin/time git push",
            '/bin/bash -lc "git commit -m x"',
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertEqual(result[0], 2)

    def test_prefixes_and_operator_runs_reset_command_position(self):
        # Prefix parsers can stop at a separator. That separator must return
        # classification to command position even when shlex groups it as a
        # punctuation run rather than a canonical shell operator token.
        for command in (
            "env ; git commit -m x",
            "true |& git commit -m x",
            "case x in y) ;; esac; git commit -m x",
            "X=1 ; /usr/bin/env git push",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertEqual(result[0], 2)

    def test_command_separators_and_git_global_options_are_lexed(self):
        for separator in (";", "&&", "||", "|", "&", "\n"):
            with self.subTest(separator=separator):
                self.assertIsNotNone(
                    self.evaluate(f"echo ready {separator} git -C /tmp commit -m x")
                )
        self.assertIsNotNone(self.evaluate("git --git-dir=/tmp commit -m x"))
        self.assertIsNotNone(self.evaluate("git -c core.editor=true commit -m x"))

    def test_exec_and_complex_shell_forms_cannot_hide_git_operations(self):
        for command in (
            "exec git commit -m x",
            "exec -a disguised-git git commit -m x",
            '/bin/sh -c "git commit -m x"',
            'bash -lc "git commit -m x"',
            '(git commit -m x)',
            'if git commit -m x; then :; fi',
            'while git commit -m x; do break; done',
        ):
            with self.subTest(command=command):
                self.assertIsNotNone(self.evaluate(command))

    def test_ambiguous_shell_evaluation_with_git_is_blocked_on_main(self):
        self.assertIsNotNone(self.evaluate("sh -c 'git commit -m x'"))
        self.assertIsNotNone(self.evaluate('echo "$(git commit -m x)"'))
        self.assertIsNotNone(self.evaluate("echo `git commit -m x`"))
        self.assertIsNotNone(self.evaluate("eval 'git commit -m x'"))
        self.assertIsNotNone(self.evaluate("git commit '"))

    def test_ambiguous_shell_evaluation_is_blocked_on_issue_branches_too(self):
        for command in (
            "sh -c 'git commit -m x'",
            "bash -xec 'git switch main && git commit -m x'",
            "git commit -m 'message $(date)'",
            "if git status; then echo git; fi",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command, self.worktree)
                self.assertIsNotNone(result)
                self.assertIn("too complex to statically classify", result[1])
                self.assertIn("simple, single-command form", result[1])

    def test_non_git_branch_name_text_is_not_an_operation(self):
        self.assertIsNone(self.evaluate("echo issues/6-fix-commit-msg"))

    def test_explicit_main_worktree_is_blocked_even_from_issue_cwd(self):
        # SPEC-7: registered main is resolved before branch policy is applied.
        result = self.evaluate(f"git -C {self.main} commit -m message", self.worktree)
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn(f"Resolved directory: {os.path.realpath(self.main)}", result[1])
        self.assertIn("source: git -C (registered worktree)", result[1])

    def test_relative_c_option_falls_back_to_main(self):
        # SPEC-2 / required test 9: relative candidates are rejected.
        result = self.evaluate("git -C ../issue-58 commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_unrelated_repository_c_option_falls_back_to_main(self):
        # SPEC-3 / required test 10: another repository is never trusted from command text.
        result = self.evaluate(f"git -C {self.unrelated} commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_nonexistent_c_option_falls_back_to_main(self):
        # SPEC-3 / required test 11: missing paths cannot verify as registered worktrees.
        result = self.evaluate(f"git -C {self.root / 'missing'} commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_file_c_option_falls_back_to_main(self):
        # SPEC-3 / required test 12: a plain file cannot verify as a worktree.
        result = self.evaluate(f"git -C {self.plain_file} commit -m message")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_different_protected_c_options_fall_back_to_main(self):
        # SPEC-2 / required test 13: protected invocations must agree on one -C value.
        result = self.evaluate(
            f"git -C {self.worktree} commit -m message && "
            f"git -C {self.main} push"
        )
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_missing_protected_c_option_falls_back_to_main(self):
        # SPEC-2 / required test 14: every protected invocation needs exactly one -C.
        result = self.evaluate(f"git -C {self.worktree} commit -m message && git push")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_duplicate_global_c_options_fall_back_to_main(self):
        # SPEC-2 / required test 15: one protected invocation may carry only one -C.
        result = self.evaluate(
            f"git -C {self.worktree} -C {self.worktree} commit -m message"
        )
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_git_dir_and_work_tree_options_fall_back_to_main(self):
        # SPEC-4 / required test 16: --git-dir and --work-tree never become candidates.
        for command in (
            f"git --git-dir={self.worktree / '.git'} commit -m message",
            f"git --work-tree={self.worktree} commit -m message",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def test_global_options_other_than_c_do_not_promote_worktree(self):
        # Addendum A1/A2/A5: only one global -C option may promote a worktree.
        for command in (
            f"git -C {self.worktree} --git-dir={self.main / '.git'} commit -m m",
            f"git -C {self.worktree} --work-tree={self.main} commit -m m",
            f"git -C {self.worktree} -c core.worktree={self.main} commit -m m",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def test_git_repository_environment_does_not_promote_worktree(self):
        # Addendum A3/A4: GIT_* assignments reject command-target promotion.
        for command in (
            f"GIT_DIR={self.main / '.git'} git -C {self.worktree} commit -m m",
            f"GIT_WORK_TREE={self.main} git -C {self.worktree} commit -m m",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def test_shell_expansion_forms_do_not_promote_worktree(self):
        # Addendum A6/A7/A8: brace, parameter, and glob forms reject promotion.
        worktree_prefix = str(self.worktree)[:-1]
        for command in (
            f"git -C {self.worktree} -{{C{self.worktree},C{self.main}}} commit -m x",
            'git -C "$WT" commit -m x',
            f"git -C {worktree_prefix}* commit -m x",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def test_second_command_prevents_worktree_promotion(self):
        # Addendum A9/A10: every shell command separator rejects promotion.
        for command in (
            f"true && git -C {self.worktree} commit -m m",
            f"git -C {self.worktree} symbolic-ref HEAD refs/heads/main && "
            f"git -C {self.worktree} commit -m m",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def test_malformed_porcelain_listing_does_not_promote_worktree(self):
        # Addendum A11: every porcelain line must validate before matching.
        real_run = subprocess.run

        def malformed_porcelain(argv, *args, **kwargs):
            if "worktree" in argv:
                return subprocess.CompletedProcess(
                    argv, 0, f"worktree {self.worktree}\nworktree\n", ""
                )
            return real_run(argv, *args, **kwargs)

        with patch("guard_git.subprocess.run", side_effect=malformed_porcelain):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_c_quoted_porcelain_listing_does_not_promote_worktree(self):
        # Addendum A12: C-quoted worktree paths are unparseable.
        real_run = subprocess.run

        def c_quoted_porcelain(argv, *args, **kwargs):
            if "worktree" in argv:
                return subprocess.CompletedProcess(
                    argv, 0, f'worktree "{self.worktree}\\t"\n', ""
                )
            return real_run(argv, *args, **kwargs)

        with patch("guard_git.subprocess.run", side_effect=c_quoted_porcelain):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_compound_switch_keeps_precedence_over_registered_candidate(self):
        # SPEC-5 / required test 19: compound switch policy is unchanged.
        result = self.evaluate(
            f"git -C {self.worktree} switch main && "
            f"git -C {self.worktree} commit -m message"
        )
        self.assertIsNotNone(result)
        self.assertIn("branch switching and commit/push", result[1])

    def test_worktree_list_probe_failures_fall_back_to_main(self):
        # SPEC-3 / required test 20: worktree-list failures fail closed to data.cwd.
        real_run = subprocess.run

        def timeout_for_worktree(argv, *args, **kwargs):
            if "worktree" in argv:
                raise subprocess.TimeoutExpired(argv, 5)
            return real_run(argv, *args, **kwargs)

        def nonzero_for_worktree(argv, *args, **kwargs):
            if "worktree" in argv:
                return subprocess.CompletedProcess(argv, 128, "", "failure")
            return real_run(argv, *args, **kwargs)

        def unmatched_for_worktree(argv, *args, **kwargs):
            if "worktree" in argv:
                return subprocess.CompletedProcess(
                    argv, 0, f"worktree {self.unrelated}\n", ""
                )
            return real_run(argv, *args, **kwargs)

        for side_effect in (
            timeout_for_worktree,
            nonzero_for_worktree,
            unmatched_for_worktree,
        ):
            with self.subTest(side_effect=side_effect.__name__), patch(
                "guard_git.subprocess.run", side_effect=side_effect
            ):
                result = self.evaluate(f"git -C {self.worktree} commit -m message")
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("data.cwd", result[1])

    def test_ambiguous_command_does_not_use_registered_candidate(self):
        # SPEC-4 / required test 21: ambiguous syntax retains the data.cwd tier.
        result = self.evaluate(f'git -C {self.worktree} commit -m "$(date)"')
        self.assertIsNotNone(result)
        self.assertIn("too complex to statically classify", result[1])
        self.assertIn(f"Resolved directory: {self.main}", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_escaped_git_environment_name_falls_back_to_trusted_directory(self):
        # Addendum B B1: escaped repository environment names cannot promote.
        result = self.evaluate(
            f"env GIT_D\\IR={self.main / '.git'} git -C {self.worktree} commit -m m"
        )
        self.assertIsNotNone(result)
        self.assertIn("source: data.cwd", result[1])

    def test_env_split_string_and_second_command_fall_back(self):
        # Addendum B B2: env -S and a second command cannot promote.
        result = self.evaluate(
            f'env -S "git -C {self.worktree} symbolic-ref HEAD refs/heads/main" '
            f"&& git -C {self.worktree} commit -m x"
        )
        self.assertIsNotNone(result)
        self.assertIn("source: data.cwd", result[1])

    def test_quoted_separator_argument_falls_back(self):
        # Addendum B B3: quoted separator arguments cannot promote.
        result = self.evaluate(f'git -C {self.worktree} commit -m ";" --allow-empty')
        self.assertIsNotNone(result)
        self.assertIn("source: data.cwd", result[1])

    def test_quoted_multiword_message_falls_back(self):
        # Addendum B B4: quoted multiword messages cannot promote.
        result = self.evaluate(f'git -C {self.worktree} commit -m "two words"')
        self.assertIsNotNone(result)
        self.assertIn("source: data.cwd", result[1])

    def test_single_word_message_promotes(self):
        # Addendum B B5: a plain single-word message promotes.
        self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m single"))

    def test_absolute_message_file_promotes(self):
        # Addendum B B6: a plain absolute -F argument promotes.
        self.assertIsNone(
            self.evaluate(f"git -C {self.worktree} commit -F /abs/msg.txt --allow-empty")
        )

    def test_plain_push_forms_promote(self):
        # Addendum B B7: plain push arguments promote.
        for command in (
            f"git -C {self.worktree} push -u origin issues/58",
            f"git -C {self.worktree} push --force-with-lease origin HEAD",
        ):
            with self.subTest(command=command):
                self.assertIsNone(self.evaluate(command))

    def test_other_global_options_fall_back(self):
        # Addendum B B8: global options beyond -C cannot promote.
        for command in (
            f"git -C {self.worktree} --namespace=x commit -m m",
            f"git -C {self.worktree} --exec-path=/x commit -m m",
            f"git -C {self.worktree} --git-dir {self.main / '.git'} commit -m m",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("source: data.cwd", result[1])

    def test_command_separators_fall_back(self):
        # Addendum B B9: separators between Git commands cannot promote.
        for separator in (";", "|", "\n"):
            with self.subTest(separator=separator):
                result = self.evaluate(
                    f"git -C {self.worktree} commit -m m {separator} "
                    f"git -C {self.worktree} push"
                )
                self.assertIsNotNone(result)
                self.assertIn("source: data.cwd", result[1])

    def test_other_transparent_wrappers_fall_back(self):
        # Addendum B B10: transparent classification wrappers cannot promote.
        for command in (
            f"command git -C {self.worktree} commit -m m",
            f"time git -C {self.worktree} commit -m m",
            f"nohup git -C {self.worktree} commit -m m",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("source: data.cwd", result[1])

    def test_leading_assignment_falls_back(self):
        # Addendum B B11: leading assignments cannot promote.
        result = self.evaluate(f"PATH=/x git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("source: data.cwd", result[1])

    def test_whitespace_wrapped_plain_form_promotes(self):
        # Addendum B B12: leading and trailing whitespace remain valid.
        self.assertIsNone(
            self.evaluate(f" \tgit\t-C{self.worktree}\tcommit\t-m\tm\t ")
        )

    def test_comments_and_quoted_arguments_fall_back(self):
        # Addendum B B13: comments and quoted arguments cannot promote.
        for command in (
            f"git -C {self.worktree} commit -m m # comment",
            f"git -C {self.worktree} commit -m 'm'",
        ):
            with self.subTest(command=command):
                result = self.evaluate(command)
                self.assertIsNotNone(result)
                self.assertIn("source: data.cwd", result[1])

    def test_promotion_re_rejects_each_excluded_character(self):
        # D10: paths reject every excluded character; arguments exclude
        # space/tab because they are valid separators between plain arguments.
        for character in " \t\n\r'\"`\\$;|&<>(){}*?[]#~!":
            with self.subTest(character=repr(character), location="path"):
                self.assertIsNone(
                    guard_git.PROMOTION_RE.fullmatch(
                        f"git -C {self.worktree}{character}suffix commit -m x"
                    )
                )
        for character in "\n\r'\"`\\$;|&<>(){}*?[]#~!":
            with self.subTest(character=repr(character), location="argument"):
                self.assertIsNone(
                    guard_git.PROMOTION_RE.fullmatch(
                        f"git -C {self.worktree} commit -m x{character}suffix"
                    )
                )

    def test_inherited_git_work_tree_blocks_at_trusted_directory(self):
        # D2 supersedes C1: inherited routing state is explicitly blocked.
        with patch.dict(os.environ, {"GIT_WORK_TREE": str(self.main)}, clear=False):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_inherited_git_dir_blocks_at_trusted_directory(self):
        # D1 supersedes C2: inherited routing state is explicitly blocked.
        with patch.dict(os.environ, {"GIT_DIR": str(self.main / ".git")}, clear=False):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_inherited_git_config_count_blocks_at_trusted_directory(self):
        # C3 / SPEC-3e: in-process config count remains routing state.
        with patch.dict(os.environ, {"GIT_CONFIG_COUNT": "1"}, clear=False):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])
        self.assertIn("source: data.cwd", result[1])

    def test_benign_inherited_git_editor_still_promotes(self):
        # C4: GIT_EDITOR alone does not refuse promotion.
        with patch.dict(os.environ, {"GIT_EDITOR": "true"}, clear=False):
            self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m m"))

    def test_git_probes_receive_sanitised_environment(self):
        # D9 / SPEC-3e: routing variables are removed, but config-file locations stay.
        with patch.dict(
            os.environ,
            {
                "GIT_WORK_TREE": str(self.main),
                "GIT_EDITOR": "true",
                "GIT_CONFIG_GLOBAL": str(self.root / "global-config"),
            },
            clear=False,
        ):
            environment = guard_git._probe_env()
        self.assertNotIn("GIT_WORK_TREE", environment)
        self.assertEqual(environment["GIT_EDITOR"], "true")
        self.assertEqual(
            environment["GIT_CONFIG_GLOBAL"], str(self.root / "global-config")
        )

    def test_config_file_location_environment_allows_issue_worktree(self):
        # E1: config-file locations are not repository-routing environment.
        for name in ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"):
            with self.subTest(name=name), patch.dict(
                os.environ, {name: str(self.root / f"{name.lower()}-config")}, clear=False
            ):
                self.assertIsNone(self.evaluate("git commit -m m", self.worktree))
                self.assertIsNone(
                    self.evaluate(f"git -C {self.worktree} commit -m m")
                )

    def test_in_process_git_config_environment_blocks(self):
        # E2: only config injection variables, not config-file locations, route Git.
        for name in ("GIT_CONFIG_PARAMETERS", "GIT_CONFIG_KEY_0"):
            with self.subTest(name=name), patch.dict(
                os.environ, {name: "value"}, clear=False
            ):
                result = self.evaluate("git commit -m m", self.worktree)
                self.assertIsNotNone(result)
                self.assertIn("repository-routing GIT_* environment", result[1])
                self.assertIn(name, result[1])

    def test_inherited_git_dir_blocks_from_issue_worktree(self):
        # D1: routing environment blocks even when the trusted directory is valid.
        with patch.dict(os.environ, {"GIT_DIR": str(self.main / ".git")}, clear=False):
            result = self.evaluate(
                f"git -C {self.worktree} commit -m m", self.worktree
            )
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])
        self.assertIn("GIT_DIR", result[1])

    def test_inherited_git_work_tree_blocks_from_main(self):
        # D2: routing environment blocks before candidate promotion.
        with patch.dict(os.environ, {"GIT_WORK_TREE": str(self.main)}, clear=False):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])
        self.assertIn("GIT_WORK_TREE", result[1])

    def test_inherited_routing_environment_blocks_plain_commit_on_issue_worktree(self):
        # D3: a plain protected command is blocked too.
        with patch.dict(os.environ, {"GIT_DIR": str(self.main / ".git")}, clear=False):
            result = self.evaluate("git commit -m m", self.worktree)
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])

    def test_benign_git_editor_remains_unaffected_by_environment_block(self):
        # D4: non-routing Git environment does not block either valid form.
        with patch.dict(os.environ, {"GIT_EDITOR": "true"}, clear=False):
            self.assertIsNone(self.evaluate("git commit -m m", self.worktree))
            self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m m"))

    def test_ambiguous_command_keeps_precedence_over_inherited_environment_block(self):
        # D5: ambiguity remains the reported reason.
        with patch.dict(os.environ, {"GIT_DIR": str(self.main / ".git")}, clear=False):
            result = self.evaluate('git commit -m "$(date)"', self.worktree)
        self.assertIsNotNone(result)
        self.assertIn("too complex to statically classify", result[1])
        self.assertNotIn("repository-routing GIT_* environment", result[1])

    def test_non_protected_commands_ignore_inherited_routing_environment(self):
        # D6: only classified commit and push commands are blocked.
        with patch.dict(os.environ, {"GIT_DIR": str(self.main / ".git")}, clear=False):
            self.assertIsNone(self.evaluate("echo unchanged", self.worktree))
            self.assertIsNone(self.evaluate("git status", self.worktree))

    def test_candidate_with_core_worktree_redirect_is_identity_blocked_from_main(self):
        # D7 flipped by SPEC-3f: a registered candidate cannot be demoted.
        git(self.worktree, "config", "core.worktree", str(self.main))
        real_run = subprocess.run

        def redirected_toplevel(argv, *args, **kwargs):
            if "--show-toplevel" in argv:
                return subprocess.CompletedProcess(argv, 0, f"{self.main}\n", "")
            return real_run(argv, *args, **kwargs)

        with patch("guard_git.subprocess.run", side_effect=redirected_toplevel):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("failed identity verification", result[1])
        self.assertIn("toplevel", result[1])
        self.assertIn("source: git -C (registered worktree)", result[1])

    def test_candidate_toplevel_probe_failure_is_identity_blocked(self):
        # D8 flipped by SPEC-3f: an identity probe failure blocks.
        real_run = subprocess.run

        def fail_toplevel(argv, *args, **kwargs):
            if "--show-toplevel" in argv:
                return subprocess.CompletedProcess(argv, 128, "", "failure")
            return real_run(argv, *args, **kwargs)

        with patch("guard_git.subprocess.run", side_effect=fail_toplevel):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("failed identity verification", result[1])
        self.assertIn("probe", result[1])
        self.assertIn("source: git -C (registered worktree)", result[1])

    def test_redirected_gitfile_is_identity_blocked_by_common_dir(self):
        # F1: a registered path whose .git points at another repository blocks.
        other = self.root / "other"
        init_repo(other, "main")
        git(other, "config", "core.worktree", str(self.worktree))
        (self.worktree / ".git").write_text(f"gitdir: {other / '.git'}\n")
        result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("failed identity verification", result[1])
        self.assertIn("common-dir", result[1])
        self.assertIn("source: git -C (registered worktree)", result[1])

    def test_core_worktree_redirect_is_identity_blocked_from_same_worktree(self):
        # F2: trusted cwd does not turn a registered identity failure into a pass.
        git(self.main, "config", "extensions.worktreeConfig", "true")
        git(
            self.worktree, "config", "--worktree", "core.worktree", str(self.main)
        )
        result = self.evaluate(f"git -C {self.worktree} commit -m m", self.worktree)
        self.assertIsNotNone(result)
        self.assertIn("failed identity verification", result[1])
        self.assertIn("toplevel", result[1])

    def test_common_dir_probe_failure_is_identity_blocked(self):
        # F3: every candidate identity probe is mandatory.
        real_run = subprocess.run

        def fail_common_dir(argv, *args, **kwargs):
            if "--git-common-dir" in argv:
                return subprocess.CompletedProcess(argv, 128, "", "failure")
            return real_run(argv, *args, **kwargs)

        with patch("guard_git.subprocess.run", side_effect=fail_common_dir):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("failed identity verification", result[1])
        self.assertIn("probe", result[1])

    def test_git_config_nosystem_is_retained_and_does_not_block(self):
        # F4 / SPEC-3e: config-file-location controls remain in probe env.
        with patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1"}, clear=False):
            self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m m"))
            self.assertEqual(guard_git._probe_env()["GIT_CONFIG_NOSYSTEM"], "1")

    def test_git_config_value_environment_blocks(self):
        # F5: in-process config values remain repository-routing environment.
        with patch.dict(os.environ, {"GIT_CONFIG_VALUE_0": "x"}, clear=False):
            result = self.evaluate(f"git -C {self.worktree} commit -m m")
        self.assertIsNotNone(result)
        self.assertIn("repository-routing GIT_* environment", result[1])
        self.assertIn("GIT_CONFIG_VALUE_0", result[1])

    def test_valid_bare_and_prunable_porcelain_forms_promote(self):
        # D11: valid optional porcelain records do not reject the listing.
        real_run = subprocess.run

        def valid_porcelain(argv, *args, **kwargs):
            if "worktree" in argv:
                return subprocess.CompletedProcess(
                    argv, 0, f"worktree {self.worktree}\nbare\nprunable old\n", ""
                )
            return real_run(argv, *args, **kwargs)

        with patch("guard_git.subprocess.run", side_effect=valid_porcelain) as run:
            self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m m"))
        self.assertTrue(any("--show-toplevel" in call.args[0] for call in run.call_args_list))

    def test_each_repository_routing_environment_name_blocks(self):
        # D12: every configured routing name triggers the environment block.
        for name in guard_git.REPOSITORY_ENV_NAMES:
            with self.subTest(name=name), patch.dict(os.environ, {name: "value"}, clear=False):
                result = self.evaluate("git commit -m m", self.worktree)
                self.assertIsNotNone(result)
                self.assertIn("repository-routing GIT_* environment", result[1])
                self.assertIn(name, result[1])

    def test_unicode_whitespace_does_not_match_promotion_form(self):
        # C6: all Unicode whitespace is excluded from path and arguments.
        for character in ("\v", "\f", "\N{NO-BREAK SPACE}", "\N{EM SPACE}"):
            with self.subTest(character=repr(character), location="path"):
                self.assertIsNone(
                    guard_git.PROMOTION_RE.fullmatch(
                        f"git -C {self.worktree}{character}suffix commit -m m"
                    )
                )
            with self.subTest(character=repr(character), location="argument"):
                self.assertIsNone(
                    guard_git.PROMOTION_RE.fullmatch(
                        f"git -C {self.worktree} commit -m m{character}suffix"
                    )
                )

    def test_locked_and_detached_worktrees_keep_porcelain_valid(self):
        # C7: normal locked and detached porcelain forms remain valid.
        detached = self.root / "detached"
        git(self.main, "worktree", "lock", "--reason", "issue-58 owner=x", str(self.worktree))
        git(self.main, "worktree", "add", "--detach", "-q", str(detached))
        self.assertIsNone(self.evaluate(f"git -C {self.worktree} commit -m m"))
        self.assertIsNone(self.evaluate(f"git -C {self.worktree} push -u origin issues/58"))

    def test_invalid_porcelain_forms_fall_back_to_trusted_directory(self):
        # C8: invalid HEAD, branch, and unknown porcelain lines refuse promotion.
        real_run = subprocess.run
        for extra_line in ("HEAD zz", "branch ", "foo bar"):
            def invalid_porcelain(argv, *args, _extra_line=extra_line, **kwargs):
                if "worktree" in argv:
                    return subprocess.CompletedProcess(
                        argv, 0, f"worktree {self.worktree}\n{_extra_line}\n", ""
                    )
                return real_run(argv, *args, **kwargs)

            with self.subTest(extra_line=extra_line), patch(
                "guard_git.subprocess.run", side_effect=invalid_porcelain
            ):
                result = self.evaluate(f"git -C {self.worktree} commit -m m")
                self.assertIsNotNone(result)
                self.assertIn("commits/pushes on main", result[1])
                self.assertIn("source: data.cwd", result[1])

    def _assert_ambiguous(self, command, cwd=None):
        result = self.evaluate(command, cwd)
        self.assertIsNotNone(result)
        self.assertIn("too complex to statically classify", result[1])
        self.assertIn("simple, single-command form", result[1])

    def test_xargs_routed_git_commit_is_blocked(self):
        self._assert_ambiguous("xargs git commit -m x")

    def test_find_exec_routed_git_commit_is_blocked(self):
        for command in (
            "find . -exec git commit -m x ;",
            "find . -execdir git commit -m x ;",
        ):
            with self.subTest(command=command):
                self._assert_ambiguous(command)

    def test_timeout_routed_git_commit_is_blocked(self):
        self._assert_ambiguous("timeout 5 git commit -m x")

    def test_opaque_wrapper_chains_with_transparent_prefixes_are_blocked(self):
        for command in (
            "sudo find -exec git commit -m x ;",
            "env X=1 xargs git commit -m x",
        ):
            with self.subTest(command=command):
                self._assert_ambiguous(command)

    def test_opaque_wrappers_without_a_bare_git_token_pass_through(self):
        # "git" reaches _contains_git's raw substring check either way, but
        # shlex collapses each quoted phrase into one token containing a
        # space, which never equals the bare `git` executable token these
        # wrappers are scanned for.
        for command in (
            'xargs echo "git commit"',
            'find -name "git commit"',
        ):
            with self.subTest(command=command):
                self.assertIsNone(self.evaluate(command))

    def test_nohup_is_a_transparent_wrapper(self):
        # nohup must be classified as an ordinary commit (routed through the
        # normal branch check), not folded into the opaque-wrapper ambiguous
        # path -- its wrapped command's position is never in question.
        result = self.evaluate("nohup git commit -m x")
        self.assertIsNotNone(result)
        self.assertIn("commits/pushes on main", result[1])
        self.assertNotIn("too complex to statically classify", result[1])
        self.assertIsNone(self.evaluate("nohup git status"))

    def test_quoted_operator_lookalike_option_value_does_not_hide_routed_git(self):
        # A quoted ";" used as xargs' -I replacement string is, after shlex
        # strips quoting, indistinguishable in content from a real shell
        # operator. The scan must not let that stop it before reaching git.
        self._assert_ambiguous('xargs -I ";" -- git commit -m x')

    def test_chained_opaque_wrappers_are_blocked(self):
        self._assert_ambiguous("xargs timeout 5 git commit -m x")

    def test_opaque_wrapper_scan_does_not_stop_at_shell_operators(self):
        # The scan runs to the end of the token stream rather than stopping
        # at the next operator, so an opaque wrapper's own, unrelated
        # command followed by a real, separately-triggered git commit is
        # still caught -- checked on both main (where every classification
        # blocks, so the distinction would otherwise be invisible) and a
        # valid issue branch (where a `commit=True` classification would
        # instead pass, so this is where the trade-off is actually visible).
        command = "xargs echo hello && git commit -m x"
        self._assert_ambiguous(command)
        self._assert_ambiguous(command, self.worktree)

    def test_opaque_wrapper_filename_argument_is_blocked(self):
        # Accepted cost: the scan cannot distinguish a `git`-named search
        # target from a routed invocation without the rejected positional
        # re-lex, so a literal filename search is also blocked.
        self._assert_ambiguous("find . -name git")

    def test_opaque_wrapper_path_qualified_prefixes_cannot_bypass_detection(self):
        # Mirrors test_path_qualified_prefixes_cannot_bypass_branch_enforcement:
        # both the wrapper name and the routed git executable must be
        # recognized through a path prefix, not just a bare basename, since
        # OPAQUE_WRAPPER_COMMANDS membership and _is_git_executable both
        # normalize via _executable_basename.
        for command in (
            "/usr/bin/xargs git commit -m x",
            "xargs /usr/bin/git commit -m x",
        ):
            with self.subTest(command=command):
                self._assert_ambiguous(command)


class MainTest(unittest.TestCase):
    def test_registered_worktree_command_passes_through_main(self):
        # SPEC-5 / required test 24: main() wires command-aware resolution end to end.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "main"
            worktree = root / "issue-58"
            init_repo(main, "main")
            git(main, "worktree", "add", "-q", "-b", "issues/58", str(worktree))
            stderr = io.StringIO()
            payload = (
                '{"tool_input": {"command": "git -C '
                f'{worktree} commit -m m"}}, "cwd": "{main}"}}'
            )
            with patch("guard_git.sys.stdin", io.StringIO(payload)), patch(
                "guard_git.sys.stderr", stderr
            ):
                self.assertEqual(guard_git.main(), 0)
            self.assertEqual(stderr.getvalue(), "")

    def test_inherited_git_dir_blocks_registered_worktree_push(self):
        # F6: main() preserves the environment-refused block for pushes too.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = root / "main"
            worktree = root / "issue-58"
            init_repo(main, "main")
            git(main, "worktree", "add", "-q", "-b", "issues/58", str(worktree))
            stderr = io.StringIO()
            payload = (
                '{"tool_input": {"command": "git -C '
                f'{worktree} push -u origin issues/58"}}, "cwd": "{main}"}}'
            )
            with patch.dict(
                os.environ, {"GIT_DIR": str(main / ".git")}, clear=False
            ), patch("guard_git.sys.stdin", io.StringIO(payload)), patch(
                "guard_git.sys.stderr", stderr
            ):
                self.assertEqual(guard_git.main(), 2)
            self.assertIn("environment refused", stderr.getvalue())

    def test_non_object_stdin_fails_open(self):
        with patch("guard_git.sys.stdin", io.StringIO("[]")):
            self.assertEqual(guard_git.main(), 0)

    def test_non_object_tool_input_fails_open(self):
        with patch("guard_git.sys.stdin", io.StringIO('{"tool_input": []}')), patch(
            "guard_git.evaluate"
        ) as evaluate:
            self.assertEqual(guard_git.main(), 0)
        evaluate.assert_not_called()

    def test_non_string_command_fails_open(self):
        with patch(
            "guard_git.sys.stdin", io.StringIO('{"tool_input": {"command": []}}')
        ), patch("guard_git.evaluate") as evaluate:
            self.assertEqual(guard_git.main(), 0)
        evaluate.assert_not_called()

    def test_non_string_cwd_fails_open(self):
        with patch(
            "guard_git.sys.stdin",
            io.StringIO('{"tool_input": {"command": "git commit"}, "cwd": []}'),
        ), patch("guard_git.evaluate") as evaluate:
            self.assertEqual(guard_git.main(), 0)
        evaluate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
