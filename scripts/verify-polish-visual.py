#!/usr/bin/env python3
"""Verify visual-review receipts and original PNG hashes using only stdlib.

Usage: python3 scripts/verify-polish-visual.py audit
Earlier inspection receipts are carried only for byte-identical image pairs.
This validates evidence integrity, not a replacement for human visual judgment.
"""
from pathlib import Path
import hashlib
import json
import sys


def read(path):
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inspected_sheets(stage):
    review = read(stage / "visual-contact-sheets/review.json")
    result = {}
    for folder, key in [("visual-contact-sheets", "sheets"), ("visual-changed-sheets", "changedSheets")]:
        if not review.get(key):
            continue
        manifests = {m["file"]: m for m in read(stage / folder / "manifest.json")}
        for receipt in review[key]:
            name = receipt["file"]
            manifest = manifests[name]
            assert digest(stage / folder / name) == receipt["sha256"], name
            assert receipt["states"] == [s["id"] for s in manifest["states"]], name
            assert receipt["note"].strip() and receipt["note"].lower() != "placeholder", name
            for state in manifest["states"]:
                result[(manifest["setup"], state["id"], folder, name)] = state
    return review, result


def manifest_states(stage):
    result = {}
    for sheet in read(stage / "visual-contact-sheets/manifest.json"):
        for state in sheet["states"]:
            key = (sheet["setup"], state["id"])
            assert key not in result, key
            result[key] = state
    return result


def same_pair(a, b):
    return all(a[k] == b[k] for k in ["viewportSha256", "fullSha256"])


def verify_stage(stage, prior=None, actual_images=False, require_complete=True):
    review, sheets = inspected_sheets(stage)
    manifest = manifest_states(stage)
    if "states" not in review:  # Original discovery receipts cover a subset.
        return {(setup, sid): state for (setup, sid, _, _), state in sheets.items()}
    verified = {}
    for row in review["states"]:
        key = (row["setup"], row["id"])
        assert key not in verified, key
        state = manifest[key]
        assert same_pair(row, state), key
        if "byte-identical" in row["method"]:
            assert prior is not None and key in prior and same_pair(row, prior[key]), key
        else:
            sheet = row["sheet"]
            folder = "visual-changed-sheets" if "visual-changed-sheets" in sheet else "visual-contact-sheets"
            inspected = sheets[(key[0], key[1], folder, Path(sheet).name)]
            assert same_pair(row, inspected), key
        if actual_images:
            assert digest(stage / state["source"]) == state["viewportSha256"], key
            assert digest(stage / state["fullSource"]) == state["fullSha256"], key
            capture = read(stage / "after" / key[0] / (key[1] + ".json"))
            assert capture["metrics"]["entryScript"] == state["entryScript"], key
            assert sorted(capture["metrics"]["stylesheets"]) == sorted(state["stylesheets"]), key
        verified[key] = state
    if require_complete:
        assert review["complete"] is True and set(verified) == set(manifest), "Incomplete visual review"
        assert review["reviewedStates"] == len(verified) == 980, "Incorrect inventory count"
    return verified


def verify(root):
    discovery = root / "visual-discovery"
    first = verify_stage(discovery / "v1", require_complete=False)
    second = verify_stage(discovery / "v2", prior=first)
    final = verify_stage(root, prior=second, actual_images=True)
    return {"status": "pass", "states": len(final), "method": "Actual PNG pairs, fresh capture identities and recursively verified visual inspection receipts"}


if __name__ == "__main__":
    print(json.dumps(verify(Path(sys.argv[1] if len(sys.argv) > 1 else "audit").resolve())))
