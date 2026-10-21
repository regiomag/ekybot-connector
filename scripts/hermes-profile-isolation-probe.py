#!/usr/bin/env python3
"""Exercise native Hermes readers only, with network/process/write denial.

Default: read-only memory/context/skills. --bootstrap-fixture additionally
exercises native home/config/dotenv/SOUL initialization in a disposable copy.
Neither mode starts the chat CLI, authenticates, or creates a session.
The audit hook is a diagnostic tripwire, not an OS security sandbox.
"""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_bootstrap_policy import (
    validate_disposable_fixture, profile_snapshot,
    assert_bootstrap_changes, bootstrap_directory_event_allowed,
)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runtime', required=True)
parser.add_argument('--home', required=True)
parser.add_argument('--root', required=True)
parser.add_argument('--bootstrap-fixture', help='Disposable parent containing runtime/ and hermes/')
args = parser.parse_args()
runtime = Path(args.runtime).resolve(strict=True)
home = Path(args.home).resolve(strict=True)
root = Path(args.root).resolve(strict=True)
assert home.parent.parent == root and home.parent.name == 'profiles'
assert os.environ.get('HERMES_HOME') == str(home), 'Pin the profile before importing Hermes'
assert (home / '.ekybot-prepared-offline.json').is_file()
assert not any(key.endswith(('_TOKEN', '_SECRET', '_API_KEY')) for key in os.environ), 'Use a credential-free environment'
bootstrap = args.bootstrap_fixture is not None
before = {}


if bootstrap:
    fixture = Path(args.bootstrap_fixture).resolve(strict=True)
    validate_disposable_fixture(fixture, root, home, 'ekybot-hermes-bootstrap.')
    assert runtime == fixture / 'runtime'
    assert not (runtime / '.env').exists() and not (runtime / '.env').is_symlink(), 'Use a clean source export, never the live checkout'
    assert (home / '.env').stat().st_size == 0, 'Fixture dotenv must be empty'
    before = profile_snapshot(home)
    os.umask(0o077)
workspace = home / 'workspace'
os.chdir(workspace)
sys.path.insert(0, str(runtime))
denied = []
directory_operations = set()
dotenv_reads = set()
legacy = (Path.home() / '.hermes').resolve()
managed = Path('/etc/hermes').resolve()


def reject(event):
    denied.append(event)
    # BaseException makes a swallowed optional-cache/config failure visible
    # instead of accidentally certifying a partially skipped reader path.
    raise SystemExit(f'Offline isolation probe blocked {event}')


def audit(event, values):
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec', 'os.fork'}:
        reject(event)
    if event == 'os.chmod':
        target = Path(os.fsdecode(values[0])).absolute() if isinstance(values[0], (str, bytes, os.PathLike)) else None
        if not bootstrap or not bootstrap_directory_event_allowed(event, values, home):
            reject(event)
        directory_operations.add(str(target.relative_to(home)) or '.')
    if event in {'os.rename', 'os.remove', 'os.rmdir', 'os.symlink', 'os.link', 'os.chown', 'os.truncate', 'os.utime'}:
        reject(event)
    if event == 'os.mkdir':
        # Only MemoryStore's existing directory is admissible. Native home
        # bootstrap is not a reader and must remain blocked by this probe.
        target = Path(os.fsdecode(values[0])).absolute()
        allowed = bootstrap_directory_event_allowed(event, values, home) if bootstrap else target == home / 'memories' and target.is_dir()
        if not allowed or target.is_symlink():
            reject(f'{event}:{target}')
        directory_operations.add(str(target.relative_to(home)) or '.')
    if event == 'open' and isinstance(values[0], (str, bytes, os.PathLike)):
        target = Path(os.fsdecode(values[0])).resolve()
        mode, flags = values[1], values[2]
        if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)):
            reject('file_write')
        fixture_dotenv = bootstrap and target == home / '.env' and target.stat().st_size == 0
        if target == legacy or legacy in target.parents or (target.name in {'.env', '.op.env', 'auth.json'} and not fixture_dotenv) or 'workspace-main' in target.parts or target == managed or managed in target.parents:
            reject('legacy_or_secret_read')
        if fixture_dotenv:
            dotenv_reads.add(str(target.relative_to(home)))


sys.addaudithook(audit)

if bootstrap:
    from hermes_cli.config import ensure_hermes_home, load_config
    from hermes_cli.env_loader import load_hermes_dotenv
    from agent.prompt_builder import load_soul_md

    ensure_hermes_home()
    # Same loader/default external-source policy as the native CLI; no secrets
    # configured. No replacement of functions or seeded "already initialized" cache.
    loaded_env = load_hermes_dotenv(hermes_home=home, project_env=runtime / '.env')
    assert loaded_env == [home / '.env']
    config = load_config()
    assert config['terminal']['cwd'] == str(home / 'workspace')
    assert config['skills']['external_dirs'] == [] and config['skills']['project_discovery'] is False
    assert config['mcp_servers'] == {} and config['toolsets'] == []
    assert config['model'] in ('', {'default': ''}), 'Unexpected model selection'
    assert load_soul_md(home_override=home) == (home / 'SOUL.md').read_text().strip()
    assert not any(key.endswith(('_TOKEN', '_SECRET', '_API_KEY')) for key in os.environ)

from hermes_constants import get_hermes_home, get_default_hermes_root
from tools.memory_tool import MemoryStore, get_memory_dir
from agent.prompt_builder import build_context_files_prompt
from agent.skill_utils import get_all_skills_dirs, get_project_skills_dirs

assert get_hermes_home() == home
assert get_default_hermes_root() == root
assert get_memory_dir() == home / 'memories'
memory = MemoryStore()
memory.load_from_disk()
assert memory.memory_entries == [] and memory.user_entries == []
assert not memory.format_for_system_prompt('memory')
assert not memory.format_for_system_prompt('user')
assert build_context_files_prompt(cwd=str(workspace), skip_soul=True, home_override=home) == ''
# The read-only mode excludes SOUL's bootstrap-dependent path. The explicit
# disposable mode above executes it, without replacing native functions.
assert get_all_skills_dirs() == [home / 'skills']
assert get_project_skills_dirs() == []
assert list((home / 'skills').iterdir()) == []
assert not denied, 'An imported reader attempted a blocked side effect'

created_dirs = []
if bootstrap:
    after = profile_snapshot(home)
    created_dirs = assert_bootstrap_changes(before, after, home)
    assert not (home / 'state.db').exists(), 'No native session may be created'

print(json.dumps({
    'status': 'passed', 'scope': 'native-config-bootstrap' if bootstrap else 'native-memory-context-skill-readers',
    'memoryEntries': 0, 'userEntries': 0, 'projectContextLoaded': False,
    'externalSkillsLoaded': False, 'legacyReads': 0, 'modelInvoked': False,
    'soulLoaderTested': bootstrap, 'nativeBootstrapTested': bootstrap,
    'chatCliTested': False, 'providerAuthenticationTested': False,
    'createdDirectories': created_dirs, 'directoryOperations': sorted(directory_operations),
    'dotenvFilesRead': sorted(dotenv_reads), 'existingProfileFilesUnchanged': True if bootstrap else None,
    'fullRuntimeActivationQualified': False,
}, indent=2))
