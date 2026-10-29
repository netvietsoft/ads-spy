#!/usr/bin/env python3
"""
scripts/update-todos.py
Tự động đồng bộ và sinh TODOS.md từ .ai/tasks/ và cập nhật .ai/state.json (§35)
Tuân thủ Development_Workspace_Standard.txt v1.1 & AGENTS.md.
"""

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
AI_DIR = WORKSPACE_ROOT / ".ai"
TASKS_DIR = AI_DIR / "tasks"
STATE_FILE = AI_DIR / "state.json"
TODOS_FILE = WORKSPACE_ROOT / "TODOS.md"

VN_TZ = timezone(timedelta(hours=7))

def now_vn_iso():
    return datetime.now(VN_TZ).strftime("%Y-%m-%dT%H:%M:%S+07:00")

def now_vn_str():
    return datetime.now(VN_TZ).strftime("%Y-%m-%d %H:%M:%S (GMT+7)")

def load_task_file(file_path: Path):
    ext = file_path.suffix.lower()
    if ext == ".json":
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                data["_file"] = str(file_path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")
                return data
        except Exception as e:
            print(f"[WARN] Không thể đọc {file_path}: {e}")
            return None
    elif ext == ".md":
        # Hỗ trợ đọc task dạng markdown đơn giản
        name = file_path.stem
        return {
            "task_id": name,
            "title": name,
            "_file": str(file_path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")
        }
    return None

def scan_tasks():
    categories = ["done", "running", "review", "blocked", "ready", "backlog"]
    result = {cat: [] for cat in categories}
    
    if not TASKS_DIR.exists():
        return result

    for cat in categories:
        cat_dir = TASKS_DIR / cat
        if not cat_dir.exists():
            continue
        for p in cat_dir.glob("*"):
            if p.is_file() and p.suffix.lower() in [".json", ".md", ".yaml", ".yml"]:
                task = load_task_file(p)
                if task:
                    task["_category"] = cat
                    result[cat].append(task)

    return result

def validate_tasks(tasks_by_cat):
    violations = []
    for t in tasks_by_cat.get("running", []):
        if not t.get("owner"):
            violations.append(f"Task running thiếu 'owner': {t.get('task_id', t.get('_file'))}")
            
    for t in tasks_by_cat.get("blocked", []):
        if not t.get("blocked_reason"):
            violations.append(f"Task blocked thiếu 'blocked_reason': {t.get('task_id', t.get('_file'))}")
            
    return violations

def update_state(tasks_by_cat):
    state = {}
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception as e:
            print(f"[WARN] Không đọc được state.json: {e}")
            state = {}

    state["updated_at"] = now_vn_iso()
    state["project"] = "Google Ads Spy & SaaS Intelligence Platform"

    running = tasks_by_cat.get("running", [])
    if running:
        t = running[0]
        state["active_task"] = {
            "id": t.get("task_id", t.get("id")),
            "title": t.get("title", ""),
            "owner": t.get("owner", "")
        }
    else:
        state["active_task"] = None

    done_tasks = []
    for t in tasks_by_cat.get("done", []):
        tid = t.get("task_id") or t.get("id") or t.get("title")
        if not tid:
            continue
        done_tasks.append({
            "id": tid,
            "title": t.get("title", ""),
            "status": "done",
            "completed_at": t.get("completed_at", t.get("created", ""))
        })

    # Sort done tasks descending
    def sort_key(item):
        return item.get("id", "")

    # Preserve recent_tasks from state if more details exist, but ensure sync
    existing_recent = {x["id"]: x for x in state.get("recent_tasks", []) if "id" in x}
    for dt in done_tasks:
        if dt["id"] in existing_recent:
            existing_recent[dt["id"]].update(dt)
        else:
            existing_recent[dt["id"]] = dt

    # Sort descending by ID or completed_at
    sorted_recent = sorted(
        existing_recent.values(),
        key=lambda x: (x.get("id", "").startswith("TASK-"), x.get("id", "")),
        reverse=True
    )
    state["recent_tasks"] = sorted_recent

    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"[OK] Đã cập nhật {STATE_FILE.relative_to(WORKSPACE_ROOT)}")

def sync_todos():
    if not TODOS_FILE.exists():
        return
    with open(TODOS_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    lines = content.splitlines()
    new_lines = []
    updated_date = False
    for line in lines:
        if line.startswith("> **Cập nhật lần cuối**:") and not updated_date:
            new_lines.append(f"> **Cập nhật lần cuối**: {now_vn_str()}  ")
            updated_date = True
        else:
            new_lines.append(line)

    with open(TODOS_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(new_lines) + "\n")
    print(f"[OK] Đã cập nhật timestamp trong {TODOS_FILE.relative_to(WORKSPACE_ROOT)}")

def main():
    print(f"=== Đang đồng bộ trạng thái nhiệm vụ (Workspace §35) ===")
    tasks_by_cat = scan_tasks()
    
    violations = validate_tasks(tasks_by_cat)
    if violations:
        print("[CẢNH BÁO VI PHẠM LUẬT TRẠNG THÁI]")
        for v in violations:
            print(f"  - {v}")
    else:
        print("[CHECK] Không có vi phạm trạng thái.")

    update_state(tasks_by_cat)
    sync_todos()
    print("=== Hoàn tất đồng bộ ===")

if __name__ == "__main__":
    main()
