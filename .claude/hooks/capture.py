#!/usr/bin/env python3
"""Prompt/response capture for the 8x assignment.

Wired in .claude/settings.json to two Claude Code hook events:
  SessionStart     -> remember the session's model (nothing is logged)
  UserPromptSubmit -> append the prompt, verbatim
  Stop             -> append the final response of that turn

Only the prompt and the final response are written. No thinking, tool calls
or intermediate text. Entries are append-only; the only part of a log file
that is ever rewritten is the frontmatter (exchange count, last prompt time).

A hook must never break the session, so every failure is swallowed and
written to .claude/hooks/.capture-state/errors.log instead.
"""
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

AUTHOR = "affan4321"
PROJECT = "milo-ai"
TOOL = "claude-code"

ROOT = os.environ.get("CLAUDE_PROJECT_DIR") or os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)
LOG_DIR = os.path.join(ROOT, ".agent-logs")
STATE_DIR = os.path.join(ROOT, ".claude", "hooks", ".capture-state")


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ---------- transcript ----------

def read_transcript(path):
    rows = []
    if not path or not os.path.exists(path):
        return rows
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows


def prompt_text(row):
    """The typed prompt if this row is a real user prompt, else None."""
    if row.get("type") != "user" or row.get("isSidechain") or row.get("isMeta"):
        return None
    if row.get("isCompactSummary"):
        return None
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        if any(b.get("type") == "tool_result" for b in content if isinstance(b, dict)):
            return None
        texts = [b.get("text", "") for b in content
                 if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(texts) if texts else None
    return None


def turns(rows):
    """[{prompt, prompt_time, response, response_time, model}] in order.

    The response is the text of the last assistant message of the turn only,
    i.e. what came back at the end, not text emitted between tool calls.
    """
    out = []
    cur = None
    for row in rows:
        p = prompt_text(row)
        if p is not None:
            cur = {"prompt": p, "prompt_time": row.get("timestamp"),
                   "response": "", "response_time": None, "model": None,
                   "_msg_id": None}
            out.append(cur)
            continue
        if cur is None or row.get("type") != "assistant" or row.get("isSidechain"):
            continue
        msg = row.get("message") or {}
        if msg.get("model") and msg.get("model") != "<synthetic>":
            cur["model"] = msg["model"]
        texts = [b.get("text", "") for b in (msg.get("content") or [])
                 if isinstance(b, dict) and b.get("type") == "text"]
        if msg.get("id") != cur["_msg_id"]:
            # a new assistant message supersedes the text of earlier ones
            cur["_msg_id"] = msg.get("id")
            cur["response"] = ""
        if texts:
            cur["response"] += "".join(texts)
            cur["response_time"] = row.get("timestamp")
    return out


def last_model(rows):
    for row in reversed(rows):
        if row.get("type") == "assistant" and not row.get("isSidechain"):
            m = (row.get("message") or {}).get("model")
            if m and m != "<synthetic>":
                return m
    return None


# ---------- log file ----------

def state_path(sid):
    return os.path.join(STATE_DIR, sid + ".json")


def load_state(sid):
    try:
        with open(state_path(sid), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"session_id": sid, "file": None, "prompts": 0, "responses": 0,
                "first_prompt_time": None, "last_prompt_time": None, "model": None}


def save_state(st):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(state_path(st["session_id"]), "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)


def header(st):
    sid = st["session_id"]
    date = (st["first_prompt_time"] or now_iso())[:10]
    return (
        "---\n"
        f"session_id: {sid}\n"
        f"date: {date}\n"
        f"author: {AUTHOR}\n"
        f"model: {st['model'] or 'unknown'}\n"
        f"tool: {TOOL}\n"
        f"project: {PROJECT}\n"
        f"total_exchanges: {st['prompts']}\n"
        f"first_prompt_time: {st['first_prompt_time']}\n"
        f"last_prompt_time: {st['last_prompt_time']}\n"
        "---\n\n"
        f"# Session Log - {date}\n\n"
        f"Session: `{sid[:8]}` | Project: `{PROJECT}` | Author: `{AUTHOR}`\n\n"
        "---\n\n"
    )


def append(st, old_header, entries):
    """Append entries to the body and refresh the frontmatter."""
    os.makedirs(LOG_DIR, exist_ok=True)
    if not st["file"]:
        stamp = st["first_prompt_time"][:19].replace("T", "_").replace(":", "-")
        st["file"] = f"{stamp}_{st['session_id']}.md"
    path = os.path.join(LOG_DIR, st["file"])
    body = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if old_header and text.startswith(old_header):
            body = text[len(old_header):]
        else:
            i = text.find("[LOG_ENTRY")
            body = text[i:] if i >= 0 else ""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(header(st) + body + "".join(entries))
    os.replace(tmp, path)
    save_state(st)


def entry(kind, num, sid, ts, model, text):
    return (
        f"[LOG_ENTRY type={kind} num={num} session={sid[:8]}]\n"
        f"timestamp: {ts}\n"
        f"model: {model or 'unknown'}\n\n"
        f"{text}\n\n\n"
    )


def add_prompt(st, text, ts, model):
    st["prompts"] += 1
    st["first_prompt_time"] = st["first_prompt_time"] or ts
    st["last_prompt_time"] = ts
    st["model"] = model or st["model"]
    return entry("PROMPT", st["prompts"], st["session_id"], ts, st["model"], text)


def add_response(st, text, ts, model):
    st["responses"] = st["prompts"]
    st["model"] = model or st["model"]
    return entry("RESPONSE", st["prompts"], st["session_id"], ts, st["model"], text)


# ---------- events ----------

def model_of(data):
    m = data.get("model")
    if isinstance(m, dict):
        m = m.get("id") or m.get("display_name")
    return m or None


def on_session_start(data):
    # A new session has no assistant message yet, so without this the first
    # prompt would be logged with model "unknown".
    st = load_state(data["session_id"])
    st["model"] = model_of(data) or st["model"]
    save_state(st)


def on_prompt(data):
    sid = data["session_id"]
    st = load_state(sid)
    old = header(st) if st["file"] else None
    model = model_of(data) or last_model(read_transcript(data.get("transcript_path")))
    e = add_prompt(st, data.get("prompt", ""), now_iso(), model)
    append(st, old, [e])


def on_stop(data):
    sid = data["session_id"]
    st = load_state(sid)
    old = header(st) if st["file"] else None
    path = data.get("transcript_path")

    final = data.get("last_assistant_message")
    ts_list = turns(read_transcript(path))
    if not final:
        # the last message may not be flushed to disk yet
        for _ in range(10):
            if ts_list and ts_list[-1]["response"]:
                break
            time.sleep(0.2)
            ts_list = turns(read_transcript(path))
    if not ts_list:
        return
    last = ts_list[-1]
    if final:
        last["response"] = final
    last["response_time"] = now_iso()

    entries = []
    if st["prompts"] == 0:
        # Hook was installed mid-session: nothing logged yet, so write every
        # turn the transcript holds, with the transcript's own timestamps.
        for t in ts_list:
            entries.append(add_prompt(st, t["prompt"], t["prompt_time"], t["model"]))
            entries.append(add_response(st, t["response"],
                                        t["response_time"] or now_iso(), t["model"]))
    else:
        if st["responses"] >= st["prompts"]:
            # Stop without a logged prompt: take the prompt from the transcript
            entries.append(add_prompt(st, last["prompt"],
                                      last["prompt_time"] or now_iso(), last["model"]))
        entries.append(add_response(st, last["response"], last["response_time"],
                                    last["model"]))
    append(st, old, entries)


def main():
    try:
        data = json.load(sys.stdin)
        event = data.get("hook_event_name")
        if event == "SessionStart":
            on_session_start(data)
        elif event == "UserPromptSubmit":
            on_prompt(data)
        elif event == "Stop":
            on_stop(data)
    except Exception:
        try:
            os.makedirs(STATE_DIR, exist_ok=True)
            with open(os.path.join(STATE_DIR, "errors.log"), "a", encoding="utf-8") as f:
                f.write(now_iso() + "\n" + traceback.format_exc() + "\n")
        except OSError:
            pass
    sys.exit(0)


if __name__ == "__main__":
    main()
