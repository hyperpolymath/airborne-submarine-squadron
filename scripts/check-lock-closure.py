#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
"""check-lock-closure.py — local re-statement of the three clauses of the RSR template's
scripts/check-lock-sync.sh (which needs gawk), for machines without it:

  1. every step-level `uses:` in a workflow is locked under THAT workflow's own path;
  2. every `workflows:` entry is still referenced by its workflow (no orphans);
  3. every ref NAMED anywhere in the lockfile resolves to a `dependencies:` record (transitive closure).

Clause 3 is the fatal one: a ref PRESENT in the lockfile but unresolvable makes GitHub refuse to start the
workflow (startup_failure, zero jobs) while every local gate stays green.  Also checks that each SHA-pinned
`uses:` carries a `# <ref>` comment agreeing with the lock record.

stdlib-only (no PyYAML): the lock format is a fixed, simple shape.
"""
import glob, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCK = os.path.join(ROOT, ".github/workflows/actions.lock")
USES = re.compile(r"^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s*#\s*(\S+))?", re.M)

def norm(u):            # owner/repo/sub@ref -> owner/repo@ref
    return re.sub(r"^([^/@]+/[^/@]+)(?:/[^@]+)?@", r"\1@", u)

def parse_lock(text):
    workflows, deps, cur, sect, sub = {}, {}, None, None, None
    for line in text.splitlines():
        if line.startswith("workflows:"): sect = "w"; continue
        if line.startswith("dependencies:"): sect = "d"; continue
        m = re.match(r"^    '([^']+)':\s*(\[\])?$", line)
        if m:
            cur = m.group(1); sub = None
            (workflows if sect == "w" else deps).setdefault(cur, [] if sect == "w" else {"uses": []})
            continue
        m = re.match(r"^        - '([^']+)'$", line)
        if m and sect == "w": workflows[cur].append(m.group(1)); continue
        if sect == "d":
            if re.match(r"^        uses:\s*$", line): sub = "uses"; continue
            m = re.match(r"^            - '([^']+)'$", line)
            if m and sub == "uses": deps[cur]["uses"].append(m.group(1)); continue
            m = re.match(r"^        (\w+):\s*'?([^']*)'?$", line)
            if m: sub = None; deps[cur][m.group(1)] = m.group(2)
    return workflows, deps

def main():
    workflows, deps = parse_lock(open(LOCK).read())
    errors = []
    actual = {}
    for f in sorted(glob.glob(os.path.join(ROOT, ".github/workflows/*.yml"))):
        txt = open(f).read(); name = ".github/workflows/" + os.path.basename(f)
        refs = {}
        for m in USES.finditer(txt):
            u = m.group(1)
            if u.startswith(("./", "docker://", "hyperpolymath/standards/")): continue
            refs[norm(u)] = (m.group(2) or "")
        actual[name] = refs
    for name, refs in actual.items():                                                   # clause 1
        locked = set(workflows.get(name, []))
        for r in refs:
            if r not in locked: errors.append(f"clause 1: {name}: `{r}` is used but not locked")
    for name, locked in workflows.items():                                              # clause 2
        if name not in actual: errors.append(f"clause 2: lock lists workflow {name} which does not exist"); continue
        for r in locked:
            if r not in actual[name]: errors.append(f"clause 2: {name}: lock entry `{r}` is no longer referenced (orphan)")
    named = {r for lst in workflows.values() for r in lst} | {n for d in deps.values() for n in d["uses"]}
    for r in sorted(named):                                                             # clause 3
        if r not in deps: errors.append(f"clause 3 (FATAL): `{r}` is named in the lock but has no dependencies: record — GitHub will refuse to start the workflow")
    for name, refs in actual.items():                                                   # comment/record agreement
        for r, comment in refs.items():
            d = deps.get(r)
            if d and comment and d.get("ref") != comment:
                errors.append(f"comment mismatch: {name}: `{r}` says `# {comment}` but the lock records ref {d.get('ref')}")
            sha = r.split("@", 1)[1]
            if d and d.get("commit") != f"sha1-{sha}": errors.append(f"commit mismatch for {r}: lock says {d.get('commit')}")
    if errors:
        print("actions.lock problems:"); [print("  -", e) for e in errors]; sys.exit(1)
    print(f"actions.lock OK: {sum(len(v) for v in actual.values())} direct refs in {len(actual)} workflows; {len(deps)} dependency records; transitively closed")

if __name__ == "__main__":
    main()
