#!/usr/bin/env python3
"""Qualify native Hermes auth-module import offline. Device login is disabled.

Run with Python -I -B -S and a credential-free environment. The native Hermes
auth module comes from the audited clean export; site .pth files are not run.
--bootstrap-fixture admits only known directory initialization in a disposable
profile. No credentials, session, model or file writes are allowed. This audit
hook detects accidental inheritance, not malicious native extensions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_bootstrap_policy import (
    validate_disposable_fixture, bootstrap_directory_event_allowed,
    profile_snapshot, assert_bootstrap_changes,
)

HASHES = {
    'hermes_cli/auth.py': '9c8bb752f79abebf918c669e298c301920267dfaace7f0b65434c92ae08292d7',
    'hermes_constants.py': '006ed0522bbe3cebdf0897ff1b9783c968b744943cc7e51b1e1eed17b3950c0c',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--profile-home', required=True)
    parser.add_argument('--site-packages', required=True)
    parser.add_argument('--login', action='store_true')
    parser.add_argument('--trace-blocked', action='store_true', help='Print source locations only for a denied side effect')
    parser.add_argument('--bootstrap-fixture', help='Allow only known native directory initialization inside this disposable fixture')
    args = parser.parse_args()
    if args.login:
        raise SystemExit('Enrollment inactive: this offline diagnostic cannot authenticate a provider.')
    assert sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode, 'Use -I -B -S'
    runtime, profile, packages = [Path(value).resolve(strict=True) for value in (args.runtime, args.profile_home, args.site_packages)]
    assert os.environ.get('HERMES_HOME') == str(profile), 'Pin HERMES_HOME explicitly'
    # macOS adds its CoreFoundation text-encoding setting even after env -i.
    assert set(os.environ) <= {'PATH', 'HERMES_HOME', 'LANG', 'LC_CTYPE', '__CF_USER_TEXT_ENCODING'}, 'Do not inherit credentials or routing'
    assert profile.parent.name == 'profiles' and profile.name == 'ekybot-v2-pilot'
    assert '.hermes' not in profile.parts and '.openclaw' not in profile.parts
    assert not (runtime / '.env').exists() and not (runtime / '.git').exists(), 'Use a clean source export'
    assert not (profile / 'state.db').exists(), 'Authenticate before first chat'
    for relative, expected in HASHES.items():
        assert hashlib.sha256((runtime / relative).read_bytes()).hexdigest() == expected, 'Requalify changed native auth source'
    for relative in ['', '.ekybot-prepared-offline.json', 'config.yaml', '.env', 'memories/MEMORY.md', 'memories/USER.md']:
        target = profile / relative
        info = target.lstat()
        assert not target.is_symlink() and info.st_uid == os.getuid() and not info.st_mode & 0o077
    marker = json.loads((profile / '.ekybot-prepared-offline.json').read_text())
    assert marker['executionAllowed'] is False and marker['status'] == 'prepared-offline'
    for relative in ['.env', 'memories/MEMORY.md', 'memories/USER.md']:
        assert (profile / relative).stat().st_size == 0, 'No inherited credentials or memory'
    assert not (profile / 'auth.json').exists(), 'Existing authentication is never overwritten by this enrollment'
    before = None
    directory_operations = set()
    if args.bootstrap_fixture:
        fixture = Path(args.bootstrap_fixture).resolve(strict=True)
        validate_disposable_fixture(fixture, profile.parent.parent, profile, 'ekybot-hermes-auth.')
        before = profile_snapshot(profile)
    os.umask(0o077)
    os.chdir(profile / 'workspace')
    sys.path[:0] = [str(runtime), str(packages)]
    denied = []

    def reject(event):
        denied.append(event)
        if args.trace_blocked:
            frames = [{'file': frame.f_code.co_filename, 'line': line, 'function': frame.f_code.co_name}
                      for frame, line in traceback.walk_stack(None)]
            print(json.dumps({'blocked': event, 'frames': frames[:16]}), file=sys.stderr)
        raise SystemExit('Fresh Hermes authentication blocked an unexpected side effect: ' + event)

    def path_value(value):
        return Path(os.fsdecode(value)).resolve() if isinstance(value, (str, bytes, os.PathLike)) else None

    def audit(event, values):
        if event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec', 'os.fork'}:
            reject(event)
        if event.startswith('socket.'):
            reject('network_in_check')
        if event == 'open':
            target = path_value(values[0])
            if target is None:
                return
            mode, flags = values[1], values[2]
            writing = isinstance(mode, str) and any(c in mode for c in 'wax+') or isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            if writing:
                reject('unexpected_write')
            if target.is_relative_to(packages):
                return
            if target.is_relative_to(profile):
                return
            if any(part in target.parts for part in ('.hermes', '.codex', 'workspace-main')) or target.is_relative_to(Path.home() / '.openclaw') or target.is_relative_to(Path('/etc/hermes').resolve()) or target.name in {'.env', '.op.env', 'auth.json'}:
                reject('legacy_or_secret_read')
        if event in {'os.mkdir', 'os.chmod'}:
            target = path_value(values[0])
            if before is not None and bootstrap_directory_event_allowed(event, values, profile):
                directory_operations.add(str(target.relative_to(profile)) or '.')
                return
            reject(f'{event}:{target}')
        if event in {'os.rename', 'os.remove', 'os.rmdir', 'os.symlink', 'os.link', 'os.chown', 'os.truncate'}:
            reject(event)

    sys.addaudithook(audit)
    from hermes_cli import auth
    from hermes_constants import get_default_hermes_root, get_hermes_home
    assert get_hermes_home() == profile and get_default_hermes_root() == profile.parent.parent
    assert auth._auth_file_path() == profile / 'auth.json'
    assert not denied
    created = assert_bootstrap_changes(before, profile_snapshot(profile), profile) if before is not None else []
    print(json.dumps({
        'status': 'native-auth-import-passed', 'scope': 'offline-auth-module-import',
        'modelInvoked': False, 'credentialsCopied': False, 'providerAuthenticationTested': False,
        'loginEnabled': False, 'createdDirectories': created,
        'directoryOperations': sorted(directory_operations),
        'existingProfileFilesUnchanged': True if before is not None else None,
    }))


if __name__ == '__main__':
    main()
