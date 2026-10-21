"""Build site/v2/data/concepts.json for the map's concept overlay.

For each of the 4,194 run-1 concepts: the neurons it needs (call "in", the 29,039-neuron stable set), with the log-odds drop
when each is switched off alone, and, where measured, where that neuron's effect on the concept enters (the position split:
share of the effect from positions before the answer; >= 0.7 question side, <= 0.3 answer side, else mixed).

Run from the repo root:  python explainer/gen/v2/build_concepts.py
"""
import json
from pathlib import Path

DATA = Path("D:/already-clean-data")
OUT = Path(__file__).resolve().parents[2] / "site" / "v2" / "data" / "concepts.json"
SPLITS = ["population", "v3any", "p2i", "all158", "heldout"]      # every position-split run; a later file overrides an earlier one
POS = ["not measured", "question side", "answer side", "mixed"]


def lkey(nid):
    L, i = nid[1:].split(":")
    return int(L), int(i)


def main():
    share = {}
    for f in SPLITS:
        d = json.loads((DATA / "jobs/v1" / f"position_split_{f}.json").read_text(encoding="utf-8"))
        for r in d["routes"] if isinstance(d, dict) else d:
            if r.get("share_earlier") is not None:
                share[(r["C"], r["A"])] = r["share_earlier"]
    concepts = []
    for line in (DATA / "core_sets/necessary.jsonl").read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        ns = sorted((n for n in r["neurons"] if n["call"] == "in"), key=lambda n: -n["drop"])
        concepts.append((r["concept"], [(n["neuron"], n["drop"]) for n in ns]))
    ids = sorted({nid for _, ns in concepts for nid, _ in ns}, key=lkey)
    at = {nid: k for k, nid in enumerate(ids)}
    rows, measured = [], 0
    for name, ns in sorted(concepts, key=lambda c: c[0].lower()):
        out = []
        for nid, drop in ns:
            s = share.get((name, nid))
            pos = 0 if s is None else 1 if s >= 0.7 else 2 if s <= 0.3 else 3
            measured += pos > 0
            out.append([at[nid], round(drop * 100), pos])
        rows.append([name, out])
    OUT.write_text(json.dumps({"source": "core_sets/necessary.jsonl (run 1, call 'in') + jobs/v1/position_split_*.json, 21 Oct 2026",
                               "drop": "log-odds drop x 100", "pos": POS, "ids": ids, "concepts": rows}, separators=(",", ":")),
                   encoding="utf-8")
    print(f"{len(rows)} concepts, {len(ids)} neurons, {sum(len(r[1]) for r in rows)} pairs, {measured} with a position split; "
          f"{OUT.stat().st_size / 1e6:.2f} MB -> {OUT}")


if __name__ == "__main__":
    main()
