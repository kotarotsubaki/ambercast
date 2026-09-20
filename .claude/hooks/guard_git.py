#!/usr/bin/env python3
"""PreToolUse hook (Bash): enforce the branch discipline of the /implement flow.

Blocks (exit 2):
- `git commit` / `git push` while the repository is on `main`
- `git commit` on any branch not named `issues/<N>` or `issues/<N>-<slug>`

Branch grammar: ASCII digits, slug words are lowercase alphanumerics joined
by single hyphens. Accepted: issues/12, issues/12-schema, issues/12-fix-login.
Rejected: issues/12-, issues/12--a, issues/12-A, unicode digits.

Everything else passes through (exit 0). Runs outside a work tree -> no-op.

Directory resolution starts with the first available trusted execution-context
value (`data["cwd"]`, then `CLAUDE_PROJECT_DIR`, then the hook process's own
cwd). An explicit worktree supersedes that tier only when the entire raw command
has this grammar: optional leading spaces/tabs; `git`; one or more spaces/tabs;
`-C`; zero or more spaces/tabs (so attached `-C/path` is allowed); an absolute
plain path; one or more spaces/tabs; `commit` or `push`; zero or more plain
arguments separated by one or more spaces/tabs; optional trailing spaces/tabs;
and nothing else. Plain characters contain no whitespace of any kind and none
of `'`, `"`, backticks, `\\`, `$`, `;`, `|`, `&`, `<`, `>`, `(`, `)`, `{`, `}`,
`*`, `?`, `[`, `]`, `#`, `~`, or `!`. For example, `git -C /worktree commit -F
/absolute/message.txt` and `git -C /worktree push -u origin issues/58` qualify.
For a non-ambiguous commit or push, inherited repository-routing `GIT_*`
environment blocks the operation and reports the trusted tier with an
environment-refused branch. There are three kinds of Git probe: a trusted
repository porcelain listing, candidate identity probes, and the branch probe.
The candidate is used only after `git -C <trusted dir> worktree list
--porcelain` proves that its realpath is a registered worktree of the trusted
repository. Its identity probes then require its `--show-toplevel` result to be
that realpath and its `--git-common-dir` to match the trusted directory's common
dir. A registered candidate is promoted or blocked, never demoted to the
trusted tier. The registered main worktree is included deliberately, so a
command explicitly aimed at main remains blocked by the normal branch check.
Probe environments remove repository-routing variables but retain
`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, and `GIT_CONFIG_NOSYSTEM`.

Any deviation from that promotion form falls back to the trusted tier (and,
when `data.cwd` is present, reports `source: data.cwd`). Command text is not
trusted for any other directory selection: `--git-dir`, `--work-tree`, `GIT_*`,
shell expansion, wrappers, quoting, and a second command do not promote. `cd`
keeps the remaining asymmetry: it changes the shell's eventual working directory
but is not a verified Git worktree target, so the hook continues to evaluate the
trusted execution-context tier.

Every block reports the directory actually evaluated (the trusted tier or the
promoted candidate), its source tier, and either the observed branch or an
explicit `unavailable (...)` refusal state, so the affected teammate can hand
off a single verified report instead of retrying. Command classification is
separate from this resolution: a command-position lexer identifies actual Git
operations, while quoted prose remains data rather than an invocation. A
Git-bearing command whose shell grammar is too complex for that deliberately
small lexer is blocked on every branch; guessing would make branch protection
dependent on syntax the hook cannot reliably model.

Opaque vs. transparent wrappers: `env`, `sudo`, `nice`, `time`, `command`,
`exec`, and `nohup` are transparent -- their own leading options are skipped
so the lexer can re-examine whatever command they hand off to (`env` via
_skip_env; the rest via WRAPPER_COMMANDS/_skip_wrapper). `xargs`, `find`,
and `timeout` are opaque -- their wrapped command's exact position depends
on option grammar this lexer does not model (xargs' -I/-L option forms,
find's -exec/-execdir predicate syntax, timeout's leading DURATION), so
instead of locating it precisely, any bare `git` token appearing anywhere
in their remaining arguments is treated as "might route to git" and blocked
via the same too-complex/ambiguous path used for eval/`$(...)`/`sh -c`
(OPAQUE_WRAPPER_COMMANDS, _opaque_wrapper_may_route_git). This scan runs to
the end of the token stream rather than stopping at the next shell
operator, because a quoted operator-only string used as an option value
(e.g. xargs' `-I ";"`) is indistinguishable from a real one once shlex has
stripped quoting -- stopping early would let that ambiguity silently
defeat detection. The accepted cost of not stopping: an opaque wrapper's
own, unrelated command followed by a real, separately-triggered `git
commit` later in the same shell command is also blocked, even on a branch
where the commit alone would be allowed. A second accepted cost, from not
locating the wrapped command precisely: `git` appearing as a plain,
non-invocation argument (e.g. `find . -name git`, matching a file literally
named `git`) is also blocked. Both trade detection precision for closing a
real bypass, consistent with this guard's bias toward over-blocking over
silently missing an invocation.

Residual bypasses that remain out of scope even with opaque-wrapper detection:
shell functions and aliases that rename or wrap `git`, string-concatenation
obfuscation of the literal `git` (e.g. `g""it`, `${x}git`), and targets that
are not registered worktrees of the trusted repository. This hook is a
best-effort lexer, not a security boundary: the actual enforcement is GitHub
branch protection (pull request required, conversations resolved, force-push
disabled). An external process can also re-point a symlink or HEAD after this
guard verifies it and before Git executes; this residual race is not closed by
the best-effort lexer.

A party that can already rewrite this worktree's `.git` file or config can also
edit any hook, so identity verification is a consistency check, not a security
boundary — GitHub branch protection is the enforcement.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys


ASSIGNMENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*", re.S)
PROMOTION_RE = re.compile(
    r"[ \t]*git[ \t]+-C[ \t]*(?P<candidate>/[^\s'\"`\\$;|&<>(){}*?\[\]#~!]*)"
    r"[ \t]+(?:commit|push)(?:[ \t]+[^\s'\"`\\$;|&<>(){}*?\[\]#~!]+)*[ \t]*\Z"
)
REPOSITORY_ENV_NAMES = {
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
    "GIT_CEILING_DIRECTORIES",
}
STRUCTURAL_SHELL_TOKENS = {
    "(", ")", "{", "}", "if", "then", "elif", "else", "fi", "while",
    "for", "until", "case", "do", "done", "esac", "select", "function",
}
GIT_OPTIONS_WITH_VALUE = {
    "-c", "-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix",
    "--config-env", "--exec-path",
}
ENV_OPTIONS_WITH_VALUE = {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}
WRAPPER_COMMANDS = {"command", "exec", "sudo", "nice", "time", "nohup"}
WRAPPER_OPTIONS_WITH_VALUE = {
    "exec": {"-a"},
    "sudo": {
        "-u", "-g", "-h", "-r", "-t", "-C", "-R", "-T", "--user",
        "--group", "--host", "--prompt", "--role", "--type", "--close-from",
        "--chroot", "--chdir",
    },
    "nice": {"-n", "--adjustment"},
    # nohup has no entry here because none of its options consume a value in
    # any common implementation (GNU coreutils recognizes only --help and
    # --version, neither of which takes one; BSD/macOS nohup takes no options
    # at all), so _skip_wrapper's default empty set already covers it.
}
# Wrappers whose own argument grammar this lexer does not model -- see the
# module docstring's "Opaque vs. transparent wrappers" section for why these
# are blocked outright via _opaque_wrapper_may_route_git rather than re-lexed
# like WRAPPER_COMMANDS.
OPAQUE_WRAPPER_COMMANDS = {"xargs", "find", "timeout"}


class RegisteredWorktreeRefused(Exception):
    """A listed worktree failed mandatory identity verification."""

    def __init__(self, reason, path):
        super().__init__(reason, path)
        self.reason = reason
        self.path = path


# The resolver returns both the chosen path and a stable source label. The
# label is diagnostic only; a command target can supersede the trusted tier
# only after _explicit_worktree_dir verifies it through that tier's repository.
def resolve_target_dir(data: dict, command=None) -> tuple[str, str]:
    """Return the trusted hook directory or a verified explicit worktree."""
    if data.get("cwd"):
        trusted_dir, tier = data["cwd"], "data.cwd"
    elif os.environ.get("CLAUDE_PROJECT_DIR"):
        trusted_dir, tier = os.environ["CLAUDE_PROJECT_DIR"], "CLAUDE_PROJECT_DIR"
    else:
        trusted_dir, tier = os.getcwd(), "process cwd"
    if isinstance(command, str) and command:
        worktree = _explicit_worktree_dir(command, trusted_dir)
        if worktree:
            return worktree, "git -C (registered worktree)"
    return trusted_dir, tier


def _contains_git(text):
    return bool(re.search(r"(?<![A-Za-z0-9_.-])git\b", text))


def _shell_tokens(command):
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";|&()\n")
    # A Bash tool submission commonly contains one command per physical line.
    # Leaving newline out of whitespace makes it a command separator without
    # disturbing quoted newlines, which shlex still returns inside one token.
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    lexer.commenters = ""
    return list(lexer)


def _is_git_executable(token):
    return _executable_basename(token) == "git"


def _executable_basename(token):
    """Normalize a command-path token without granting it path authority."""
    return token.rsplit("/", 1)[-1]


def _is_operator(token):
    """Recognize every shlex punctuation run that starts a new command."""
    return bool(token) and all(character in ";|&\n" for character in token)


def _is_shell_executable(token):
    """Recognize an interpreter token without assuming it lacks a path."""
    return _executable_basename(token) in {"sh", "bash", "zsh"}


def _has_combined_shell_c_flag(tokens, index):
    """Whether this shell invocation executes a nested command string."""
    for token in tokens[index + 1:]:
        if _is_operator(token):
            break
        if token == "--":
            break
        if token.startswith("-") and not token.startswith("--") and "c" in token[1:]:
            return True
    return False


def _skip_env(tokens, index):
    """Skip environment setup so the next command-position token is executable."""
    index += 1
    while index < len(tokens):
        token = tokens[index]
        if _is_operator(token):
            return index
        if token == "--":
            return index + 1
        if ASSIGNMENT_RE.fullmatch(token):
            index += 1
            continue
        if token.startswith("-"):
            if (
                token in ENV_OPTIONS_WITH_VALUE
                and index + 1 < len(tokens)
                and not _is_operator(tokens[index + 1])
            ):
                index += 2
            else:
                index += 1
            continue
        return index
    return index


def _skip_wrapper(tokens, index):
    """Skip a shell wrapper and its setup options before its executable."""
    wrapper = _executable_basename(tokens[index])
    options_with_value = WRAPPER_OPTIONS_WITH_VALUE.get(wrapper, set())
    index += 1
    while index < len(tokens):
        token = tokens[index]
        if _is_operator(token):
            return index
        if token == "--":
            return index + 1
        if not token.startswith("-"):
            return index
        if (
            token in options_with_value
            and index + 1 < len(tokens)
            and not _is_operator(tokens[index + 1])
        ):
            index += 2
        else:
            index += 1
    return index


def _git_invocation(tokens, index):
    """Return one Git subcommand."""
    index += 1
    while index < len(tokens):
        token = tokens[index]
        if _is_operator(token):
            return None
        if token == "--":
            if index + 1 < len(tokens) and not _is_operator(tokens[index + 1]):
                return tokens[index + 1]
            return None
        if token == "-C":
            if index + 1 < len(tokens) and not _is_operator(tokens[index + 1]):
                index += 2
            else:
                return None
            continue
        if token.startswith("-C"):
            index += 1
            continue
        if token in GIT_OPTIONS_WITH_VALUE:
            if index + 1 < len(tokens) and not _is_operator(tokens[index + 1]):
                index += 2
            else:
                return None
            continue
        if token.startswith("-c") and token != "-c":
            index += 1
            continue
        if token.startswith((
            "--git-dir=", "--work-tree=", "--namespace=", "--super-prefix=",
            "--config-env=", "--exec-path=",
        )):
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        return token
    return None


def _git_subcommand(tokens, index):
    """Return Git's first non-global option, which is its subcommand."""
    return _git_invocation(tokens, index)


def _opaque_wrapper_may_route_git(tokens, index):
    """Whether a bare `git` token appears anywhere after an opaque wrapper.

    This deliberately does not try to locate the wrapper's actual wrapped
    command -- that would mean modeling each wrapper's option grammar
    (xargs' -I/-L option forms, find's -exec/-execdir predicate syntax,
    timeout's leading DURATION), which was rejected as unverifiable and
    error-prone (see the module docstring). Instead it asks the coarser
    question "could this wrapper be handing git to whatever it invokes," by
    checking every remaining token for an exact `git` executable match
    (_is_git_executable, so `git` embedded in a merged/quoted token like
    "git commit" never counts).

    The scan runs to the end of the token stream rather than stopping at the
    next `_is_operator` token. An operator-run detector like `_is_operator`
    matches on token content alone, because shlex has already discarded
    quoting by the time `classify()` builds this token list -- so a quoted
    operator-only string used as an option value (e.g. xargs' `-I ";"`) is
    indistinguishable from a real unquoted separator. Stopping there would
    let that ambiguity hide a `git` token that appears after it, silently
    reopening the bypass this function exists to close. Not stopping trades
    a wider over-block surface (documented in the module docstring) for
    closing that gap -- consistent with this guard's bias toward
    over-blocking over silently missing an invocation.
    """
    return any(_is_git_executable(token) for token in tokens[index + 1:])


def _is_ambiguous_shell(command, tokens):
    """Recognize constructs whose nested command grammar shlex cannot prove safe."""
    if not _contains_git(command):
        return False
    if "$(" in command or "`" in command:
        return True
    for index, token in enumerate(tokens):
        if token == "eval" or token in STRUCTURAL_SHELL_TOKENS:
            return True
        if _is_shell_executable(token) and _has_combined_shell_c_flag(tokens, index):
            return True
    return False


def _git_invocations(command):
    """Reuse the command-position lexer to report Git invocations."""
    if not _contains_git(command):
        return [], False
    try:
        tokens = _shell_tokens(command)
    except ValueError:
        return [], True
    if _is_ambiguous_shell(command, tokens):
        return [], True

    invocations = []
    index = 0
    command_position = True
    while index < len(tokens):
        token = tokens[index]
        if _is_operator(token):
            command_position = True
            index += 1
            continue
        if not command_position:
            index += 1
            continue
        while index < len(tokens) and ASSIGNMENT_RE.fullmatch(tokens[index]):
            index += 1
        if index >= len(tokens):
            break
        if _is_operator(tokens[index]):
            command_position = True
            continue
        while index < len(tokens):
            if _is_operator(tokens[index]):
                break
            executable = _executable_basename(tokens[index])
            if executable == "env":
                index = _skip_env(tokens, index)
                continue
            if executable in WRAPPER_COMMANDS:
                index = _skip_wrapper(tokens, index)
                continue
            if executable in OPAQUE_WRAPPER_COMMANDS and _opaque_wrapper_may_route_git(
                tokens, index
            ):
                return [], True
            break
        if index < len(tokens) and _is_operator(tokens[index]):
            command_position = True
            continue
        if index < len(tokens) and _is_git_executable(tokens[index]):
            invocations.append(_git_invocation(tokens, index))
        command_position = False
        index += 1
    return invocations, False


def classify(command):
    """Classify protected Git operations without searching quoted argument text."""
    invocations, ambiguous = _git_invocations(command)
    if ambiguous:
        return False, False, False, True
    commit = any(subcommand == "commit" for subcommand in invocations)
    push = any(subcommand == "push" for subcommand in invocations)
    branch_switch = any(
        subcommand in {"checkout", "switch"}
        for subcommand in invocations
    )
    return commit, push, branch_switch, False


def _is_valid_worktree_porcelain(stdout):
    """Accept only fully parseable `git worktree list --porcelain` output."""
    for line in stdout.splitlines():
        if not line:
            continue
        if line.startswith("worktree "):
            if not line[len("worktree "):] or line[len("worktree "):].startswith('"'):
                return False
        elif line.startswith("HEAD "):
            if not re.fullmatch(r"HEAD [0-9A-Fa-f]+", line):
                return False
        elif line.startswith("branch "):
            if not line[len("branch "):]:
                return False
        elif line in {"bare", "detached", "locked", "prunable"}:
            continue
        elif line.startswith("locked ") and line[len("locked "):]:
            continue
        elif line.startswith("prunable ") and line[len("prunable "):]:
            continue
        else:
            return False
    return True


def _is_repository_environment_name(name):
    return (
        name in REPOSITORY_ENV_NAMES
        or name in {"GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"}
        or name.startswith("GIT_CONFIG_KEY_")
        or name.startswith("GIT_CONFIG_VALUE_")
    )


def _probe_env():
    """Return the process environment without repository-routing variables."""
    return {
        name: value for name, value in os.environ.items()
        if not _is_repository_environment_name(name)
    }


def _inherited_repository_environment_names():
    """Return routing variable names in a deterministic diagnostic order."""
    return sorted(
        name for name in os.environ if _is_repository_environment_name(name)
    )


def _identity_probe_path(directory, argument):
    """Return one required rev-parse path, resolving relative output locally."""
    try:
        result = subprocess.run(
            ["git", "-C", directory, "rev-parse", argument],
            capture_output=True, text=True, timeout=5, env=_probe_env(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    output = result.stdout.strip()
    if result.returncode != 0 or not output:
        return None
    if not os.path.isabs(output):
        output = os.path.join(directory, output)
    return os.path.realpath(output)


def _explicit_worktree_dir(command, trusted_dir):
    """Return a registered worktree only for the raw promotion form."""
    match = PROMOTION_RE.fullmatch(command)
    if not match or _inherited_repository_environment_names():
        return None
    candidate = match.group("candidate")
    try:
        result = subprocess.run(
            ["git", "-C", trusted_dir, "worktree", "list", "--porcelain"],
            capture_output=True, text=True, timeout=5, env=_probe_env(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    if not _is_valid_worktree_porcelain(result.stdout):
        return None
    candidate_realpath = os.path.realpath(candidate)
    for line in result.stdout.splitlines():
        if line.startswith("worktree "):
            registered = line[len("worktree "):]
            if os.path.realpath(registered) == candidate_realpath:
                top_level = _identity_probe_path(
                    candidate_realpath, "--show-toplevel"
                )
                if top_level is None:
                    raise RegisteredWorktreeRefused("probe", candidate_realpath)
                if top_level != candidate_realpath:
                    raise RegisteredWorktreeRefused("toplevel", candidate_realpath)
                candidate_common_dir = _identity_probe_path(
                    candidate_realpath, "--git-common-dir"
                )
                trusted_common_dir = _identity_probe_path(
                    trusted_dir, "--git-common-dir"
                )
                if candidate_common_dir is None or trusted_common_dir is None:
                    raise RegisteredWorktreeRefused("probe", candidate_realpath)
                if candidate_common_dir != trusted_common_dir:
                    raise RegisteredWorktreeRefused("common-dir", candidate_realpath)
                return candidate_realpath
    return None


def _block_message(reason, proj, tier, branch):
    """Attach one actionable trusted-context handoff to every policy block."""
    return (
        f"BLOCKED: {reason}\n"
        f"Resolved directory: {proj} (source: {tier})\n"
        f"Observed branch: {branch}\n"
        "Do not retry repeatedly. If this appears to be a false positive, run "
        "`git -C <your-worktree> rev-parse --abbrev-ref HEAD` and report its "
        "result and this message to the orchestrator once."
    )


def evaluate(command: str, data: dict) -> tuple[int, str] | None:
    """Return a branch-policy block for a commit or push command, if needed."""
    is_commit, is_push, has_branch_switch, ambiguous = classify(command)
    if not (is_commit or is_push or ambiguous):
        return None

    if ambiguous:
        proj, tier = resolve_target_dir(data)
    else:
        inherited_environment = _inherited_repository_environment_names()
        if inherited_environment:
            proj, tier = resolve_target_dir(data)
            return 2, _block_message(
                "repository-routing GIT_* environment is inherited "
                f"({', '.join(inherited_environment)}); unset it and retry",
                proj,
                tier,
                "unavailable (environment refused)",
            )
        try:
            proj, tier = resolve_target_dir(data, command)
        except RegisteredWorktreeRefused as refused:
            return 2, _block_message(
                f"registered worktree {refused.path} failed identity verification "
                f"({refused.reason}); repair the worktree before committing or pushing",
                refused.path,
                "git -C (registered worktree)",
                "unavailable (identity refused)",
            )
    try:
        res = subprocess.run(
            ["git", "-C", proj, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5, env=_probe_env(),
        )
    except (OSError, subprocess.SubprocessError):
        if ambiguous:
            return 2, _block_message(
                "shell syntax is too complex to statically classify a Git "
                "operation. Rewrite it as a simple, single-command form (for "
                "example, `git -C <path> commit -m \"...\"`) and retry.",
                proj, tier, "unavailable (branch probe failed)",
            )
        return None
    if res.returncode != 0:
        if ambiguous:
            return 2, _block_message(
                "shell syntax is too complex to statically classify a Git "
                "operation. Rewrite it as a simple, single-command form (for "
                "example, `git -C <path> commit -m \"...\"`) and retry.",
                proj, tier, "unavailable (branch probe failed)",
            )
        return None
    branch = res.stdout.strip()

    if ambiguous:
        return 2, _block_message(
            "shell syntax is too complex to statically classify a Git "
            "operation. Rewrite it as a simple, single-command form (for "
            "example, `git -C <path> commit -m \"...\"`) and retry.",
            proj, tier, branch,
        )

    # The branch is sampled BEFORE the command runs, so a compound command that
    # switches branches and then commits would be judged against the wrong
    # branch. Standalone switches (no commit/push in the command) pass through.
    if has_branch_switch:
        return 2, _block_message(
            "branch switching and commit/push in one command hides the real "
            "target branch from this guard. Run the switch first, then commit/push "
            "as a separate command.",
            proj, tier, branch,
        )

    if branch == "main":
        return 2, _block_message(
            "commits/pushes on main are forbidden. Start the /implement flow and "
            "work on an issues/<N> branch.",
            proj, tier, branch,
        )

    if is_commit and not re.fullmatch(r"issues/[0-9]+(?:-[a-z0-9]+)*", branch):
        return 2, _block_message(
            f"branch '{branch}' does not match issues/<N> or issues/<N>-<slug>. "
            "The /implement flow requires one branch per GitHub issue (stack layers "
            "use the issues/<N>-<slug> form).",
            proj, tier, branch,
        )

    return None


def main() -> int:
    """Apply branch enforcement to hook input and emit a block message if needed."""
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(data, dict):
        return 0

    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0
    command = tool_input.get("command", "")
    if not isinstance(command, str):
        return 0
    if "cwd" in data and not isinstance(data["cwd"], str):
        return 0

    result = evaluate(command, data)
    if result is None:
        return 0

    exit_code, message = result
    print(message, file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
