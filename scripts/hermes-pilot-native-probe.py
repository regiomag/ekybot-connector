"""Bounded Hermes executor, also exercised with offline transports.

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
    rejection_statuses = set(json.loads((Path(__file__).resolve().parent.parent / "src/hermes-pilot-rejections.json").read_text()).values())
    home = Path(request["home"]).resolve(strict=True)
    runtime = Path(request["runtime"]).resolve(strict=True)
    packages = Path(request["packages"]).resolve(strict=True)
    offline = request.get("offline") is True
    web_enabled = request.get("webEnabled") is True
    bmt_enabled = request.get("bmtEnabled") is True
    if web_enabled and not offline:
        policy = json.loads((home / "web-policy.json").read_text())
        if policy != {"version": 1, "enabled": True, "maxRequests": 8}:
            raise PermissionError("Explicit Web activation required")
    if not offline:
        activation = json.loads((home / ".ekybot-pilot-active.json").read_text())
        if bmt_enabled and (activation.get("mode") != "bmt-protocol-v1" or web_enabled):
            raise PermissionError("Explicit isolated BMT activation required")
        if (activation.get("executionAllowed") is not True
                or activation.get("channelId") != request.get("channelId")
                or activation.get("runtime") != str(runtime)
                or activation.get("packages") != str(packages)
                or not re.fullmatch(r"[a-f0-9-]{36}", request.get("jobId", ""))):
            raise PermissionError("Pilot activation required")
        journal = json.loads((home / "pilot-journal" / (request["jobId"] + ".json")).read_text())
        if journal.get("status") != "started" or journal.get("channelId") != request["channelId"]:
            raise PermissionError("Durable job admission required")
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
    fallback_credential = request.get("fallbackCredential", credential)
    if offline and credential != {"apiKey": "sk-ant-api-offline-fixture", "workspaceId": "wrkspc_offlinefixture"}:
        raise ValueError("Offline mode requires dummy credentials")
    os.umask(0o077)
    os.environ["HERMES_HOME"] = str(home)
    os.environ["ANTHROPIC_API_KEY"] = fallback_credential["apiKey"]
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
    if web_enabled and config.get("tools", {}).get("tool_search", {}).get("enabled") != "off":
        raise ValueError("Exact Web schemas required; dynamic tool discovery is disabled")

    # Defence in depth, not an OS sandbox: no user-home reads outside the new
    # profile or the explicitly selected dependency tree; no subprocesses.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from hermes_execution_policy import native_audit
    sys.addaudithook(native_audit(home, runtime, packages, web_enabled=web_enabled, offline=offline))
    import httpx
    import anthropic
    import agent.anthropic_credentials as auth
    import agent.anthropic_adapter as adapter

    native_classifier = auth._is_oauth_token
    # Personal Console API keys are API credentials, not Claude Code OAuth.
    auth._is_oauth_token = lambda token: False if token == fallback_credential["apiKey"] else native_classifier(token)
    adapter._is_oauth_token = auth._is_oauth_token
    calls = []
    transport_errors = []
    attempts = []
    fallback_activated = False
    request_hashes = set()
    tool_names = {"ekybot_web_read", "ekybot_web_search", "ekybot_request_site_access"} if web_enabled else set()

    def save_attempts():
        if offline:
            return
        destination = home / "pilot-journal" / (request["jobId"] + ".attempts.json")
        temporary = destination.with_suffix(".tmp")
        with open(temporary, "w") as stream:
            json.dump(attempts, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    class DiagnosticClient(httpx.Client):
        def send(self, *args, **kwargs):
            try:
                return super().send(*args, **kwargs)
            except Exception as error:
                # This probe rejects live credentials before importing the SDK.
                # Record the underlying fake-transport exception rather than
                # diagnosing the SDK's generic "Connection error" repeatedly.
                import traceback
                transport_errors.append({"type": type(error).__name__, "message": str(error) if offline else "redacted",
                    "locations": [f"{Path(f.filename).name}:{f.lineno}" for f in traceback.extract_tb(error.__traceback__)[-5:]]})
                raise

    def request_guard(http_request):
        endpoint = str(http_request.url).split("?", 1)[0]
        target = {"https://chatgpt.com/backend-api/codex/responses": "openai-codex",
                  "https://api.anthropic.com/v1/messages": "anthropic"}.get(endpoint)
        if not target or http_request.method != "POST":
            raise PermissionError("Unexpected native endpoint")
        body = json.loads(http_request.content)
        expected = "gpt-5.6-sol" if target == "openai-codex" else "claude-opus-5-5"
        limit = body.get("max_output_tokens", 512) if target == "openai-codex" else body.get("max_tokens", 999999)
        names = {t.get("name") or t.get("function", {}).get("name") for t in body.get("tools", [])}
        import hashlib
        fingerprint = hashlib.sha256(http_request.content).hexdigest()
        if (body.get("model") != expected or names != tool_names or limit > (2048 if web_enabled else 1024)
                or fingerprint in request_hashes or len(attempts) >= (8 if web_enabled else 2)
                or (not web_enabled and any(a["provider"] == target for a in attempts))
                or (target != provider and not fallback_activated)):
            raise PermissionError("Unexpected native model call or retry")
        request_hashes.add(fingerprint)
        attempts.append({"provider": target, "status": "started"})
        save_attempts()  # Durable before handing a prompt to the network.
        calls.append(body)

    def response_guard(response):
        attempts[-1].update(status="response-headers", httpStatus=response.status_code)
        save_attempts()

    def fixture_response(http_request):
        body = json.loads(http_request.content)
        fixture_tool = web_enabled and len(calls) == 1 and not request.get("fixturePrimaryStatus")
        if http_request.url.host == "chatgpt.com":
            if request.get("fixturePrimaryStatus"):
                return httpx.Response(request["fixturePrimaryStatus"], json={"error": {"message": "fixture refusal", "type": "permission_error"}})
            item = {"id": "msg_fixture", "type": "message", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": "OFFLINE_NATIVE_OK", "annotations": []}]}
            if fixture_tool:
                item = {"id": "fc_fixture", "type": "function_call", "call_id": "call_fixture", "status": "completed",
                        "name": "ekybot_web_read", "arguments": '{"url":"https://example.com"}'}
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
            if fixture_tool:
                events = [{"type": "response.created", "response": {**response, "status": "in_progress", "output": []}},
                          {"type": "response.output_item.added", "output_index": 0, "item": item},
                          {"type": "response.output_item.done", "output_index": 0, "item": item},
                          {"type": "response.completed", "response": response}]
            content = "".join(f"event: {event['type']}\ndata: {json.dumps({**event, 'sequence_number': index})}\n\n" for index, event in enumerate(events))
            return httpx.Response(200, text=content, headers={"Content-Type": "text/event-stream"})
        message = {
            "id": "msg_offline", "type": "message", "role": "assistant",
            "model": "claude-opus-5-5", "content": [{"type": "text", "text": "OFFLINE_NATIVE_OK"}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
        if fixture_tool:
            message["content"] = [{"type": "tool_use", "id": "call_fixture", "name": "ekybot_web_read", "input": {"url": "https://example.com"}}]
            message["stop_reason"] = "tool_use"
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
        if fixture_tool:
            events = [
                {"type": "message_start", "message": {**message, "content": [], "stop_reason": None}},
                {"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "call_fixture", "name": "ekybot_web_read", "input": {}}},
                {"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": '{"url":"https://example.com"}'}},
                {"type": "content_block_stop", "index": 0},
                {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None}, "usage": {"output_tokens": 1}},
                {"type": "message_stop"},
            ]
        content = "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events)
        return httpx.Response(200, text=content, headers={"Content-Type": "text/event-stream"})

    def api_client(api_key, base_url=None, timeout=None, **kwargs):
        if api_key != fallback_credential["apiKey"] or base_url not in (None, "https://api.anthropic.com", "https://api.anthropic.com/"):
            raise PermissionError("Unexpected native credential or endpoint")
        transport = httpx.MockTransport(fixture_response) if offline else None
        return anthropic.Anthropic(
            api_key=api_key, base_url="https://api.anthropic.com", max_retries=0,
            timeout=45, default_headers={"anthropic-workspace-id": fallback_credential["workspaceId"]},
            http_client=DiagnosticClient(transport=transport, timeout=45, trust_env=False, follow_redirects=False, event_hooks={"request": [request_guard], "response": [response_guard]}),
        )

    adapter.build_anthropic_client = api_client
    auth.build_anthropic_client = api_client
    from hermes_state import SessionDB
    from run_agent import AIAgent
    if web_enabled:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from hermes_web_tools import WebTools, register_web_tools
        web_records = []
        def record_web(fn, success):
            web_records.append({"tool": fn._ekybot_tool_name, "success": success})
            if offline: return
            destination = home / "pilot-journal" / (request["jobId"] + ".web.json")
            temporary = destination.with_suffix(".tmp")
            with open(temporary, "w") as stream:
                json.dump(web_records, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        web = WebTools(home, runtime, packages, record=record_web)
        if offline:
            web.read = lambda url: {"url": url, "content": "OFFLINE_WEB_PAGE", "authentication": "none"}
            web.search_override = lambda query: {"results": []}
        register_web_tools(web)
    if provider == "openai-codex":
        import openai

        def openai_client(self, client_kwargs, *, reason, shared):
            if client_kwargs.get("api_key") != credential["apiKey"] or client_kwargs.get("base_url") != base_url:
                raise ValueError("Unexpected OpenAI client configuration")
            return openai.OpenAI(api_key=credential["apiKey"], base_url=base_url, max_retries=0,
                default_headers={"ChatGPT-Account-Id": "fixture-account-id" if offline else credential["accountId"]},
                http_client=DiagnosticClient(transport=httpx.MockTransport(fixture_response) if offline else None, timeout=45,
                    trust_env=False, follow_redirects=False, event_hooks={"request": [request_guard], "response": [response_guard]}))

        AIAgent._create_openai_client = openai_client
        # No hidden global Codex recovery, refresh retry or alternate transport.
        AIAgent._try_refresh_codex_client_credentials = lambda self, **kwargs: False
        AIAgent._try_recover_primary_transport = lambda self, *args, **kwargs: False
        original_fallback = AIAgent._try_activate_fallback

        def guarded_fallback(self, reason=None):
            nonlocal fallback_activated
            if (fallback_activated or len(attempts) != 1
                    or attempts[0].get("httpStatus") not in rejection_statuses):
                return False
            fallback_activated = True
            attempts[0]["status"] = "rejected-before-execution"
            save_attempts()
            return original_fallback(self, reason)

        AIAgent._try_activate_fallback = guarded_fallback
    db = SessionDB(db_path=home / "state.db")
    history = db.get_messages_as_conversation(session_id) if session_id else []
    if session_id and not history:
        raise ValueError("Missing exact native history")
    agent = AIAgent(
        model=model, provider=provider, requested_provider=provider,
        api_key=credential["apiKey"], base_url=base_url,
        enabled_toolsets=["ekybot_web"] if web_enabled else [], disabled_toolsets=[] if web_enabled else ["all"], max_iterations=6 if web_enabled else 1,
        max_tokens=2048 if web_enabled or bmt_enabled else 512, reasoning_config={"enabled": False}, quiet_mode=True,
        save_trajectories=False, verbose_logging=False, session_db=db,
        session_id=session_id, platform="cli", skip_context_files=True,
        load_soul_identity=True, skip_background_review=True, checkpoints_enabled=False,
        ephemeral_system_prompt=(Path(__file__).resolve().parent.parent / "src/bmt-system-prompt.txt").read_text() if bmt_enabled else None,
        fallback_model={"provider": "anthropic", "model": "claude-opus-5-5",
                        "base_url": "https://api.anthropic.com", "api_key": fallback_credential["apiKey"]}
                        if provider == "openai-codex" and request.get("allowFallback") is True else None,
        run_budget_seconds=180 if web_enabled else 90,
    )
    actual_names = {t.get("name") or t.get("function", {}).get("name") for t in agent.tools}
    if actual_names != tool_names:
        if offline:
            print(json.dumps({"fixtureToolNames": sorted(actual_names), "expected": sorted(tool_names)}), file=sys.__stdout__)
        raise ValueError("Unexpected tools enabled")
    try:
        result = agent.run_conversation(request["input"], conversation_history=history)
    finally:
        agent.close()
    output = result.get("final_response")
    if result.get("failed") or result.get("partial") or not isinstance(output, str) or not output.strip() or (not web_enabled and len(calls) != (2 if fallback_activated else 1)):
        if offline:
            print(json.dumps({"fixtureResult": result, "calls": len(calls), "transportErrors": transport_errors}), file=sys.__stdout__)
        raise ValueError("Unverified native completion")
    attempts[-1]["status"] = "completed"
    save_attempts()
    return {"sessionId": agent.session_id, "output": output, "modelRequests": len(calls), "offline": offline,
            "webTools": web_records if web_enabled else [],
            "provider": agent.provider, "fallbackUsed": fallback_activated,
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
