"""EXPERIMENTAL, OFFLINE ONLY: native Hermes fixture, not a live executor.

The dedicated executor uses AIAgent + SessionDB, not CLI startup/discovery.
The legacy Hermes installation and its routing are never modified.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import sys


def execute(request):
    home = Path(request["home"]).resolve(strict=True)
    runtime = Path(request["runtime"]).resolve(strict=True)
    packages = Path(request["packages"]).resolve(strict=True)
    offline = request.get("offline") is True
    if not offline:
        raise ValueError("Live execution is not qualified; offline fixtures only")
    provider = request.get("provider", "anthropic")
    if provider not in ("anthropic", "openai-codex"):
        raise ValueError("Unsupported fixture provider")
    model = "gpt-5.6-sol" if provider == "openai-codex" else "claude-opus-5-5"
    base_url = "https://chatgpt.com/backend-api/codex" if provider == "openai-codex" else "https://api.anthropic.com"
    session_id = request.get("sessionId")
    if session_id is not None and not re.fullmatch(r"\d{8}_\d{6}_[a-f0-9]{6}", session_id):
        raise ValueError("Invalid exact session")
    if not isinstance(request.get("input"), str) or not 1 <= len(request["input"]) <= 12000:
        raise ValueError("Invalid input")
    credential = request["credential"]
    if offline and credential != {"apiKey": "sk-ant-api-offline-fixture", "workspaceId": "wrkspc_offlinefixture"}:
        raise ValueError("Offline mode requires dummy credentials")
    os.umask(0o077)
    os.environ["HERMES_HOME"] = str(home)
    os.environ["ANTHROPIC_API_KEY"] = credential["apiKey"]
    os.environ["TIKTOKEN_CACHE_DIR"] = str(home / "cache")
    os.environ["HERMES_SINGLE_QUERY_SESSION"] = "1"
    os.chdir(home / "workspace")
    sys.path[:0] = [str(runtime), str(packages)]
    config = json.loads((home / "config.yaml").read_text())
    if (config.get("agent", {}).get("api_max_retries") != 1
            or config.get("compression", {}).get("enabled") is not False
            or config.get("auxiliary", {}).get("title_generation", {}).get("enabled") is not False
            or config.get("fallback_providers") != [] or config.get("toolsets") != []
            or config.get("mcp_servers") != {}):
        raise ValueError("Missing bounded-execution configuration")

    # Defence in depth, not an OS sandbox: no user-home reads outside the new
    # profile or the explicitly selected dependency tree; no subprocesses.
    user_home = Path.home().resolve()
    allowed = (home, runtime, packages, Path(sys.base_prefix).resolve())

    def audit(event, args):
        if event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.exec"):
            raise PermissionError("Native pilot cannot spawn tools")
        if offline and event in ("socket.connect", "socket.getaddrinfo"):
            raise PermissionError("Offline fixture cannot access network")
        if event != "open" or not isinstance(args[0], (str, bytes)):
            return
        target = Path(os.fsdecode(args[0])).resolve()
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT))
        if writing and not target.is_relative_to(home):
            raise PermissionError("Native pilot write outside profile")
        if target.is_relative_to(user_home) and not any(target.is_relative_to(p) for p in allowed):
            raise PermissionError("Native pilot read outside profile")

    sys.addaudithook(audit)
    import httpx
    import anthropic
    import agent.anthropic_credentials as auth
    import agent.anthropic_adapter as adapter

    native_classifier = auth._is_oauth_token
    # Personal Console API keys are API credentials, not Claude Code OAuth.
    auth._is_oauth_token = lambda token: False if token == credential["apiKey"] else native_classifier(token)
    adapter._is_oauth_token = auth._is_oauth_token
    calls = []
    transport_errors = []

    class DiagnosticClient(httpx.Client):
        def send(self, *args, **kwargs):
            try:
                return super().send(*args, **kwargs)
            except Exception as error:
                # This probe rejects live credentials before importing the SDK.
                # Record the underlying fake-transport exception rather than
                # diagnosing the SDK's generic "Connection error" repeatedly.
                import traceback
                transport_errors.append({"type": type(error).__name__, "message": str(error),
                    "locations": [f"{Path(f.filename).name}:{f.lineno}" for f in traceback.extract_tb(error.__traceback__)[-5:]]})
                raise

    def request_guard(http_request):
        endpoint = base_url + ("/responses" if provider == "openai-codex" else "/v1/messages")
        if str(http_request.url).split("?", 1)[0] != endpoint or http_request.method != "POST":
            raise PermissionError("Unexpected native endpoint")
        body = json.loads(http_request.content)
        limit = body.get("max_output_tokens", 512) if provider == "openai-codex" else body.get("max_tokens", 999999)
        if body.get("model") != model or body.get("tools") or limit > 1024 or calls:
            raise PermissionError("Unexpected native model call or retry")
        calls.append(body)

    def fixture_response(http_request):
        body = json.loads(http_request.content)
        if provider == "openai-codex":
            item = {"id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": "OFFLINE_NATIVE_OK", "annotations": []}]}
            response = {"id": "resp_fixture", "object": "response", "created_at": 1, "status": "completed",
                        "model": model, "output": [item], "error": None, "incomplete_details": None,
                        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}
            events = [
                {"type": "response.created", "response": {**response, "status": "in_progress", "output": []}},
                {"type": "response.output_item.added", "output_index": 0, "item": {**item, "status": "in_progress", "content": []}},
                {"type": "response.output_text.delta", "item_id": "msg_fixture", "output_index": 0, "content_index": 0, "delta": "OFFLINE_NATIVE_OK"},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": response},
            ]
            content = "".join(f"event: {event['type']}\ndata: {json.dumps({**event, 'sequence_number': index})}\n\n" for index, event in enumerate(events))
            return httpx.Response(200, text=content, headers={"Content-Type": "text/event-stream"})
        message = {
            "id": "msg_offline", "type": "message", "role": "assistant",
            "model": "claude-opus-5-5", "content": [{"type": "text", "text": "OFFLINE_NATIVE_OK"}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
        if not body.get("stream"):
            return httpx.Response(200, json=message)
        # The native adapter uses Messages streaming. A plain JSON response
        # has no SSE events and correctly triggers its empty-stream handling.
        events = [
            {"type": "message_start", "message": {**message, "content": [], "stop_reason": None}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "OFFLINE_NATIVE_OK"}},
            {"type": "content_block_stop", "index": 0},
            {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 1}},
            {"type": "message_stop"},
        ]
        content = "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events)
        return httpx.Response(200, text=content, headers={"Content-Type": "text/event-stream"})

    def api_client(api_key, base_url=None, timeout=None, **kwargs):
        if api_key != credential["apiKey"] or base_url not in (None, "https://api.anthropic.com", "https://api.anthropic.com/"):
            raise PermissionError("Unexpected native credential or endpoint")
        transport = httpx.MockTransport(fixture_response) if offline else None
        return anthropic.Anthropic(
            api_key=api_key, base_url="https://api.anthropic.com", max_retries=0,
            timeout=45, default_headers={"anthropic-workspace-id": credential["workspaceId"]},
            http_client=DiagnosticClient(transport=transport, timeout=45, trust_env=False, follow_redirects=False, event_hooks={"request": [request_guard]}),
        )

    adapter.build_anthropic_client = api_client
    from hermes_state import SessionDB
    from run_agent import AIAgent
    if provider == "openai-codex":
        import openai

        def openai_client(self, client_kwargs, *, reason, shared):
            if client_kwargs.get("api_key") != credential["apiKey"] or client_kwargs.get("base_url") != base_url:
                raise ValueError("Unexpected OpenAI client configuration")
            return openai.OpenAI(api_key=credential["apiKey"], base_url=base_url, max_retries=0,
                default_headers={"ChatGPT-Account-Id": "fixture-account-id"},
                http_client=DiagnosticClient(transport=httpx.MockTransport(fixture_response), timeout=45,
                    trust_env=False, follow_redirects=False, event_hooks={"request": [request_guard]}))

        AIAgent._create_openai_client = openai_client
    db = SessionDB(db_path=home / "state.db")
    history = db.get_messages_as_conversation(session_id) if session_id else []
    if session_id and not history:
        raise ValueError("Missing exact native history")
    agent = AIAgent(
        model=model, provider=provider, requested_provider=provider,
        api_key=credential["apiKey"], base_url=base_url,
        enabled_toolsets=[], disabled_toolsets=["all"], max_iterations=1,
        max_tokens=512, reasoning_config={"enabled": False}, quiet_mode=True,
        save_trajectories=False, verbose_logging=False, session_db=db,
        session_id=session_id, platform="cli", skip_context_files=True,
        load_soul_identity=True, skip_background_review=True, checkpoints_enabled=False,
        fallback_model=None, run_budget_seconds=60,
    )
    if agent.tools:
        raise ValueError("Unexpected tools enabled")
    try:
        result = agent.run_conversation(request["input"], conversation_history=history)
    finally:
        agent.close()
    output = result.get("final_response")
    if result.get("failed") or result.get("partial") or not isinstance(output, str) or not output.strip() or len(calls) != 1:
        if offline:
            print(json.dumps({"fixtureResult": result, "calls": len(calls), "transportErrors": transport_errors}), file=sys.__stdout__)
        raise ValueError("Unverified native completion")
    return {"sessionId": agent.session_id, "output": output, "modelRequests": len(calls), "offline": offline,
            "provider": provider,
            "inputMessageCount": len(calls[0].get("input" if provider == "openai-codex" else "messages", []))}


if __name__ == "__main__":
    try:
        payload = json.loads(sys.stdin.read(32768))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = execute(payload)
        print(json.dumps(result))
    except BaseException as error:
        # Type and location are enough for diagnostics. Never reflect upstream
        # exception strings, request bodies, headers, prompts or credentials.
        import traceback
        frames = traceback.extract_tb(error.__traceback__)
        print(json.dumps({"error": type(error).__name__, "locations": [f"{Path(f.filename).name}:{f.lineno}" for f in frames[-5:]]}))
        sys.exit(1)
