#!/usr/bin/env python3
"""Exercise native Hermes readers only, with network/process/write denial.

Not a full CLI startup test. In particular, it does not qualify SOUL loading
(which bootstraps directories), dotenv, credentials, plugins or sessions.
The audit hook is a diagnostic tripwire, not an OS security sandbox.
"""
import argparse
import json
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runtime', required=True)
parser.add_argument('--home', required=True)
parser.add_argument('--root', required=True)
args = parser.parse_args()
runtime = Path(args.runtime).resolve(strict=True)
home = Path(args.home).resolve(strict=True)
root = Path(args.root).resolve(strict=True)
assert home.parent.parent == root and home.parent.name == 'profiles'
assert os.environ.get('HERMES_HOME') == str(home), 'Pin the profile before importing Hermes'
assert (home / '.ekybot-prepared-offline.json').is_file()
assert not any(key.endswith(('_TOKEN', '_SECRET', '_API_KEY')) for key in os.environ), 'Use a credential-free environment'
workspace = home / 'workspace'
os.chdir(workspace)
sys.path.insert(0, str(runtime))
denied = []
legacy = Path.home() / '.hermes'


def reject(event):
    denied.append(event)
    # BaseException makes a swallowed optional-cache/config failure visible
    # instead of accidentally certifying a partially skipped reader path.
    raise SystemExit(f'Offline isolation probe blocked {event}')


def audit(event, values):
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec', 'os.fork'}:
        reject(event)
    if event in {'os.rename', 'os.remove', 'os.rmdir', 'os.symlink', 'os.link', 'os.chmod', 'os.truncate'}:
        reject(event)
    if event == 'os.mkdir':
        # Only MemoryStore's existing directory is admissible. Native home
        # bootstrap is not a reader and must remain blocked by this probe.
        target = Path(os.fsdecode(values[0])).absolute()
        if target != home / 'memories' or target.is_symlink() or not target.is_dir():
            reject(f'{event}:{target}')
    if event == 'open' and isinstance(values[0], (str, bytes, os.PathLike)):
        target = Path(os.fsdecode(values[0])).resolve()
        mode, flags = values[1], values[2]
        if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)):
            reject('file_write')
        if target == legacy or legacy in target.parents or target.name in {'.env', '.op.env', 'auth.json'} or 'workspace-main' in target.parts:
            reject('legacy_or_secret_read')


sys.addaudithook(audit)

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
# load_soul_md() invokes ensure_hermes_home(): mkdir/chmod and optional
# seeding. Do not mock that initializer or weaken the no-write guard to
# present a bootstrap-dependent path as a read-only qualification.
assert get_all_skills_dirs() == [home / 'skills']
assert get_project_skills_dirs() == []
assert list((home / 'skills').iterdir()) == []
assert not denied, 'An imported reader attempted a blocked side effect'

print(json.dumps({
    'status': 'passed', 'scope': 'native-memory-context-skill-readers',
    'memoryEntries': 0, 'userEntries': 0, 'projectContextLoaded': False,
    'externalSkillsLoaded': False, 'legacyReads': 0, 'modelInvoked': False,
    'soulLoaderTested': False, 'nativeBootstrapTested': False,
    'fullRuntimeActivationQualified': False,
}, indent=2))
