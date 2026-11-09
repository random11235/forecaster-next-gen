#!/usr/bin/env python3
"""Seed the synthetic GitHub repo with the cases Seam C's contract suite records.

Usage: seed_github.py <owner/repo> <manifest.json>
Uses the caller's `gh` auth (write). Synthetic data only.
Paced to stay under GitHub's secondary content-creation limits.
"""
import json, subprocess, sys, time
from datetime import datetime, timezone

REPO, MANIFEST = sys.argv[1], sys.argv[2]
PACE = 1.2  # seconds between writes
manifest = {"repo": REPO, "issues": {}, "batches": {}}


def gh(*args, input_=None):
    out = subprocess.run(["gh", "api", *args], capture_output=True, text=True, input=input_)
    if out.returncode != 0:
        raise RuntimeError(f"gh api {' '.join(args)}\n{out.stderr}")
    return json.loads(out.stdout) if out.stdout.strip() else None


def write(*args, body=None):
    time.sleep(PACE)
    if body is not None:
        return gh(*args, "--input", "-", input_=json.dumps(body))
    return gh(*args)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def save():
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, indent=2)


# Labels and milestones
for name, color in [("epic", "5319e7"), ("comparable", "0e8a16"), ("ktlo", "bfdadc")]:
    write(f"repos/{REPO}/labels", "--method", "POST", body={"name": name, "color": color})
m1 = write(f"repos/{REPO}/milestones", "--method", "POST",
           body={"title": "Checkout v2", "description": "Synthetic milestone with more leaf tickets than one page."})
m2 = write(f"repos/{REPO}/milestones", "--method", "POST",
           body={"title": "Search revamp", "description": "Second open milestone for milestoneChoices()."})
m0 = write(f"repos/{REPO}/milestones", "--method", "POST",
           body={"title": "Onboarding (done)", "state": "closed", "description": "Closed milestone."})
manifest["milestones"] = {"checkout": m1["number"], "search": m2["number"], "onboarding_closed": m0["number"]}
save()


def issue(role, title, milestone=None, labels=()):
    body = {"title": title, "body": f"Synthetic ticket. Role: `{role}`.", "labels": list(labels)}
    if milestone:
        body["milestone"] = milestone
    i = write(f"repos/{REPO}/issues", "--method", "POST", body=body)
    manifest["issues"][role] = {"number": i["number"], "id": i["id"], "node_id": i["node_id"]}
    save()
    return i


def close(role, reason="completed", duplicate_of=None):
    n = manifest["issues"][role]["number"]
    body = {"state": "closed", "state_reason": reason}
    try:
        write(f"repos/{REPO}/issues/{n}", "--method", "PATCH", body=body)
    except RuntimeError as e:
        if reason != "duplicate":
            raise
        print("duplicate state_reason refused, using not_planned:", e, file=sys.stderr)
        manifest["issues"][role]["duplicate_fallback"] = True
        write(f"repos/{REPO}/issues/{n}", "--method", "PATCH",
              body={"state": "closed", "state_reason": "not_planned"})
    if duplicate_of:
        write(f"repos/{REPO}/issues/{n}/comments", "--method", "POST",
              body={"body": f"Duplicate of #{manifest['issues'][duplicate_of]['number']}"})


def reopen(role):
    n = manifest["issues"][role]["number"]
    write(f"repos/{REPO}/issues/{n}", "--method", "PATCH", body={"state": "open"})


def sub(parent, child):
    p, c = manifest["issues"][parent]["number"], manifest["issues"][child]["id"]
    write(f"repos/{REPO}/issues/{p}/sub_issues", "--method", "POST", body={"sub_issue_id": c})


M = m1["number"]
# 105 plain leaves in Checkout v2: with the cases below, well over 100 leaves, so paging is recorded.
for k in range(1, 106):
    issue(f"leaf-{k:03}", f"Checkout leaf {k:03}", M)

# Hierarchy: epic E (label epic) > parent P > leaves; E also holds a direct leaf. E and P are dropped.
issue("epic", "Epic: payment methods", M, ["epic"])
issue("parent", "Parent: card payments", M)
for k in (1, 2, 3):
    issue(f"child-{k}", f"Card payments child {k}", M)
issue("epic-leaf", "Payment methods direct leaf", M)
sub("epic", "parent")
sub("epic", "epic-leaf")
for k in (1, 2, 3):
    sub("parent", f"child-{k}")

# Reopen cases
issue("reopened-finished", "Reopened then finished again", M)
issue("reopened-open", "Reopened and still open", M)

# Close-reason cases
issue("not-planned-1", "Closed as not planned 1", M)
issue("not-planned-2", "Closed as not planned 2", M)
issue("duplicate", "Closed as duplicate", M)

# In both queries: milestone and comparable-work label
issue("both-queries", "In the milestone and comparable work", M, ["comparable"])

# Comparable work only (no milestone), and KTLO that matches neither
for k in range(1, 13):
    issue(f"comparable-{k:02}", f"Comparable work {k:02}", None, ["comparable"])
for k in range(1, 4):
    issue(f"ktlo-{k}", f"KTLO {k}", None, ["ktlo"])

# Second milestone, a few tickets
for k in range(1, 6):
    issue(f"search-{k}", f"Search leaf {k}", m2["number"])

# --- Finishes, in time-separated batches so a finishedSince can fall between them ---
manifest["batches"]["early_start"] = now()
for k in range(1, 21):
    close(f"leaf-{k:03}")
for k in range(1, 5):
    close(f"comparable-{k:02}")
close("reopened-finished")          # first finish, early
close("reopened-open")              # first finish, early
close("ktlo-1")
manifest["batches"]["early_end"] = now()
save()

time.sleep(150)
manifest["batches"]["cut"] = now()  # a finishedSince between early and later finishes
save()
time.sleep(30)

manifest["batches"]["later_start"] = now()
for k in range(21, 61):
    close(f"leaf-{k:03}")
for k in range(5, 11):
    close(f"comparable-{k:02}")
close("child-1"); close("child-2"); close("epic-leaf")
close("not-planned-1", "not_planned"); close("not-planned-2", "not_planned")
close("duplicate", "duplicate", duplicate_of="leaf-021")
close("both-queries")
close("search-1"); close("search-2")
reopen("reopened-finished"); reopen("reopened-open")
time.sleep(5)
close("reopened-finished")          # last finish, later
manifest["batches"]["later_end"] = now()
save()
print(json.dumps(manifest["batches"], indent=2))
print("issues:", len(manifest["issues"]))
