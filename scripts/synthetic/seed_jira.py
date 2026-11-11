#!/usr/bin/env python3
"""Seed the synthetic Jira space with the cases Seam C's contract suite records.

Usage: seed_jira.py <site> <email> <projectKey> <manifest.json>
The token is read from the macOS Keychain (service forecaster-jira-seed) and
handed to curl on stdin, never on the command line. Synthetic data only.
"""
import json, subprocess, sys, time
from datetime import datetime, timezone

SITE, EMAIL, KEY, MANIFEST = sys.argv[1:5]
TOKEN = subprocess.run(["security", "find-generic-password", "-s", "forecaster-jira-seed", "-w"],
                       capture_output=True, text=True, check=True).stdout.strip()
manifest = {"site": SITE, "projectKey": KEY, "issues": {}, "batches": {}}


def api(method, path, body=None):
    cfg = f'user = "{EMAIL}:{TOKEN}"\n'
    args = ["curl", "-sS", "-K", "-", "-X", method, "-H", "Accept: application/json",
            "-H", "Content-Type: application/json", "-w", "\n%{http_code}"]
    if body is not None:
        args += ["--data", json.dumps(body)]
    out = subprocess.run(args + [f"https://{SITE}{path}"], input=cfg, capture_output=True, text=True)
    text, _, code = out.stdout.rpartition("\n")
    if not code.startswith("2"):
        raise RuntimeError(f"{method} {path} -> {code}\n{text[:800]}")
    time.sleep(0.25)
    return json.loads(text) if text.strip() else None


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save():
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=2)


project = api("GET", f"/rest/api/3/project/{KEY}")
pid = project["id"]
types = {t["name"]: t["id"] for t in project["issueTypes"]}
manifest["projectId"] = pid

# Fix versions for milestoneChoices(): two unreleased, one released.
versions = {}
for role, name, released in [("checkout", "Checkout v2", False), ("search", "Search revamp", False),
                             ("onboarding_released", "Onboarding (done)", True)]:
    v = api("POST", "/rest/api/3/version", {"name": name, "projectId": int(pid), "released": released})
    versions[role] = v["id"]
manifest["versions"] = versions
save()


def fields(role, summary, itype="Task", version=None, labels=(), parent=None):
    f = {"project": {"id": pid}, "issuetype": {"id": types[itype]}, "summary": summary,
         "labels": list(labels),
         "description": {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [
             {"type": "text", "text": f"Synthetic ticket. Role: {role}."}]}]}}
    if version:
        f["fixVersions"] = [{"id": versions[version]}]
    if parent:
        f["parent"] = {"key": manifest["issues"][parent]["key"]}
    return f


def create(specs):
    """specs: list of (role, fields). Bulk-creates 50 at a time."""
    for i in range(0, len(specs), 50):
        chunk = specs[i:i + 50]
        r = api("POST", "/rest/api/3/issue/bulk", {"issueUpdates": [{"fields": f} for _, f in chunk]})
        if r.get("errors"):
            raise RuntimeError(json.dumps(r["errors"])[:800])
        for (role, _), made in zip(chunk, r["issues"]):
            manifest["issues"][role] = {"key": made["key"], "id": made["id"]}
    save()


create([(f"leaf-{k:03}", fields(f"leaf-{k:03}", f"Checkout leaf {k:03}", version="checkout"))
        for k in range(1, 106)])
# Hierarchy: epic > story (with subtasks) and a direct task. The epic and the story are dropped;
# the story is hierarchy level 0, and its subtasks, which carry no fix version, are read in its place.
create([("epic", fields("epic", "Epic: payment methods", "Epic", version="checkout"))])
create([("story-with-subtasks", fields("story-with-subtasks", "Card payments story", "Story", "checkout", parent="epic")),
        ("epic-leaf", fields("epic-leaf", "Payment methods direct task", version="checkout", parent="epic"))])
create([(f"subtask-{k}", fields(f"subtask-{k}", f"Card payments subtask {k}", "Subtask", parent="story-with-subtasks"))
        for k in (1, 2, 3)])
create([(r, fields(r, s, version="checkout", labels=l)) for r, s, l in [
    ("reopened-finished", "Reopened then finished again", ()),
    ("reopened-open", "Reopened and still open", ()),
    ("wont-do-1", "Won't do 1", ()),
    ("wont-do-2", "Won't do 2", ()),
    ("duplicate", "Duplicate (Won't do, linked)", ()),
    ("both-queries", "In the fix version and comparable work", ("comparable",)),
    ("bug", "A bug in the fix version", ()),
]])
create([(f"comparable-{k:02}", fields(f"comparable-{k:02}", f"Comparable work {k:02}", labels=("comparable",)))
        for k in range(1, 13)]
       + [(f"ktlo-{k}", fields(f"ktlo-{k}", f"KTLO {k}", labels=("ktlo",))) for k in range(1, 4)]
       + [(f"search-{k}", fields(f"search-{k}", f"Search leaf {k}", version="search")) for k in range(1, 6)])

# Transitions are global in this workflow: one id per target status.
tr = api("GET", f"/rest/api/3/issue/{manifest['issues']['leaf-001']['key']}/transitions")
to = {t["to"]["name"]: t["id"] for t in tr["transitions"]}
manifest["transitions"] = to


def move(role, status):
    api("POST", f"/rest/api/3/issue/{manifest['issues'][role]['key']}/transitions",
        {"transition": {"id": to[status]}})


# Link the duplicate to the ticket it duplicates.
try:
    api("POST", "/rest/api/3/issueLink", {"type": {"name": "Duplicate"},
        "inwardIssue": {"key": manifest["issues"]["duplicate"]["key"]},
        "outwardIssue": {"key": manifest["issues"]["leaf-021"]["key"]}})
except RuntimeError as e:
    print("duplicate link skipped:", e, file=sys.stderr)

# A few in progress, so not every open ticket is To Do.
for k in range(61, 66):
    move(f"leaf-{k:03}", "In Progress")

manifest["batches"]["early_start"] = now()
for k in range(1, 21):
    move(f"leaf-{k:03}", "Done")
for k in range(1, 5):
    move(f"comparable-{k:02}", "Done")
move("reopened-finished", "Done"); move("reopened-open", "Done"); move("ktlo-1", "Done")
manifest["batches"]["early_end"] = now()
save()

time.sleep(150)
manifest["batches"]["cut"] = now()
save()
time.sleep(30)

manifest["batches"]["later_start"] = now()
for k in range(21, 61):
    move(f"leaf-{k:03}", "Done")
for k in range(5, 11):
    move(f"comparable-{k:02}", "Done")
move("subtask-1", "Done"); move("subtask-2", "Done"); move("epic-leaf", "Done"); move("bug", "Done")
move("wont-do-1", "Won't do"); move("wont-do-2", "Won't do"); move("duplicate", "Won't do")
move("both-queries", "Done"); move("search-1", "Done"); move("search-2", "Done")
move("reopened-finished", "To Do"); move("reopened-open", "In Progress")
time.sleep(5)
move("reopened-finished", "Done")
manifest["batches"]["later_end"] = now()
save()
print(json.dumps(manifest["batches"], indent=2))
print("issues:", len(manifest["issues"]))
