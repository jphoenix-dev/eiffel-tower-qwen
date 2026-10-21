"""Worked examples for Figure 1 (explainer/site/v2/): real gate and ruler (up) readings for a few neurons, from the
saved vocabulary sweep (vocab_sweep_v2). CPU only; reads saved files, runs no model.

For each example neuron, in one template sentence of the sweep's panel, the words it reads come from its own favourite
lists (top by gate, strongest + side, strongest - side), each with its exact gate and up values, plus the average
token (gate mean over all ~151k tokens). The bike neuron is in the sweep's full-profile sample, so any word can be
read for it. Also writes the 12 template sentences (for the page's hover). Labels come from data/neurons/ (v3 run) or,
for the bike neuron, the ledger (its labels are from the earlier gate and up-axis exams).

Usage: python -I -X utf8 explainer/gen/v2/build_examples.py   (after build_v2_data.py)
"""
import json
import math
import re
import os
import sys
from pathlib import Path

import numpy as np

JOBS = Path(os.environ.get("JOBS_DIR", "D:/already-clean-data/jobs/v1"))
MODEL = os.environ.get("JOBS_MODEL", "C:/dev/models/hf/Qwen3-8B")
RESEARCH = Path(os.environ.get("RESEARCH_SRC", "C:/dev/already-clean-research/src/jobs"))
SITE = Path(__file__).resolve().parents[2] / "site" / "v2" / "data"
CTX, READ = 2, "slot"          # "She spent the whole afternoon talking about [X] with her friends." read at [X]
EXAMPLES = [("L31:10454", "Bikes"), ("L31:7508", "Music"), ("L8:5528", "Peru"), ("L27:3448", "Ghosts")]
# hand-picked short words for the signs, from the verified labels: the gate ("you must be this X-ish to enter") and the
# two paths up sends a word down (+ and -); None where that side has no verified label
ISH = {"L31:10454": ("wheeled", "bike", "other-wheels"), "L31:7508": ("musical", "instrument", "voice"),
       "L8:5528": ("Peru", "Peru", None), "L27:3448": ("ghostly", "ghost", "mystic")}
# candidates; only words that keep their side across the 22 readings are shown (see sign_counts), so the context-dependent
# ones (" bicycle", " scooter", " Bike", ...) drop out. POLE_A_WORD fixes which up-axis pole is the + side.
BIKE_WORDS = [" bikes", " Cycling", " cycling", " MOTOR", " bicycle", " scooter", " pram", " stroller", " skateboard",
              " wheelchair", " treadmill", " kayak", " car", " banana", " the"]
POLE_A_WORD = " Cycling"        # pole A of the bike neuron's up-axis exam is bicycles and cycling
N_CTX = 12
PER_LIST = 3
SKIP = {"Arthur", "Betty", "Hick", "bicy"}   # names among the favourites: real, but they'd distract from the demo
silu = lambda x: x / (1 + math.exp(-x))


def vocab_scale(lists, u, words):
    gate = max(g for _, g, _ in lists[(u, "top")])
    push = [silu(g) * up for ls in ("apos", "aneg") for _, g, up in lists[(u, ls)]]
    up = [abs(x) for ls in ("top", "apos", "aneg") for _, _, x in lists[(u, ls)]]
    return {"g": max(gate, *(w["g"] for w in words)), "u": max(max(up), *(abs(w["u"]) for w in words)),
            "a": max(max(abs(x) for x in push), *(abs(w["a"]) for w in words))}


def sign_counts(cands: dict[str, set[int]]) -> dict[tuple[str, int], dict]:
    """For each (neuron, token): in how many of the sweep's 22 readings (12 template sentences, read at the word and, where
    the word isn't last, at the sentence end) it pushes + and -. Neurons in the sweep's full-profile sample: the sign of
    SiLU(gate) x up for that token. Others: whether the token is in that reading's strongest + side / - side favourites
    (top 100 each)."""
    out = {(u, t): {"plus": 0, "minus": 0, "n": 0} for u, ts in cands.items() for t in ts}
    for c in range(N_CTX):
        f = np.load(JOBS / f"vocab_sweep_v2_c{c}.npz")
        row_of = {int(t): r for r, t in enumerate(f["tokens"])}
        sample = [str(x) for x in f["sample"]]
        for rd in [r for r in ("slot", "end") if f"{r}_mean" in f.files]:
            prof = (f[f"{rd}_sample_z"], f[f"{rd}_sample_u"]) if any(u in sample for u in cands) else None
            ap, an = f[f"{rd}_apos_i"], f[f"{rd}_aneg_i"]
            for u, ts in cands.items():
                L, i = map(int, u[1:].split(":"))
                P, M = set(ap[L, i].tolist()), set(an[L, i].tolist())
                for t in ts:
                    o = out[(u, t)]
                    if u in sample:
                        if t not in row_of:
                            continue
                        r, col = row_of[t], sample.index(u)
                        a = silu(float(prof[0][r, col])) * float(prof[1][r, col])
                        plus, minus = a > 0, a < 0
                    else:
                        plus, minus = t in P, t in M
                    o["n"] += 1; o["plus"] += int(plus); o["minus"] += int(minus); o["by"] = "sign" if u in sample else "favourites"
            del ap, an, prof
        print(f"  sign counts: sentence {c + 1} of {N_CTX}", flush=True)
    return out


def keeps_side(cnt: dict, a: float, turned_away: bool) -> bool:
    """Show a word only if its sign here is its usual one: at least 2/3 of its signed readings on this side (turned-away
    words don't fire, so they stay)."""
    if turned_away:
        return True
    s = cnt["plus"] + cnt["minus"]
    return s > 0 and 3 * (cnt["plus"] if a > 0 else cnt["minus"]) >= 2 * s


def earlier(u, words, a_is_plus):
    """A neuron outside the v3 run (the bike neuron): its labels from the earlier gate exam and up-axis exam (two poles,
    A | B; a_is_plus says whether pole A is the + side), knockouts from the ledger, pushes from the
    weights. In the same shape as a data/neurons/ entry."""
    import duckdb
    from build_v2_data import KO_MIN, LEDGER, N_CONCEPTS, push_words, short_label
    c = duckdb.connect(LEDGER, read_only=True)
    q = lambda s, *a: c.execute(s, list(a)).fetchall()
    lab = {e: (t, p) for e, t, p in q("select experiment_id, value_text, passes from evidence where unit_key = ? and "
                                      "experiment_id in ('jobs_v1_gate_real_v2', 'jobs_v1_up_axis_sample', 'jobs_v1_gen_surface_sample')", u)}
    gate, gate_ok = lab["jobs_v1_gate_real_v2"]
    poles, axis_ok = lab["jobs_v1_up_axis_sample"]
    a, b = [p.split(":", 1)[1].strip() for p in poles.split(" | ")]
    pos, neg = (a, b) if a_is_plus else (b, a)
    labels = dict(q("select concept_id, label from concepts"))
    (tc,), = q("select top_concepts from unit_summary where unit_kind = 'neuron' and unit_key = ?", u)
    up, down = push_words([u])[u]
    part = lambda t, ok, gen: {"label": t, "short": short_label(t), "verified": bool(ok), "gen": gen, "earlier": True}
    return {"gate": part(gate, gate_ok, lab.get("jobs_v1_gen_surface_sample", (None, None))[1]),
            "pos": part(pos, axis_ok, None), "neg": part(neg, axis_ok, None), "pushes": up, "pushes_neg": down,
            "ko": [{"c": labels.get(t["concept_id"], t["concept_id"]), "drop": t["drop"]} for t in (tc or []) if (t.get("drop") or 0) >= KO_MIN][:N_CONCEPTS],
            "job": None, "earlier": True}


def main():
    from transformers import AutoTokenizer
    sys.path.insert(0, str(RESEARCH))
    from vocab_sweep import PANEL_V1, SLOT                                          # the panel as run
    tok = AutoTokenizer.from_pretrained(MODEL)
    dec = lambda j: tok.decode([int(j)])
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build_v2_data import load_details
    v3 = load_details(SITE)                                                         # the per-layer files (data/neurons/)
    f = np.load(JOBS / f"vocab_sweep_v2_c{CTX}.npz")
    tokens = f["tokens"]; row_of = {int(t): r for r, t in enumerate(tokens)}
    gmean = f[f"{READ}_mean"]
    lists = {}
    for ls, vk in (("top", "v"), ("apos", "g"), ("aneg", "g")):
        ids, gs, us = f[f"{READ}_{ls}_i"], f[f"{READ}_{ls}_{vk}"], f[f"{READ}_{ls}_u"]
        for u, _ in EXAMPLES:
            L, i = map(int, u[1:].split(":"))
            lists[(u, ls)] = list(zip(ids[L, i].tolist(), gs[L, i].astype(float).tolist(), us[L, i].astype(float).tolist()))
        del ids, gs, us
    sample = [str(x) for x in f["sample"]]
    sz, su = f[f"{READ}_sample_z"], f[f"{READ}_sample_u"]
    one = lambda w: (lambda ids: ids[0] if len(ids) == 1 and ids[0] in row_of else None)(tok.encode(w))
    cands = {u: {t for ls in ("top", "apos", "aneg") for t, _, _ in lists[(u, ls)]} for u, _ in EXAMPLES}
    for u, _ in EXAMPLES:
        if u in sample:
            cands[u] |= {t for t in map(one, BIKE_WORDS) if t is not None}
    counts = sign_counts(cands)

    out = []
    for u, name in EXAMPLES:
        L, i = map(int, u[1:].split(":"))
        words, seen, dropped = [], set(), []
        gmax = max(g for _, g, _ in lists[(u, "top")])

        def add(tid, g, up, why):
            w = dec(tid)
            if tid in seen or not w.strip() or len(words) >= 14:
                return False
            cnt = counts[(u, tid)]
            if not keeps_side(cnt, silu(g) * up, silu(g) < 0.15 * silu(gmax)):
                dropped.append((w, cnt["plus"], cnt["minus"])); seen.add(tid)
                return False
            seen.add(tid); words.append({"w": w, "g": round(g, 3), "u": round(up, 3), "a": round(silu(g) * up, 3), "why": why, **cnt})
            return True
        if u in sample:                                                       # full profile: chosen words
            col = sample.index(u)
            for w in BIKE_WORDS:
                ids = tok.encode(w)
                if len(ids) == 1 and ids[0] in row_of:
                    r = row_of[ids[0]]; add(ids[0], float(sz[r, col]), float(su[r, col]), "chosen")
            pa = counts[(u, one(POLE_A_WORD))]; a_is_plus = pa["plus"] > pa["minus"]
            for ls, why in (("apos", "strongest + side word in the vocabulary"), ("aneg", "strongest - side word in the vocabulary")):
                k = 0                                                         # the true 100% marks, so the scale is grounded
                for tid, g, up in lists[(u, ls)]:
                    if k >= 2:
                        break
                    s_ = dec(tid).strip()
                    if tid not in seen and s_.isascii() and len(s_) > 3 and s_ not in SKIP and s_.lower() not in {w["w"].strip().lower() for w in words}:
                        k += add(tid, g, up, why)
        else:
            for ls, why in (("top", "gate favourite"), ("apos", "+ side favourite"), ("aneg", "- side favourite")):
                k = 0
                for tid, g, up in lists[(u, ls)]:
                    if k >= PER_LIST:
                        break
                    s = dec(tid).strip()
                    if tid not in seen and s.isascii() and len(s) > 2 and s not in SKIP and s.lower() not in {w["w"].strip().lower() for w in words}:
                        k += add(tid, g, up, why)
        typical = {"w": "(an average word)", "g": round(float(gmean[L, i]), 3), "u": 0.0, "a": 0.0, "why": "average over all tokens"}
        n = v3.get(u) or earlier(u, words, a_is_plus)
        ex = {"id": u, "name": name, "gateIsh": ISH[u][0], "posIsh": ISH[u][1], "negIsh": ISH[u][2], "L": L, "words": words, "typical": typical,
              # 100% = the neuron's strongest reading over the WHOLE vocabulary in this template (from its favourite
              # lists), not the strongest of the words shown; one push scale for both sides, so + and - compare fairly
              "scale": vocab_scale(lists, u, words)}
        ex.update({k: n[k] for k in ("gate", "pos", "neg")})
        ex.update(pushes=n["pushes"], pushes_neg=n["pushes_neg"], ko=n["ko"], job=n["job"], earlier=n.get("earlier", False))
        out.append(ex)
        print(u, name, [(w["w"], w["a"], f'{w["plus"]}+/{w["minus"]}-/{w["n"]}') for w in words])
        print("   dropped (context-dependent sign):", dropped)
    # shown with a space before [X] (unless it follows a quote): the tokens bring their own leading space, but "about[X]"
    # reads like a typo on the page
    panel = [re.sub(r'(?<=[^\s"])\[X\]', " [X]", p.replace(SLOT, "[X]")) for p in PANEL_V1]
    (SITE / "examples.json").write_text(json.dumps({"context": panel[CTX], "panel": panel, "examples": out}, ensure_ascii=False, indent=0), encoding="utf-8")
    print("wrote", SITE / "examples.json")


if __name__ == "__main__":
    main()
