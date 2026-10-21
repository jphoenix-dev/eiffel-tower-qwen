"""Add graded-simulation results to the explainer's per-neuron files (run after build_v2_data.py).

Source: the research run's lean graded simulation at scale (jobs/v1/sim_run_full_<part>.json, 21 Oct 2026): every
labelled neuron's gate, + side and - side label; 60 web positions each (12 of its strongest moments + 48 shared positions
stratified over its own activation range); Jev rates each passage from the label alone; own and 5 control labels.
Per part this adds "sim": {"rho": own rank correlation, "ctrl": the control labels' median, "rest": own without the
strongest moments, "ex": a few judged passages [[tail of the passage, judge rating 0-100, real value as % of the
neuron's strongest value here, strongest-moment flag], ...]} and a summary per part to index.json ("sim").

Run from the repo root:  python explainer/gen/v2/build_sim.py
"""
import json
from pathlib import Path

DATA = Path("D:/already-clean-data/jobs/v1")
SITE = Path(__file__).resolve().parents[2] / "site" / "v2" / "data"
PARTS = {"gate": "gate", "apos": "pos", "aneg": "neg"}
TAIL = 70


def examples(e):
    """A fixed selection, not picked by eye: the 2 strongest moments, 2 positions from the middle of the rest (ranked
    by value) and the one nearest zero. Values as % of this part's strongest value here (signed: for the - side, how
    strongly negative)."""
    v, t, top, own = e["value"], e["text"], e["top"], (e["ratings"] or {}).get("own")
    if not own:
        return []
    mx = max(v) if max(v) > 0 else 1.0
    tops = sorted([k for k in range(len(v)) if top[k]], key=lambda k: -v[k])[:2]
    rest = sorted([k for k in range(len(v)) if not top[k]], key=lambda k: -v[k])
    pick = list(tops)
    if rest:
        pick += [rest[len(rest) // 3], rest[2 * len(rest) // 3]]
        z = min(rest, key=lambda k: abs(v[k]))
        if z not in pick:
            pick.append(z)
    tail = lambda s: s if len(s) <= TAIL else "…" + s[-TAIL:]      # noqa: E731
    return [[tail(t[k]), round(own[k]), round(100 * v[k] / mx), int(top[k])] for k in pick]


def main():
    summaries, sims = {}, {}
    for b, key in PARTS.items():
        d = json.loads((DATA / f"sim_run_full_{b}.json").read_text(encoding="utf-8"))
        summaries[key] = d.pop("_summary")
        for u, e in d.items():
            if e.get("kind") == "real" and e.get("rho_own") is not None:
                sims.setdefault(u, {})[key] = {"rho": e["rho_own"], "ctrl": e["rho_control"], "rest": e["rho_own_not_top"], "ex": examples(e)}
        print(f"{b}: {sum(1 for x in sims.values() if key in x)} neurons")
    n = 0
    for f in sorted((SITE / "neurons").glob("L*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        for u, r in d["neurons"].items():
            for key in PARTS.values():
                s = sims.get(u, {}).get(key)
                if s and r.get(key):
                    r[key]["sim"] = s; n += 1
        f.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    idx = json.loads((SITE / "index.json").read_text(encoding="utf-8"))
    idx["sim"] = summaries
    (SITE / "index.json").write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in (SITE / "neurons").glob("L*.json")) / 1e6
    print(f"{n} parts with simulation results; layer files now {size:.1f} MB")


if __name__ == "__main__":
    main()
