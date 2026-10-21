import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import socket

sys.path[:0] = [os.environ["EKYBOT_NATIVE_RUNTIME"], os.environ["EKYBOT_NATIVE_PACKAGES"], str(Path(__file__).resolve().parent.parent / "scripts")]
import httpx
from hermes_web_tools import WebTools, PageText, public_url, public_client
from hermes_execution_policy import native_audit


class WebTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="ekybot-web-unit-")
        self.addCleanup(self.directory.cleanup)
        os.environ["HERMES_HOME"] = self.directory.name

    def tool(self, handler):
        return WebTools(self.directory.name, os.environ["EKYBOT_NATIVE_RUNTIME"], os.environ["EKYBOT_NATIVE_PACKAGES"],
            client_factory=lambda **kwargs: httpx.Client(transport=httpx.MockTransport(handler), **kwargs))

    def test_no_credential_url_or_non_web_scheme(self):
        for url in ["file:///etc/passwd", "https://a:b@example.com", "https://example.com/?access_token=secret", "javascript:alert(1)"]:
            with self.assertRaises(ValueError): public_url(url)

    def test_public_pages_are_bounded_and_cookieless(self):
        requests = []
        def handle(request):
            requests.append(request)
            if len(requests) == 1: return httpx.Response(302, headers={"Location": "/next", "Set-Cookie": "session=private"})
            return httpx.Response(200, headers={"Content-Type": "text/html"}, text='<h1>Public</h1><script>secret script</script><a href="/project">Project</a>')
        result = self.tool(handle).read("https://example.com")
        self.assertNotIn("cookie", requests[1].headers)
        self.assertNotIn("secret script", result["content"])
        self.assertEqual(result["links"], ["https://example.com/project"])
        self.assertEqual(result["authentication"], "none")

    def test_login_is_not_silently_bypassed(self):
        result = self.tool(lambda _: httpx.Response(401)).read("https://example.com/private")
        self.assertEqual(result["access"], "blocked_or_login_required")

    def test_body_and_redirect_budgets(self):
        with self.assertRaises(ValueError): self.tool(lambda _: httpx.Response(200, headers={"Content-Type": "text/plain"}, content=b'x'*(2*1024*1024+1))).read("https://example.com")
        with self.assertRaises(ValueError): self.tool(lambda _: httpx.Response(302, headers={"Location": "/again"})).read("https://example.com")

    def test_native_transport_blocks_local_network(self):
        web = WebTools(self.directory.name, os.environ["EKYBOT_NATIVE_RUNTIME"], os.environ["EKYBOT_NATIVE_PACKAGES"])
        for url in ["http://127.0.0.1", "http://169.254.169.254", "http://[::1]"]:
            with self.assertRaises(Exception): web.read(url)

    def test_nat64_validates_embedded_address_and_keeps_dns_pinning(self):
        from tools import url_safety
        with public_client(trust_env=False): pass
        def dns(ip):
            return [(socket.AF_INET6, socket.SOCK_STREAM, 6, '', (ip, 443, 0, 0))]
        with patch.object(socket, 'getaddrinfo', return_value=dns('64:ff9b::808:808')):
            self.assertEqual(url_safety._resolved_http_connect_ips('example.com', 443, 'https'), ['64:ff9b::808:808'])
        for ip in ['64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::a00:1', '64:ff9b::6440:1', '64:ff9b::0', '64:ff9b:1::808:808']:
            with patch.object(socket, 'getaddrinfo', return_value=dns(ip)):
                with self.assertRaises(url_safety.SSRFConnectionBlocked):
                    url_safety._resolved_http_connect_ips('example.com', 443, 'https')
        # A mixed DNS answer is rejected, not filtered to its public records.
        with patch.object(socket, 'getaddrinfo', return_value=dns('64:ff9b::808:808') + dns('64:ff9b::7f00:1')):
            with self.assertRaises(url_safety.SSRFConnectionBlocked):
                url_safety._resolved_http_connect_ips('example.com', 443, 'https')

    def test_permission_without_broker_never_grants_browser_access(self):
        web = self.tool(lambda _: httpx.Response(500))
        result = web.request_site("https://example.com/private", "Read my dashboard")
        self.assertEqual(result["status"], "permission_required")
        self.assertEqual(result["origin"], "https://example.com")

    def test_search_audit_allows_only_fixed_worker_and_discard_sink(self):
        home = Path(self.directory.name)
        runtime, packages = Path(os.environ["EKYBOT_NATIVE_RUNTIME"]), Path(os.environ["EKYBOT_NATIVE_PACKAGES"])
        audit = native_audit(home, runtime, packages, web_enabled=True, offline=False)
        audit('open', (os.devnull, 'r+', os.O_RDWR))
        with self.assertRaises(PermissionError): audit('open', ('/tmp/arbitrary-write', 'w', os.O_WRONLY))
        env = {"PATH": "/usr/bin:/bin", "LANG": "en_US.UTF-8", "HOME": str(home), "HERMES_HOME": str(home), "PYTHONPATH": os.pathsep.join([str(runtime), str(packages)])}
        args = [sys.executable, '-B', '-S', str(runtime / 'plugins/web/ddgs/_search_worker.py')]
        audit('subprocess.Popen', (sys.executable, args, None, env))
        for bad in [dict(env, API_KEY='synthetic'), dict(env, HOME='/tmp/elsewhere')]:
            with self.assertRaises(PermissionError): audit('subprocess.Popen', (sys.executable, args, None, bad))
        with self.assertRaises(PermissionError): audit('subprocess.Popen', ('sh', ['sh', '-c', 'true'], None, env))
        with self.assertRaises(PermissionError): native_audit(home,runtime,packages,web_enabled=True,offline=True)('subprocess.Popen', (sys.executable,args,None,env))


if __name__ == "__main__": unittest.main()
