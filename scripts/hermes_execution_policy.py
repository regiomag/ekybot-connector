"""Process-local defence-in-depth checks shared by native execution and tests.

This is not an OS sandbox. Only fixed tools are exposed to the model.
"""
import os
from pathlib import Path
import sys


def native_audit(home, runtime, packages, *, web_enabled, offline):
    user_home = Path.home().resolve()
    allowed = (home, runtime, packages, Path(sys.base_prefix).resolve(), Path(__file__).resolve().parent)

    def audit(event, args):
        if event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.exec"):
            expected = [sys.executable, "-B", "-S", str(runtime / "plugins/web/ddgs/_search_worker.py")]
            safe_env = {"PATH", "LANG", "HOME", "HERMES_HOME", "PYTHONPATH"}
            if (not web_enabled or offline or event != "subprocess.Popen" or list(args[1]) != expected
                    or not isinstance(args[3], dict) or set(args[3]) != safe_env
                    or args[3]["HOME"] != str(home) or args[3]["HERMES_HOME"] != str(home)
                    or args[3]["PYTHONPATH"] != os.pathsep.join([str(runtime), str(packages)])):
                raise PermissionError("Native pilot cannot spawn this process")
        if offline and event in ("socket.connect", "socket.getaddrinfo"):
            raise PermissionError("Offline fixture cannot access network")
        if event != "open" or not isinstance(args[0], (str, bytes)):
            return
        target = Path(os.fsdecode(args[0])).resolve()
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT))
        # Popen opens /dev/null read-write for DEVNULL stderr before exec. It is
        # a discard sink, not a profile/file permission or arbitrary subprocess.
        discard = web_enabled and target == Path(os.devnull)
        if writing and not discard and not target.is_relative_to(home):
            raise PermissionError("Native pilot write outside profile")
        if target.is_relative_to(user_home) and not any(target.is_relative_to(p) for p in allowed):
            raise PermissionError("Native pilot read outside profile")
    return audit
