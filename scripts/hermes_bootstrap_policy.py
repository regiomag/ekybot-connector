"""Shared, narrow policy for disposable offline Hermes initialization probes."""
import hashlib
import os
from pathlib import Path
import stat
import tempfile

BOOTSTRAP_DIRECTORIES = (
    '', 'cron', 'sessions', 'logs', 'logs/curator', 'memories',
    'pairing', 'hooks', 'image_cache', 'audio_cache', 'skills',
)


def bootstrap_directories(home):
    return {home / name for name in BOOTSTRAP_DIRECTORIES}


def validate_disposable_fixture(fixture, root, home, prefix):
    assert fixture.parent in {Path('/private/tmp'), Path(tempfile.gettempdir()).resolve()}
    assert fixture.name.startswith(prefix), 'Use an explicitly named disposable fixture'
    assert root == fixture / 'hermes' and home == root / 'profiles' / 'ekybot-v2-pilot'
    assert not (fixture.stat().st_mode & 0o077) and fixture.stat().st_uid == os.getuid()


def bootstrap_directory_event_allowed(event, values, home):
    if event not in {'os.mkdir', 'os.chmod'} or not isinstance(values[0], (str, bytes, os.PathLike)):
        return False
    target = Path(os.fsdecode(values[0])).absolute()
    if target.resolve() != target or target not in bootstrap_directories(home):
        return False
    if len(values) > 2 and values[2] != -1:
        return False
    return values[1] == 0o700 if event == 'os.chmod' else values[1] in {0o700, 0o777}


def profile_snapshot(home):
    result = {}
    for item in sorted(home.rglob('*')):
        info = item.lstat()
        assert not item.is_symlink(), 'No profile symlinks allowed'
        assert info.st_uid == os.getuid() and not (info.st_mode & 0o077)
        assert item.is_file() or item.is_dir(), 'Regular profile entries only'
        result[str(item.relative_to(home))] = {
            'mode': stat.S_IMODE(info.st_mode),
            'hash': hashlib.sha256(item.read_bytes()).hexdigest() if item.is_file() else None,
        }
    return result


def assert_bootstrap_changes(before, after, home):
    assert all(after.get(name) == value for name, value in before.items()), 'Existing profile contents changed'
    created = sorted(set(after) - set(before))
    assert all(home / name in bootstrap_directories(home) and after[name] == {'mode': 0o700, 'hash': None} for name in created)
    return created
