"""Build site/v2/data/flows.json: flow lines for the map's concept overlay (CPU only, weights + saved results).

Weight links (weights only, not shown to be causal), as in research src/jobs/indirect_trace.py:
  s(A, B) = max(|cos(w_A, g_B * Wgate_B)|, |cos(w_A, g_B * Wup_B)|), w_A = W_down[:, A], g_B = B's post_attention_layernorm
  gain, for B in a later layer than A. Both A and B are neurons the concept needs (core_sets/necessary.jsonl, call "in").
  For each needed B we keep its strongest link from an earlier needed A, if it beats the 99th percentile of the same
  maximum taken over the same earlier A against 256 random neurons in B's layer (the null, matched for how many A
  there are and for the layer).
Tested routes: jobs/v1/mediation2_{all158,heldout_q5,heldout300}.json. A route A -> B -> C is confirmed when restoring B
  after knocking A out undoes damage above the noise floor (recovery_B > 0.145). All tested routes are kept, with that flag.

Run from the repo root:  python explainer/gen/v2/build_flows.py
"""
import json
import os
from pathlib import Path

import numpy as np

DATA = Path("D:/already-clean-data")
MODEL = Path(os.environ.get("JOBS_MODEL", "C:/dev/models/hf/Qwen3-8B"))
SITE = Path(__file__).resolve().parents[2] / "site" / "v2" / "data"
NL, W, NULL_PER_LAYER, FLOOR = 36, 12288, 256, 0.145
ROUTE_FILES = ["mediation2_all158", "mediation2_heldout_q5", "mediation2_heldout300"]   # a later file overrides an earlier one


def lk(nid):
    L, i = nid[1:].split(":")
    return int(L), int(i)


def main():
    import torch
    from safetensors import safe_open
    cx = json.loads((SITE / "concepts.json").read_text(encoding="utf-8"))
    ids, concepts = cx["ids"], cx["concepts"]

    # tested routes; their source neurons may sit outside the concept's needed set, so they get vectors too (not needed here)
    routes = {}
    for f in ROUTE_FILES:
        d = json.loads((DATA / "jobs/v1" / f"{f}.json").read_text(encoding="utf-8"))
        for r in d["routes"] if "routes" in d else [v for k, v in d.items() if k != "_summary"]:
            if not isinstance(r, dict) or r.get("recovery_B") is None or not r.get("B"):
                continue
            routes[(r["C"], r["A"], r["B"])] = {"recovery": round(float(r["recovery_B"]), 3), "drop_A": round(float(r["drop_A"]), 3), "file": f}

    idx = json.loads((MODEL / "model.safetensors.index.json").read_text())["weight_map"]
    files = {}

    def w(name):
        fn = idx[name]
        if fn not in files:
            files[fn] = safe_open(str(MODEL / fn), framework="pt")
        return files[fn].get_tensor(name).float()

    rng = np.random.default_rng(2026)
    by_layer = {}
    for j, nid in enumerate(ids):
        by_layer.setdefault(lk(nid)[0], []).append(j)
    null_cols = {L: rng.choice(W, NULL_PER_LAYER, replace=False) for L in range(NL)}
    WA = np.zeros((len(ids), 4096), np.float16); RG = np.zeros_like(WA); RU = np.zeros_like(WA)
    NG, NU = {}, {}
    unit = lambda X: (X / X.norm(dim=1, keepdim=True)).numpy().astype(np.float16)   # noqa: E731
    for L in range(NL):
        js = by_layer.get(L, [])
        cols = torch.tensor([lk(ids[j])[1] for j in js], dtype=torch.long)
        Wd = w(f"model.layers.{L}.mlp.down_proj.weight")                         # [4096, 12288]
        if js:
            WA[js] = unit(Wd[:, cols].T)
        del Wd
        g = w(f"model.layers.{L}.post_attention_layernorm.weight")
        for nm, R, NR in (("gate_proj", RG, NG), ("up_proj", RU, NU)):
            M = w(f"model.layers.{L}.mlp.{nm}.weight") * g[None, :]               # [12288, 4096]
            if js:
                R[js] = unit(M[cols])
            NR[L] = unit(M[torch.tensor(null_cols[L], dtype=torch.long)])
            del M
        print(f"layer {L}: {len(js)} needed neurons", flush=True)

    # the scoring runs on the GPU when there is one (James, 21 Oct: fine for speed), else on the CPU; same numbers either way
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    tt = lambda X: torch.from_numpy(X).to(dev, torch.float32)                  # noqa: E731
    WAt, RGt, RUt = tt(WA), tt(RG), tt(RU)
    NGt, NUt = {L: tt(v) for L, v in NG.items()}, {L: tt(v) for L, v in NU.items()}
    links, n_links = [], 0
    for ci, (name, rows) in enumerate(concepts):
        js = [r[0] for r in rows]
        Ls = torch.tensor([lk(ids[j])[0] for j in js], device=dev)
        jt = torch.tensor(js, device=dev)
        A, G, U = WAt[jt], RGt[jt], RUt[jt]
        S = torch.maximum((A @ G.T).abs(), (A @ U.T).abs())                    # S[a, b]
        S[Ls[:, None] >= Ls[None, :]] = 0                                       # only earlier -> later
        thr = {}
        for L2 in sorted(set(Ls.tolist())):
            early = Ls < L2
            if early.any():
                Ae = A[early]
                Nm = torch.maximum((Ae @ NGt[L2].T).abs(), (Ae @ NUt[L2].T).abs()).max(0).values
                thr[L2] = float(torch.quantile(Nm, 0.99))
        best, arg = S.max(0)
        out = []
        for bi, (v, ai, Lb) in enumerate(zip(best.tolist(), arg.tolist(), Ls.tolist())):
            if Lb in thr and v > thr[Lb]:
                out.append([js[ai], js[bi], round(v * 1000)])
        links.append(out); n_links += len(out)
        if ci % 500 == 0:
            print(f"concept {ci} / {len(concepts)} ({dev})", flush=True)
    T = None

    by_concept = {}
    for (c, a, b), r in routes.items():
        by_concept.setdefault(c, []).append([a, b, r["recovery"], r["drop_A"], int(r["recovery"] > FLOOR)])
    out = {"source": "weights (Qwen3-8B, CPU) + core_sets/necessary.jsonl + jobs/v1/" + ", ".join(ROUTE_FILES) + "; 21 Oct 2026",
           "link": "s(A,B) = max |cos| of A's write with B's gate / up read rows (through B's MLP input norm), x 1000",
           "null": "per concept and layer: 99th percentile of the max over the same earlier needed neurons against 256 random neurons in that layer", "floor": FLOOR, "links": links,
           "routes": {c: v for c, v in sorted(by_concept.items())}}
    (SITE / "flows.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    nr = sum(len(v) for v in by_concept.values()); nc = sum(x[4] for v in by_concept.values() for x in v)
    print(f"{n_links} weight links over {len(concepts)} concepts; {nr} tested routes ({nc} confirmed) in {len(by_concept)} concepts; "
          f"{(SITE / 'flows.json').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
