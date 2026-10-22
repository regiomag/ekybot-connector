"""Fixed tools over the existing per-run private Unix socket capability.

No machine token, arbitrary endpoint, filesystem tool or provider credential is
accepted by a model. The server rechecks mission ownership and budgets per call.
"""
import json
import socket
import uuid

NAMES = {"ekybot_mission_status", "ekybot_mission_delegate", "ekybot_memory_search", "ekybot_memory_propose"}

def invoke(connection, name, args):
    if name not in NAMES:
        raise PermissionError("Unsupported mission tool")
    payload = json.dumps({"token": connection["token"], "name": name,
                          "arguments": args, "callId": str(uuid.uuid4())}).encode() + b"\n"
    if len(payload) > 12000:
        raise ValueError("Mission input too large")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(30)
        client.connect(connection["socketPath"])
        client.sendall(payload)
        chunks, size = [], 0
        while True:
            chunk = client.recv(8192)
            if not chunk:
                break
            size += len(chunk)
            if size > 50000:
                raise ValueError("Mission response too large")
            chunks.append(chunk)
    response = json.loads(b"".join(chunks))
    if response.get("error"):
        raise PermissionError("Mission access refused")
    return response["result"]

def register_mission_tools(bridge):
    from tools.registry import registry
    definitions = bridge["definitions"]
    if not isinstance(definitions, list) or not 3 <= len(definitions) <= 4:
        raise ValueError("Invalid mission tools")
    for tool in definitions:
        name = tool["name"]
        if name not in NAMES:
            raise PermissionError("Unqualified mission tool")
        def handler(args, tool_name=name, **_kwargs):
            try:
                return json.dumps(invoke(bridge["connection"], tool_name, args), ensure_ascii=False)
            except Exception:
                return json.dumps({"error":"Mission operation refused or uncertain. Do not repeat a delegation blindly; inspect mission status."})
        registry.register(name=name,toolset="ekybot_mission",schema={"name":name,"description":tool["description"],"parameters":tool["inputSchema"]},handler=handler,check_fn=lambda: True,max_result_size_chars=24000)
