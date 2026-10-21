"""Data for the approach explainer's map (explainer/site/v2/): two labelling runs on Qwen3-8B. Reads only; nothing is rerun.

Sets:
  random           the v3 run: 950 neurons drawn at random + 50 "bridge" neurons shared with an earlier run (set "bridge")
  knockout-linked  the v3x full run, scope (b): 10,000 neurons that knockouts had already tied to concepts. Its 768
                   "sides-only" pool neurons (no gate board) are left out: none of them is in either set.

Sources:
  v3_results.json  (v3_combine.py) - v3 labels, label exam (AUC vs control descriptions, verified), generative check (pass),
      job type per side, knockout profile, triage, scorecard
  v3x_results.json (v3x_combine.py) - the same per-neuron verdicts and triage for v3x (no scorecard, job type or knockouts)
  intelligibility_v3x_pq_<part>.json + gen_check_v3x_pq_<part>_surf.json - the v3x fake neurons (pseudo-neurons)
  jobtype_v3.npz - job type per side for v3x, from the weights: cosine >= 0.2 amplifier, <= -0.2 eraser, else redirector
  the ledger - the words Luna generated for the generative check (and their AUC), the concepts that break when the neuron is
      switched off (drop >= 0.3 log-odds), and for v3x the knockout profile by the v3 rule (modelmapper/scorecard.py,
      knockout_from_ledger + knockout_profile, copied below)
  the weights (CPU) - the words each side of the launcher pushes towards: +down and -down through the final norm and the
      output table (logit lens; a direct reading, unreliable before layer 20 where effects are indirect)
Also a short form of each label (its first phrase) for the one-line summary and the search.

Writes (explainer/site/v2/data/):
  index.json          both runs' headline numbers + one compact row per neuron for the map and the pane's first lines
  neurons/L<k>.json   everything else, per layer, loaded by the page on hover or pin

Usage: python -I -X utf8 explainer/gen/v2/build_v2_data.py   (env LEDGER, JOBS_DIR, JOBS_MODEL to override)
"""
import json
import os
import re
import statistics
from pathlib import Path

import duckdb
import numpy as np

LEDGER = os.environ.get("LEDGER", "D:/already-clean-data/ledger/ledger.duckdb")
JOBS = Path(os.environ.get("JOBS_DIR", "D:/already-clean-data/jobs/v1"))
SITE = Path(__file__).resolve().parents[2] / "site" / "v2" / "data"
MODEL = Path(os.environ.get("JOBS_MODEL", "C:/dev/models/hf/Qwen3-8B"))
PARTS = {"gate": "gate", "apos": "pos", "aneg": "neg"}
N_TERMS = 20   # associated terms kept per part (of the 40 Luna saw): 20 add about 7 MB to the layer files, 40 would add 14
N_GEN_WORDS, N_CONCEPTS, KO_MIN, N_PUSH = 14, 8, 0.3, 8
MAX_SHORT = 120
LEADS = ("Tokens are strongly associated with ", "Tokens are associated with ", "Tokens relate to ", "Tokens related to ",
         "Tokens are centered on ", "Tokens center on ", "Tokens refer to ", "Tokens mostly relate to ", "Strongly associated with ",
         "Associated with ", "Related to ", "Mostly ", "Primarily associated with ", "Centers on ", "Words and word pieces related to ",
         "The clearest cluster is ", "The clearest signal is ", "A cluster of ", "Strongly associated with ")
# index codes (the page decodes them with the lists written next to the rows)
SETS = ["random", "bridge", "knockout-linked"]
TRIAGE = ["clear", "one-sided", "pattern-not-named", "unexplained"]
KO_PROFILES = ["untested", "no effect", "weak", "effect"]
# knockout profile, the v3 rule (modelmapper/scorecard.py)
JOB_CUT, EFFECT = 0.2, 0.301
E7_LIKE = ("loop_v4_E7", "loop_v3_e7_pilot", "mech_inhibitors_06b", "mech_inhibitors_06b_retest")


def short_label(text: str) -> str:
    """The label's first sentence, without bracketed asides: 'A loose mix of animal names (especially sharks...) and
    superhero names, including Batman. ...' -> 'A loose mix of animal names and superhero names, including Batman.' Cut
    only at a sentence end, so a mixed label keeps its second theme; anything longer than MAX_SHORT ends in a visible
    ellipsis. The page shows it as a summary of the full label beside it, never instead of it."""
    t = (text or "").strip()
    t = re.sub(r"^(?:[AB]: )?(?:Tokens|Words)(?: are)?(?: strongly| mostly| predominantly| largely)? (?:associated with|related to|relate to|"
               r"referring to|refer to|centered on|center on|denote|about) ", "", t)
    for lead in LEADS:
        if t.startswith(lead):
            t = t[len(lead):]; break
    t = re.sub(r"\s*\([^()]*\)", "", t)                                   # bracketed asides
    end = len(t)
    for m in re.finditer(r"[.!?](?=\s|$)", t):                          # the first real sentence end, not "U.S." or "e.g."
        word = t[:m.start()].rsplit(" ", 1)[-1]
        if not re.fullmatch(r"(?:[A-Za-z]\.)*[A-Za-z]|etc|vs|approx|St|Dr|Mr|Mrs|Ms|No", word):
            end = m.start(); break
    t = t[:end].strip(" ,;:")
    if len(t) > MAX_SHORT:
        t = t[:MAX_SHORT].rsplit(" ", 1)[0].rstrip(" .,;:") + "…"
    return re.sub(r"^(A|An|The) ", lambda m: m.group(1).lower() + " ", t)   # reads on after "opens for"


def push_words(units: list[str], n: int = N_PUSH) -> dict[str, tuple[list[str], list[str]]]:
    """Words each neuron's +down and -down most raise, read straight off the weights (logit lens). One matrix product per layer."""
    import torch
    from safetensors import safe_open
    from transformers import AutoTokenizer
    idx = json.loads((MODEL / "model.safetensors.index.json").read_text())["weight_map"]

    def w(k):
        with safe_open(str(MODEL / idx[k]), "pt") as f:
            return f.get_tensor(k).float()
    tok = AutoTokenizer.from_pretrained(str(MODEL))
    cache: dict[int, str] = {}
    dec = lambda t: cache.setdefault(t, tok.decode([t]).strip())
    words = lambda ids: list(dict.fromkeys(dec(int(t)) for t in ids if dec(int(t))))[:n]
    WU, norm = w("lm_head.weight"), w("model.norm.weight")
    by_layer: dict[int, list[tuple[str, int]]] = {}
    for u in units:
        L, i = map(int, u[1:].split(":")); by_layer.setdefault(L, []).append((u, i))
    out = {}
    with torch.no_grad():
        for L, items in sorted(by_layer.items()):
            D = w(f"model.layers.{L}.mlp.down_proj.weight")[:, [i for _, i in items]]       # [hidden, k]
            logits = WU @ (D * norm[:, None])                                                 # [vocab, k]
            up, down = logits.topk(4 * n, dim=0).indices.T.tolist(), (-logits).topk(4 * n, dim=0).indices.T.tolist()
            for j, (u, _) in enumerate(items):
                out[u] = (words(up[j]), words(down[j]))
            print(f"  pushes: layer {L}, {len(items)} neurons", flush=True)
    return out


def knockout_profile(n_concepts, max_drop, nulls) -> str:
    if not n_concepts:
        return "untested"
    thr = float(np.quantile(nulls, 1 - 0.05 / max(1, n_concepts)))
    return "effect" if max_drop >= max(EFFECT, thr) else "no effect" if max_drop < thr else "weak"


def knockout_from_ledger(c, neurons: list[str]) -> dict[str, str]:
    ko = {r[0]: (r[1], r[2]) for r in c.execute(
        f"""SELECT unit_key, count(DISTINCT concept_id), max(value) FROM evidence
            WHERE evidence_type = 'knockout_drop' AND metric = 'mean_logodds_drop' AND experiment_id NOT IN {E7_LIKE!r}
            AND unit_key IN (SELECT unnest(?)) GROUP BY unit_key""", [list(neurons)]).fetchall()}
    nulls = np.array([r[0] for r in c.execute(
        f"""SELECT value FROM evidence WHERE evidence_type = 'null_knockout_drop' AND metric = 'mean_logodds_drop'
            AND experiment_id NOT IN {E7_LIKE!r}""").fetchall()], float)
    return {u: knockout_profile(*ko.get(u, (None, None)), nulls) for u in neurons}


def job_type(c: float) -> str:
    return "amplifier" if c >= JOB_CUT else "eraser" if c <= -JOB_CUT else "redirector"


def clean_words(tokens) -> list[str]:
    return list(dict.fromkeys(w.strip() for w in tokens if w.strip() and "\ufffd" not in w))[:N_GEN_WORDS]


# James, 21 Oct 2026, post hoc (backed by the corpus exam): labels that passed both exams but whose controls scored above
# 0.65 ("decoys too easy") count as verified, flagged "at the edge" (lower confidence)
EDGE_BIN = "decoys-too-easy (intelligible)"
VERIFIED_BINS = ("intelligible", EDGE_BIN)


def r3(x):
    return None if x is None else round(float(x), 3)


def headline(neurons: list[dict], pseudo: dict, extra: dict, ko_neurons: list[dict] | None = None) -> dict:
    """The numbers the page shows for one run, computed from the per-neuron records. Rates are over `neurons`; the knockout
    counts over `ko_neurons` (default the same)."""
    n = len(neurons)
    share = lambda f: {k: round(sum(1 for x in neurons if f(x[k])) / n, 4) for k in PARTS.values()}
    bands = {}
    for b, lo, hi in (("early", 0, 11), ("middle", 12, 23), ("late", 24, 35)):
        us = [x for x in neurons if lo <= x["L"] <= hi]
        bands[b] = round(sum(x["gate"]["verified"] for x in us) / max(1, len(us)), 4)
    ko_neurons = ko_neurons or neurons
    tri = {t: sum(1 for x in ko_neurons if x["triage"] == t) for t in TRIAGE}
    tested = [x for x in ko_neurons if x["ko_profile"] != "untested"]
    junk = [x for x in tested if not any(x[k]["verified"] for k in PARTS.values()) and x["ko_profile"] == "no effect"]
    return {"n": n, "verified": share(lambda p: p["verified"]), "edge": share(lambda p: p.get("edge")),
            "exam_gen": share(lambda p: p["verified"] and p["gen"] is True),
            "ctrl_median": {k: r3(statistics.median(x[k]["ctrl"] for x in neurons if x[k]["ctrl"] is not None)) for k in PARTS.values()},
            "gate_by_band": bands, "triage": tri, "n_ko": len(ko_neurons), "ko_tested": len(tested), "ko_breaks": sum(1 for x in ko_neurons if x["ko"]),
            "candidate_junk": len(junk), "pseudo": pseudo, **extra}


def pseudo_rates(run: str) -> dict:
    """A run's fake neurons: share verified (at the edge included), at the edge, and verified + generative check."""
    out = {"n": {}, "verified": {}, "edge": {}, "exam_gen": {}}
    for b, k in PARTS.items():
        d = json.loads((JOBS / f"intelligibility_{run}_pq_{b}.json").read_text(encoding="utf-8")); d.pop("_summary", None)
        g = json.loads((JOBS / f"gen_check_{run}_pq_{b}_surf.json").read_text(encoding="utf-8")); g.pop("_summary", None)
        ok = [u for u, r in d.items() if r.get("bin") in VERIFIED_BINS]
        out["n"][k] = len(d)
        out["verified"][k] = round(len(ok) / len(d), 4)
        out["edge"][k] = round(sum(1 for u in ok if d[u].get("bin") == EDGE_BIN) / len(d), 4)
        out["exam_gen"][k] = round(sum(1 for u in ok if g.get(u, {}).get("pass")) / len(d), 4)
    return out


def load_details(site: Path = SITE) -> dict[str, dict]:
    """Every neuron's full record, from the per-layer files (for build_examples.py)."""
    out = {}
    for f in sorted((site / "neurons").glob("L*.json")):
        out.update(json.loads(f.read_text(encoding="utf-8"))["neurons"])
    return out


def main():
    v3 = json.loads((JOBS / "v3_results.json").read_text(encoding="utf-8"))
    v3x = {u: r for u, r in json.loads((JOBS / "v3x_results.json").read_text(encoding="utf-8")).items() if u != "_note"}
    sides_only = [u for u, r in v3x.items() if "gate" not in r]
    v3x = {u: r for u, r in v3x.items() if "gate" in r}
    assert not set(v3x) & set(v3["neurons"]), "the two sets overlap"
    assert not set(sides_only) & set(v3["neurons"]), "a sides-only neuron is in the random set"
    keys = list(v3["neurons"]) + list(v3x)
    print(f"random {len(v3['neurons'])}, knockout-linked {len(v3x)}; left out {len(sides_only)} sides-only neurons (in neither set)")

    c = duckdb.connect(LEDGER, read_only=True)
    q = lambda s, *a: c.execute(s, list(a)).fetchall()
    gen_exps = [e for (e,) in q("select distinct experiment_id from evidence where metric = 'generative_auc' and "
                                "(experiment_id like 'jobs_v1_v3_gen_%' or experiment_id like 'jobs_v1_v3pilot_gen_%' "
                                "or experiment_id like 'jobs_v1_v3x%_gen_%')")]
    gen = {}                                                             # (experiment, neuron) -> (words, auc)
    for e, u, auc, d in q("select experiment_id, unit_key, value, details from evidence where metric = 'generative_auc' "
                          "and experiment_id in (select unnest(?))", gen_exps):
        d = json.loads(d) if isinstance(d, str) else (d or {})
        gen[(e, u)] = (clean_words(d.get("tokens", [])), auc)
    labels = dict(q("select concept_id, label from concepts"))
    summ = {u: tc for u, tc in q("select unit_key, top_concepts from unit_summary "
                                 "where unit_kind = 'neuron' and unit_key in (select unnest(?))", keys)}
    ko_prof = knockout_from_ledger(c, keys)
    jt = np.load(JOBS / "jobtype_v3.npz")
    pushes = push_words(keys)

    # from each exam run's file (the combined results keep neither): the token-list exam's own and control scores, and the
    # favourite tokens Luna was shown when writing the label (strongest first, hub tokens already removed)
    exams = {}

    def list_scores(tag, u, exam):
        if tag not in exams:
            f = JOBS / f"intelligibility_{tag}.json"
            exams[tag] = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        r = exams[tag].get(u)
        if not r or r.get("auc_own") is None or abs(r["auc_own"] - exam) > 1e-6:      # only from the run the verdict came from
            return None, None, []
        shown = [t for t in r.get("shown", []) if "�" not in t and t.strip("␣ ")]
        return r3(r.get("list_auc_own")), r3(r.get("list_auc_control")), shown[:N_TERMS]

    def part(p, label, exam, words_auc, lx=(None, None, [])):
        ws, ga = words_auc
        return {"label": label, "short": short_label(label), "bin": p["bin"], "exam": r3(exam), "ctrl": r3(p["auc_control"]),
                "list": p.get("list_pass"), "lexam": lx[0], "lctrl": lx[1], "terms": lx[2],
                "verified": bool(p["verified"]) or p["bin"] == EDGE_BIN, "edge": p["bin"] == EDGE_BIN, "gen": p["gen_pass"], "words": ws, "gen_auc": r3(ga)}

    neurons, ko_agree = [], [0, 0]
    for u in keys:
        L, i = map(int, u[1:].split(":"))
        if u in v3["neurons"]:
            r = v3["neurons"][u]
            st = "bridge" if r["set"] == "bridge" else "random"
            # v3's generative-check words: the v3 run, else its pilot
            g = lambda b: next((gen[(e, u)] for e in (f"jobs_v1_v3_gen_{b}", f"jobs_v1_v3pilot_gen_{b}") if (e, u) in gen), ([], None))
            n = {"id": u, "L": L, "set": st, "triage": r["triage"]["read"]}
            for b, k in PARTS.items():
                lx = next((x for x in (list_scores(t, u, r[b]["auc"]) for t in (f"v3_{b}", f"v3pilot_{b}")) if x[0] is not None), (None, None, []))
                n[k] = part(r[b], r[b]["label"], r[b]["auc"], g(b), lx)
            j = r["jobtype"]
            n["job"] = {"pos": j["apos"], "neg": j["aneg"], "c_pos": j["c_pos"], "c_neg": j["c_neg"]}
            n["ko_profile"] = r["knockout"]["profile"]
            ko_agree[0] += n["ko_profile"] == ko_prof[u]; ko_agree[1] += 1
        else:
            r = v3x[u]
            n = {"id": u, "L": L, "set": "knockout-linked", "triage": r["triage"]}
            for b, k in PARTS.items():
                p = r[b]
                e = "jobs_v1_" + re.sub(rf"_{b}$", f"_gen_{b}", p["run"])     # v3x_c0_gate -> jobs_v1_v3x_c0_gen_gate
                n[k] = part(p, p["description"], p["auc_own"], gen.get((e, u), ([], None)), list_scores(p["run"], u, p["auc_own"]))
            cp, cn = float(jt["c_pos"][L, i]), float(jt["c_neg"][L, i])
            n["job"] = {"pos": job_type(cp), "neg": job_type(cn), "c_pos": round(cp, 3), "c_neg": round(cn, 3)}
            n["ko_profile"] = ko_prof[u]
        n["pushes"], n["pushes_neg"] = pushes[u]
        n["ko"] = [{"c": labels.get(t["concept_id"], t["concept_id"]), "drop": round(t["drop"], 2)}
                   for t in (summ.get(u) or []) if (t.get("drop") or 0) >= KO_MIN][:N_CONCEPTS]
        neurons.append(n)
    neurons.sort(key=lambda n: (n["L"], int(n["id"].split(":")[1])))
    missing_words = sum(1 for n in neurons for k in PARTS.values() if n[k]["gen"] is not None and not n[k]["words"])
    print(f"v3 knockout profile recomputed by the v3 rule agrees with v3_results.json on {ko_agree[0]} / {ko_agree[1]}; "
          f"checked labels without generative-check words: {missing_words}")

    rand = [n for n in neurons if n["set"] != "knockout-linked"]
    kol = [n for n in neurons if n["set"] == "knockout-linked"]
    s = v3["scorecard"]
    runs = {
        "random": headline([n for n in rand if n["set"] == "random"], pseudo_rates("v3"),
                           {"run": "v3", "n_new": sum(n["set"] == "random" for n in rand), "n_bridge": sum(n["set"] == "bridge" for n in rand),
                            "minutes": 37, "usd": 7.29}, ko_neurons=rand),
        "knockout-linked": headline(kol, pseudo_rates("v3x"), {"run": "v3x", "minutes": 124, "usd": 78}),
    }
    # the v3 rates, without the post-hoc "at the edge" labels, must match its own scorecard
    a = runs["random"]
    pre = {k: a["verified"][k] - a["edge"][k] for k in a["verified"]}
    assert abs(pre["gate"] - s["P2_gate_verified"]["share"]) < 0.0051, (pre, s["P2_gate_verified"])
    for b in ("apos", "aneg"):
        assert abs(pre[PARTS[b]] - s["P3"]["side_exam_verified"][b]) < 0.0051
        assert abs(a["exam_gen"][PARTS[b]] - s["P3"]["side_sign_verified"][b]) < 0.0051
    assert abs(a["exam_gen"]["gate"] - s["P3"]["gate_exam_and_gen"]) < 0.0051

    code = lambda p: 0 if not p["verified"] else 1 if p["gen"] is None else 2 if p["gen"] is False else 3
    rows = [[n["id"], SETS.index(n["set"]), TRIAGE.index(n["triage"]), "".join(str(code(n[k])) for k in PARTS.values()),
             len(n["ko"]), KO_PROFILES.index(n["ko_profile"]), *[n[k]["short"] for k in PARTS.values()]] for n in neurons]
    index = {"source": "v3_results.json (v3 run) and v3x_results.json (v3x run), 21 Oct 2026, + ledger + weights",
             "runs": runs, "scorecard_v3": s, "sets": SETS, "triage": TRIAGE, "ko_profiles": KO_PROFILES,
             "cols": ["id", "set", "triage", "parts (gate, +, -: 0 not verified, 1 verified, 2 + generative check failed, "
                      "3 + generative check passed)", "concepts broken", "knockout profile", "short gate", "short +", "short -"],
             "neurons": rows}
    SITE.mkdir(parents=True, exist_ok=True)
    (SITE / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    nd = SITE / "neurons"; nd.mkdir(exist_ok=True)
    for f in nd.glob("L*.json"):
        f.unlink()
    sizes = []
    for L in range(36):
        ns = {n["id"]: n for n in neurons if n["L"] == L}
        f = nd / f"L{L}.json"
        f.write_text(json.dumps({"layer": L, "neurons": ns}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        sizes.append(f.stat().st_size)
    old = SITE / "v3.json"
    if old.exists():
        old.unlink()
    for k, r in runs.items():
        print(f"{k}: n {r['n']}; verified {r['verified']}; exam + gen {r['exam_gen']}; pseudo {r['pseudo']}; ctrl {r['ctrl_median']}; "
              f"bands {r['gate_by_band']}; triage {r['triage']}; knockout tested {r['ko_tested']}, breaks {r['ko_breaks']}, "
              f"candidate junk {r['candidate_junk']}")
    print(f"wrote {SITE / 'index.json'} ({(SITE / 'index.json').stat().st_size / 1e6:.2f} MB) and {len(sizes)} layer files "
          f"({min(sizes) / 1e6:.2f}-{max(sizes) / 1e6:.2f} MB, {sum(sizes) / 1e6:.1f} MB in all)")


if __name__ == "__main__":
    main()
