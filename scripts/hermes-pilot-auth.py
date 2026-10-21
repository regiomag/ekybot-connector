#!/usr/bin/env python3
"""Fresh, profile-owned device login only. Does not start a chat or choose a model.

Run with Python -I -B -S and a credential-free environment. The native Hermes
auth module comes from the audited clean export; site .pth files are not run.
This audit hook detects accidental inheritance, not malicious native extensions.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

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
    args = parser.parse_args()
    if args.login:
        raise SystemExit('Enrollment inactive: the native read-only bootstrap must be qualified before enabling device login.')
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
    os.umask(0o077)
    os.chdir(profile / 'workspace')
    sys.path[:0] = [str(runtime), str(packages)]
    denied = []

    def reject(event):
        denied.append(event)
        raise SystemExit('Fresh Hermes authentication blocked an unexpected side effect: ' + event)

    def path_value(value):
        return Path(os.fsdecode(value)).resolve() if isinstance(value, (str, bytes, os.PathLike)) else None

    def writable(target):
        return target is not None and target.parent == profile and (target.name in {'auth.json', 'auth.lock'} or target.name.startswith('auth.json.tmp.'))

    def audit(event, values):
        if event in {'subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec', 'os.fork'}:
            reject(event)
        if event.startswith('socket.') and not args.login:
            reject('network_in_check')
        if event == 'open':
            target = path_value(values[0])
            if target is None:
                return
            mode, flags = values[1], values[2]
            writing = isinstance(mode, str) and any(c in mode for c in 'wax+') or isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            if writing and (not args.login or not writable(target)):
                reject('unexpected_write')
            if target.is_relative_to(packages):
                return
            if target.is_relative_to(profile):
                return
            if any(part in target.parts for part in ('.hermes', '.codex', 'workspace-main')) or (target.is_relative_to(Path.home() / '.openclaw')) or target.name in {'.env', '.op.env', 'auth.json'}:
                reject('legacy_or_secret_read')
        if event in {'os.mkdir', 'os.chmod'}:
            target = path_value(values[0])
            if not args.login or not (target == profile or writable(target)):
                reject(f'{event}:{target}')
        if event in {'os.rename', 'os.remove'}:
            if not args.login or not writable(path_value(values[0])) or (event == 'os.rename' and not writable(path_value(values[1]))):
                reject(event)
        if event in {'os.rmdir', 'os.symlink', 'os.link', 'os.chown', 'os.truncate'}:
            reject(event)

    sys.addaudithook(audit)
    from hermes_cli import auth
    from hermes_constants import get_default_hermes_root, get_hermes_home
    assert get_hermes_home() == profile and get_default_hermes_root() == profile.parent.parent
    assert auth._auth_file_path() == profile / 'auth.json'
    assert not denied
    if not args.login:
        print(json.dumps({'status': 'ready-for-device-login', 'modelInvoked': False, 'credentialsCopied': False}))
        return
    # Deliberately bypass helpers that propose importing ~/.codex/auth.json or
    # mutate model configuration. Only native fresh OAuth + native atomic save.
    creds = auth._codex_device_code_login()
    auth._save_codex_tokens(creds['tokens'], creds.get('last_refresh'))
    assert not denied and (profile / 'auth.json').stat().st_mode & 0o777 == 0o600
    assert not (profile / 'state.db').exists()
    print('Hermes V2 authentication saved privately. No chat started; profile remains inactive.')


if __name__ == '__main__':
    main()
