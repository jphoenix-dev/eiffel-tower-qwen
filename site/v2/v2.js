/* Approach explainer (draft). Figure 1: real neurons as a castle gate, a ruler and a ballista, with real readings from the
   vocabulary sweep (data/examples.json). Figure 2: 11,000 neurons from two runs (v3 random, v3x knockout-linked): a per-layer overview, the
   chosen layer's neurons as squares, and a pinning side pane (data/index.json for the map, data/neurons/L<k>.json for the details, loaded on demand).
   Details on hover or tap everywhere: terms, verdicts, the template sentences. */
(function () {
  const $ = (id) => document.getElementById(id);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const silu = (x) => x / (1 + Math.exp(-x));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const NI = 12288, NL = 36;
  const PARTS = [["gate", "Gate"], ["pos", "Positive side"], ["neg", "Negative side"]];

  /* ---------- the detail layer: one floating box for anything with ._tip ---------- */
  const box = $("tipbox");
  let tipEl = null;
  function showTip(el) {
    if (!el || !el._tip) return;
    tipEl = el; box.innerHTML = el._tip; box.hidden = false;
    const r = el.getBoundingClientRect(), bw = box.offsetWidth, vw = document.documentElement.clientWidth;
    box.style.left = clamp(r.left + window.scrollX, 8 + window.scrollX, window.scrollX + vw - bw - 8) + "px";
    box.style.top = r.bottom + window.scrollY + 6 + "px";
  }
  const hideTip = () => { box.hidden = true; tipEl = null; };
  const tipTarget = (e) => e.target.closest && e.target.closest(".term, .det, .v, .tp");
  document.addEventListener("mouseover", (e) => { const t = tipTarget(e); if (t) showTip(t); });
  document.addEventListener("mouseout", (e) => { const t = tipTarget(e); if (t && t === tipEl) hideTip(); });
  document.addEventListener("focusin", (e) => { const t = tipTarget(e); if (t) showTip(t); });
  document.addEventListener("focusout", (e) => { const t = tipTarget(e); if (t) hideTip(); });
  document.addEventListener("click", (e) => { const t = tipTarget(e); if (t) { t === tipEl && !box.hidden ? hideTip() : showTip(t); } else if (!e.target.closest("#tipbox")) hideTip(); });
  window.addEventListener("scroll", () => tipEl && showTip(tipEl), { passive: true });
  const det = (text, html, cls = "det") => `<span class="${cls}" tabindex="0" data-t="${esc(html)}">${text}</span>`;
  const arm = (root) => root.querySelectorAll("[data-t]").forEach((el) => { el._tip = el.dataset.t; el.removeAttribute("data-t"); });
  arm(document);   // hovers written into the page itself

  /* ---------- verdicts: a chip, with how it was checked on hover ---------- */
  const auc = (x) => (x == null ? "–" : (+x).toFixed(2));
  function examTip(p) {
    if (p.earlier) return `<b>Label exam (earlier run): ${p.verified ? "passed" : "not passed"}.</b><br><span class="tl">This neuron is from the run before v3, where the exam had the same idea (a blind judge picks the neuron's favourites out from decoys) with slightly different settings.</span>`;
    if (/decoys-too-easy/.test(p.bin || "") && p.verified) {
      const a3 = (x) => (x == null ? "–" : Number(x).toFixed(3)), hi = [p.ctrl, p.lctrl].filter((x) => x != null && x > 0.65);
      return `<b>Label exam: verified (exam at the edge, lower confidence).</b><br>Jev, a calibrated judge, saw only this label and had to pick the neuron's held-out favourite tokens out from look-alike decoys.` +
        `<br>Label: <b>${a3(p.exam)}</b>; other neurons' labels on the same test: ${a3(p.ctrl)}.` +
        (p.lexam != null ? `<br>Token list: <b>${a3(p.lexam)}</b>; other neurons' token lists: ${a3(p.lctrl)}.` : "") +
        `<br>Passed both exams, but other neurons' labels or token lists also scored above 0.65 on this test${hi.length ? ` (${hi.map(a3).join(" and ")} here)` : ""}, so the test was at the edge of being too easy to certify the label.` +
        `<br>Checked afterwards against real text: labels like this pass the corpus exam nearly as often as fully verified ones (67% against 81% on same-word decoys; 30% for labels that failed the exam).` +
        `<br><span class="tl">Reclassified after the run (post hoc), not set in advance. About 2% of gates and 1% of each side. The generative check ran only on labels verified at the time, so not on these.</span>`;
    }
    if (/decoys-too-easy/.test(p.bin || "")) {
      const a3 = (x) => (x == null ? "–" : Number(x).toFixed(3)), hi = [p.ctrl, p.lctrl].filter((x) => x != null && x > 0.65);
      return `<b>Label exam: not verified (test too easy).</b><br>Jev, a calibrated judge, saw only this label and had to pick the neuron's held-out favourite tokens out from look-alike decoys.` +
        `<br>Label: <b>${a3(p.exam)}</b>; other neurons' labels on the same test: ${a3(p.ctrl)}.` +
        (p.lexam != null ? `<br>Token list: <b>${a3(p.lexam)}</b>; other neurons' token lists: ${a3(p.lctrl)}.` : "") +
        `<br>Not verified: unrelated labels or token lists also scored above 0.65 on this test${hi.length ? ` (${hi.map(a3).join(" and ")} here)` : ""}, so the decoys were too easy for the test to certify the label. The label may well be right.` +
        `<br><span class="tl">A rule fixed before the run. It holds back about 2% of gates and 1% of each side that would otherwise pass. Why is still open: related control labels explain about a fifth of these cases, matching decoys on kind or word frequency changed nothing, and a fresh draw of decoys verifies about half, so they sit at the edge.</span>`;
    }
    return `<b>Label exam: ${p.verified ? "passed" : "not passed"}.</b><br>Jev, a calibrated judge, saw only this label. It had to pick the neuron's held-out favourite tokens out from look-alike decoys.` +
      `<br>Score (AUC): <b>${auc(p.exam)}</b> (0.5 = guessing, 1 = perfect). Five other neurons' labels on the same test: ${auc(p.ctrl)}.` +
      `<br><span class="tl">Pass rule, fixed before the run: AUC at least 0.75 and at least 0.2 above the other labels, plus a second exam on the token list itself, over repeated draws of decoys. Result: ${esc(p.bin || "")}.</span>`;
  }
  function genTip(p) {
    if (p.gen == null) return p.verified || p.earlier ? `<b>Generative check: not run</b> for this label.` : `<b>Generative check: not run.</b><br><span class="tl">It only runs on labels that passed the exam.</span>`;
    const ex = p.words && p.words.length ? ` For example: ${p.words.slice(0, 8).map(esc).join(", ")}.` : "";
    return `<b>Generative check: ${p.gen ? "passed" : "not passed"}.</b><br>Luna wrote 30 new words from this label alone.${ex} A second set came from a description of only the tokens' surface (spelling, script, length).` +
      `<br>Does the neuron fire more on the first set? AUC <b>${auc(p.gen_auc)}</b> (pass: 0.75 or more).<br><span class="tl">This catches labels that only describe what the tokens look like.</span>`;
  }
  const chips = (p) => det(`label exam ${p.verified ? (p.edge ? "✓ at the edge" : "✓") : /decoys-too-easy/.test(p.bin || "") ? "– test too easy" : "✗"}`, examTip(p), "v" + (p.verified ? " ok" : "")) +
    det(p.gen == null ? "generative check –" : `generative check ${p.gen ? "✓" : "✗"}`, genTip(p), "v" + (p.gen ? " ok" : ""));
  const pushTip = (L) => `<b>From the weights</b> (the logit lens): the words the write's fixed direction raises most when it fires that way.` +
    (L < 20 ? `<br><span class="tl">Before layer 20 a neuron mostly acts through later neurons, so these words say little.</span>` : "");
  const JOBS = { amplifier: "pushes further towards what it read", eraser: "pushes against what it read", redirector: "pushes somewhere unrelated" };
  const jobTip = (j) => `<b>${j}</b>: ${JOBS[j]}.<br><span class="tl">From the weights alone. What this side reads: the input that fires it most, i.e. the gate direction plus the up direction (positive side) or minus it (negative side). What it writes: +down or −down. We take the cosine between the two: 0.2 or more = amplifier (same way), −0.2 or less = eraser (opposite way), in between = redirector (unrelated).</span>`;

  /* ---------- the one-line summary, with get-outs for anything unverified ---------- */
  function oneLine(n) {
    const what = (p, none) => !p.verified ? (/decoys-too-easy/.test(p.bin || "") && p.short ? `${esc(p.short)} <span class="muted">(not verified: test too easy)</span>` : `<span class="muted">${none}</span>`)
      : `${esc(p.short)}${p.edge ? ' <span class="muted">(exam at the edge)</span>' : p.gen === false ? ' <span class="muted">(exam only)</span>' : ""}`;
    const words = (ws) => ws && ws.length ? ws.slice(0, 3).map((w) => `“${esc(w)}”`).join(", ") : "nothing clear";
    const early = n.L < 20 ? ' <span class="muted">(indirect this early)</span>' : "";
    const ko = n.ko && n.ko.length ? `breaks ${n.ko.slice(0, 3).map((k) => esc(k.c)).join(", ")}`
      : n.ko_profile === "untested" || n.ko_profile == null ? '<span class="muted">not tested yet</span>' : '<span class="muted">breaks nothing we tested</span>';
    const row = (k, v) => `<span class="k">${k}</span><span>${v}</span>`;
    return `<span class="sumgrid">${row("Gate:", `opens for ${what(n.gate, "nothing we can name yet")}`)}` +
      row("Positive:", `${what(n.pos, "no verified label")}; pushes towards ${words(n.pushes)}${early}`) +
      row("Negative:", `${what(n.neg, "no verified label")}; pushes towards ${words(n.pushes_neg)}`) +
      row("Knockout effect:", ko) + `</span>`;
  }
  function partBox(title, p, job) {
    const cls = p.verified && p.gen ? "ok" : p.verified ? "half" : "fail";
    return `<div class="part ${cls}"><div class="hd">${title}${job ? " · " + det(job, jobTip(job)) : ""}</div><p>${esc(p.label || "No description.")}</p>${chips(p)}${simLine(p)}${termsLink(p, title)}</div>`;
  }
  // the favourite tokens the label was written from, on hover: the raw evidence behind every label
  // graded simulation: how well the judge, from this label alone, ranks how strongly the part fires on web text
  function simLine(p) {
    const s = p.sim;
    if (!s) return "";
    const r2 = (x) => (x == null ? "–" : Number(x).toFixed(2));
    const ex = (s.ex || []).map(([t, r, v, top]) => `<div class="simex"><span class="simt">«${esc(t)}»</span><span class="simn">judge ${r} · real ${v}%${top ? " · a strongest moment" : ""}</span></div>`).join("");
    const tip = `<b>Simulation</b>: the judge (Jev) read only this label and rated how strongly this part fires at 60 positions in web text, 12 of its strongest moments and 48 spread across its everyday range. ` +
      `How well the ratings rank with the real values (rank correlation, 0 = no relation, 1 = perfect): <b>${r2(s.rho)}</b>. ` +
      `Other neurons' labels on the same positions (median of 5): ${r2(s.ctrl)}. Without the strongest moments (the 48 others only, noisier): ${r2(s.rest)}.` +
      (ex ? `<br><span class="tl">A fixed selection of the passages, not picked by eye: the 2 strongest, 2 from the middle of its range and the one nearest zero. The marked token is where the neuron is read; real = % of this part's strongest value here (for the − side, how strongly negative). Ratings are the judge's reading of the label, not the model's own.</span>${ex}` : "") +
      `<br><span class="tl">From 60 positions one neuron's score is noisy (about ±0.1; two halves agree at about 0.8 across neurons) and from web text only. The population numbers are in "How far each label gets".</span>`;
    return `<p class="termsrow">${det(`Simulation ${r2(s.rho)}`, tip)} <span class="muted">(other labels ${r2(s.ctrl)})</span></p>`;
  }
  function termsLink(p, title) {
    if (!p.terms || !p.terms.length) return "";
    const side = /gate/i.test(title) ? "open the gate most" : /positiv/i.test(title) ? "push the + side most" : "push the − side most";
    const tip = `<b>Associated terms</b>: the ${p.terms.length} tokens that ${side} in the vocabulary sweep, strongest first. Luna wrote this label from these and the next 20.` +
      `<code>␣</code> marks a leading space. Glitch (hub) tokens are left out. The exam then tests the label on other favourites, held back from Luna.` +
      `<div class="terms">${p.terms.map((t) => `<code>${esc(t)}</code>`).join("")}</div>`;
    return `<p class="termsrow">${det("See associated terms", tip)}</p>`;
  }
  function launcherBox(n) {
    const w = (ws) => ws && ws.length ? ws.map((x) => `<code>${esc(x)}</code>`).join("") : '<span class="muted">none</span>';
    const ko = n.ko && n.ko.length ? n.ko.map((c) => `${esc(c.c)} <span class="muted">(−${c.drop.toFixed(1)})</span>`).join(", ")
      : n.ko_profile === "untested" || n.ko_profile == null ? "Not tested yet." : n.ko_profile === "no effect" ? "None of the concepts tested." : "Only weak effects.";
    const koTip = `<b>Knockouts.</b> The neuron is set to zero while the model answers questions about a concept. The drop is how much less likely the right answer gets, in log-odds (3 is roughly a 20-fold fall in the odds). Shown: drops of 0.3 or more.<br><span class="tl">Tested on the concepts our earlier runs flagged for this neuron, not on every concept.</span>`;
    return `<div class="part ${n.ko && n.ko.length ? "half" : ""}"><div class="hd">Write</div>
      <p class="muted" style="font-size:13px">${det("Positive pushes towards", pushTip(n.L))}</p><div class="words">${w(n.pushes)}</div>
      <p class="muted" style="font-size:13px">${det("Negative pushes towards", pushTip(n.L))}</p><div class="words">${w(n.pushes_neg)}</div>
      <p class="muted" style="font-size:13px;margin-top:8px">${det("Concepts lost when it's knocked out", koTip)}</p><p>${ko}</p></div>`;
  }

  /* ---------- Figure 1: castle gate, ruler, ballista (SVG fallback) ---------- */
  function figure1(E) {
    const svg = $("scene"), gIn = $("gIn"), uIn = $("uIn");
    let ex = E.examples[0], word = ex.words[0];
    const wrap = (s, n) => { const out = []; let line = ""; for (const w of String(s).split(" ")) { if ((line + " " + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + " " + w).trim(); } if (line) out.push(line); return out.slice(0, 3); };
    const tspans = (lines, x, y, dy = 15) => lines.map((l, i) => `<tspan x="${x}" y="${y + i * dy}">${esc(l)}</tspan>`).join("");

    // the 3D version (fig1-3d.js, a module) replaces the SVG when WebGL is available; the SVG stays as the fallback
    let fig3d = null, last3d = null;
    const start3d = () => {
      if (fig3d || !window.Fig3D) return;
      try {
        const host = $("scene3d"); host.hidden = false;
        fig3d = window.Fig3D.mount(host);
        fig3d.pause(scenePaused); sceneBtn.hidden = false;
        fig3d.onEnd = () => { if (touring && visible) tick(); };   // the tour steps on as each word's story ends
        schedule();
        if (last3d) { fig3d.update(last3d); hold(); }
      } catch (e) { $("scene3d").hidden = true; fig3d = null; }
    };
    window.addEventListener("fig3d-ready", start3d); setTimeout(start3d, 0);
    // the scene's own animation can be paused apart from the tour; paused, a new word shows its landing, held still
    const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let scenePaused = REDUCE, heldKey = "";
    const hold = () => {
      const k = last3d.id + "|" + last3d.word;
      if (!fig3d || !scenePaused || REDUCE || k === heldKey) return;
      heldKey = k; fig3d.landing(true);
    };
    function scene(g, u, real = false) {
      const C = { ink: css("--ink"), muted: css("--muted"), rule: css("--rule"), accent: css("--accent"), wash: css("--wash"), stone: css("--stone"), stoneD: css("--stone-dark"), paper: css("--paper"), aw: css("--accent-wash") };
      const sc = ex.scale, open = clamp(silu(g) / silu(sc.g), -0.03, 1), r = clamp(u / sc.u, -1, 1);
      const a = silu(g) * u, launch = clamp(a / sc.a, -1, 1);
      // the same story as the 3D scene, flat: the ruler at the gate measures the gate reading; one ballista turns by up
      const o = Math.max(0, open), pass = o >= 0.15, push = Math.abs(launch), fired = pass && push >= 0.02, plusSide = u >= 0, cool = "#5f7482";
      // the castle gate, with its sign; the portcullis rises with SiLU(gate)
      let cren = ""; for (let x = 120; x < 300; x += 20) cren += `<rect x="${x}" y="128" width="11" height="12" fill="${C.stone}"/>`;
      let bars = ""; for (let x = 172; x <= 248; x += 13) bars += `<rect x="${x}" y="0" width="4" height="120" fill="${C.ink}"/>`;
      for (let y = 16; y <= 112; y += 24) bars += `<rect x="166" y="${y}" width="88" height="3" fill="${C.ink}"/>`;
      const castle = `<defs><clipPath id="arch"><path d="M165 330 V232 a45 45 0 0 1 90 0 V330 z"/></clipPath></defs>
        <rect x="120" y="140" width="180" height="190" fill="${C.stone}"/>${cren}
        <rect x="110" y="118" width="40" height="212" fill="${C.stoneD}"/><rect x="270" y="118" width="40" height="212" fill="${C.stoneD}"/>
        <path d="M165 330 V232 a45 45 0 0 1 90 0 V330 z" fill="${C.aw}"/>
        <g clip-path="url(#arch)"><g transform="translate(0,${(210 - o * 120).toFixed(1)})">${bars}</g></g>
        <rect x="110" y="40" width="270" height="52" rx="4" fill="${C.paper}" stroke="${C.ink}"/>
        <text class="t" x="245" y="59" text-anchor="middle">you must be at least this</text>
        <text class="tb" x="245" y="80" text-anchor="middle">${esc(ex.gateIsh || ex.ish)}-ish to enter</text>`;
      // the ruler at the gate: the gate reading against the line; below the line the word is turned away
      const ry = (v) => 320 - v * 200, col = pass ? C.accent : C.muted;
      let ticks = ""; for (let k = 0; k <= 4; k++) ticks += `<line x1="344" x2="${k % 4 ? 352 : 358}" y1="${ry(k / 4)}" y2="${ry(k / 4)}" stroke="${C.muted}"/>`;
      const ruler = `<rect x="330" y="110" width="14" height="214" fill="${C.wash}" stroke="${C.rule}"/>${ticks}
        <rect x="331" y="${ry(o)}" width="12" height="${(ry(0) - ry(o)).toFixed(1)}" fill="${col}"/>
        <line x1="322" x2="366" y1="${ry(0.15)}" y2="${ry(0.15)}" stroke="${C.ink}" stroke-width="2"/><text class="t" x="370" y="${ry(0.15) + 4}">this</text>
        <path d="M 344 ${ry(o)} l 18 -8 v 16 z" fill="${col}"/>
        <text class="tb" x="230" y="355" text-anchor="middle">1. Gate (the ruler) · opens ${Math.round(o * 100)}%${pass ? "" : ": turned away"}</text>`;
      // the word: outside the gate if turned away, otherwise through it and loaded
      const wordTxt = esc(word === ex.typical ? "average word" : word.w.trim() || word.w);
      const [wx, wy] = pass ? [410, 290] : [4, 296];
      const wordCard = `<rect x="${wx}" y="${wy}" width="104" height="30" rx="5" fill="${C.paper}" stroke="${C.accent}"/><text class="tw" x="${wx + 52}" y="${wy + 20}" text-anchor="middle">${wordTxt}</text>`;
      // one ballista: up's sign turns it to the + target or the - target; the bolt lands |push| of the way there
      const px = 520, py = 190, T = { 1: [850, 92], [-1]: [850, 284] }, aim = fired ? (plusSide ? 1 : -1) : 0;
      const along = (s, f) => { const [tx, ty] = T[s], d0 = 46 / Math.hypot(tx - px, ty - py), k = d0 + f * (1 - d0); return [px + (tx - px) * k, py + (ty - py) * k]; };
      const lane = (s, ish, words) => {
        const on = aim === s, c = s > 0 ? C.accent : cool, [tx, ty] = T[s], [ax, ay] = along(s, 0);
        let t = `<line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty}" stroke="${on ? c : C.rule}" stroke-width="2" stroke-dasharray="4 5"/>`;
        for (const f of [0.25, 0.5, 0.75]) { const [qx, qy] = along(s, f); t += `<circle cx="${qx}" cy="${qy}" r="3" fill="${C.muted}"/>`; }
        t += `<circle cx="${tx}" cy="${ty}" r="18" fill="${on ? C.aw : C.paper}" stroke="${c}" stroke-width="2"/><circle cx="${tx}" cy="${ty}" r="6" fill="${c}"/>`;
        const ly = s > 0 ? ty - 42 : ty + 32;
        t += `<text class="tb" x="${tx + 18}" y="${ly}" text-anchor="end">${s > 0 ? "+" : "−"} ${esc(ish ? ish + "-ish" : "no label yet")}</text><text class="t" x="${tx + 18}" y="${ly + 16}" text-anchor="end">pushes towards ${esc((words || []).slice(0, 3).join(", "))}</text>`;
        if (on) { const [bx, by] = along(s, push); t += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${c}" stroke-width="3"/><circle cx="${bx}" cy="${by}" r="7" fill="${C.ink}"/>`; }
        return t;
      };
      const ang = aim ? (Math.atan2(T[aim][1] - py, T[aim][0] - px) * 180) / Math.PI : 0;
      const launcher = `${lane(1, ex.posIsh, ex.pushes)}${lane(-1, ex.negIsh, ex.pushes_neg)}
        <circle cx="${px}" cy="${py}" r="34" fill="${C.wash}" stroke="${C.rule}" stroke-dasharray="4 4"/>
        <g transform="rotate(${ang.toFixed(1)} ${px} ${py})"><rect x="${px - 30}" y="${py - 6}" width="68" height="12" rx="3" fill="${C.stoneD}"/>
          <path d="M ${px + 30} ${py - 26} Q ${px + 16} ${py} ${px + 30} ${py + 26}" fill="none" stroke="${C.ink}" stroke-width="4"/><circle cx="${px}" cy="${py}" r="6" fill="${C.ink}"/></g>
        <text class="tb" x="${px}" y="355" text-anchor="middle">2. Up · ${u >= 0 ? "+" : "−"}${Math.abs(u).toFixed(2)}${fired ? `, turns to ${plusSide ? "+" : "−"}` : ""}</text>
        <text class="tb" x="720" y="355" text-anchor="middle">3. Push · ${a >= 0 ? "+" : "−"}${Math.abs(a).toFixed(1)}${fired ? `, lands ${Math.round(push * 100)}% of the way` : ""}</text>`;
      svg.innerHTML = castle + ruler + launcher + wordCard;
      last3d = { id: ex.id, open, r, launch, u, a, ish: ex.gateIsh, gateIsh: ex.gateIsh, posIsh: ex.posIsh, negIsh: ex.negIsh || null, word: word === ex.typical ? "average word" : word.w.trim() || word.w,
                 plusLab: ex.pos.short || "", minusLab: ex.neg.short || "", plus: (ex.pushes || []).slice(0, 3).join(", "), minus: (ex.pushes_neg || []).slice(0, 3).join(", ") };
      if (fig3d) { fig3d.update(last3d); hold(); }
      const side = u >= 0 ? "+" : "−", sideLab = u >= 0 ? ex.pos.short : ex.neg.short;
      // turned away = below the line on the ruler (open < 0.15, as in the 3D scene). SiLU still lets a trace through below
      // the line, and for a negative gate reading it even flips the sign, so say how big that leak is rather than "nothing"
      const leak = word === ex.typical ? `With the gate almost shut, any push is tiny (we show the average gate reading only, so up is set to 0).`
        : `Only a trace leaks through (push ${a.toFixed(2)}, ${(100 * Math.abs(a) / sc.a).toFixed(1)}% of the maximum), too small to fire.`;
      $("sceneState").innerHTML = Math.max(0, open) < 0.15
        ? `<b>${esc(word.w.trim())}</b>: below the line on the ruler, so the gate stays almost shut and the word is turned away. ${leak}`
        : Math.abs(a) < 0.03 * sc.a
        ? `<b>${esc(word.w.trim())}</b>: the gate opens ${Math.round(open * 100)}%, but up is near zero, so almost nothing fires.`
        : `<b>${esc(word.w.trim())}</b>: the ruler puts it over the line and the gate opens ${Math.round(Math.max(0, open) * 100)}%. Up reads ${side}${Math.abs(u).toFixed(2)} (${side} side: ${esc(sideLab)}), so the ballista turns to ${side} and fires with push ${a.toFixed(1)}, towards ${esc(((a >= 0 ? ex.pushes : ex.pushes_neg) || []).slice(0, 3).join(", "))}` +
          (real && word.n ? ` (${word.by === "favourites" ? `one of its strongest ${a >= 0 ? "+" : "−"} side words in` : `pushes ${a >= 0 ? "+" : "−"} in`} ${a >= 0 ? word.plus : word.minus} of ${word.n} readings).` : ".");
      $("gVal").textContent = g.toFixed(2); $("uVal").textContent = u.toFixed(2);
    }
    function setWord(w) {
      word = w;
      gIn.value = w.g; uIn.value = w.u; scene(w.g, w.u, true);
      $("wordPick").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b._w === w ? "true" : "false"));
      $("ctxLine").innerHTML = w === ex.typical ? `The average reading over all ~151,000 tokens in this template.`
        : `Reading “${esc(w.w.trim())}” in the template ${det(`“${esc(E.context)}”`, `<b>The 12 template sentences</b> (every token goes in at [X], bringing its own leading space if it has one):<ol>${E.panel.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`)} <span class="muted">(${w.why})</span>`;
      arm($("ctxLine"));
    }
    function setExample(e) {
      ex = e;
      $("exPick").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b._e === e ? "true" : "false"));
      const wp = $("wordPick"); wp.querySelectorAll("button:not(#tourBtn):not(#sceneBtn)").forEach((b) => b.remove());
      [...e.words, e.typical].forEach((w) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b._w = w;
        b.textContent = w === e.typical ? "average word" : w.w.trim(); b.addEventListener("click", () => { stopTour(); setWord(w); }); wp.appendChild(b);
      });
      const gmin = Math.min(-2, ...e.words.map((w) => w.g)), gmax = Math.max(...e.words.map((w) => w.g)) * 1.1;
      gIn.min = gmin.toFixed(2); gIn.max = gmax.toFixed(2); uIn.min = (-e.scale.u * 1.1).toFixed(2); uIn.max = (e.scale.u * 1.1).toFixed(2);
      const n = { ...e, ko_profile: e.ko && e.ko.length ? "effect" : null };
      $("found").innerHTML = `<p class="one"><b>Neuron ${esc(e.id)}</b> (layer ${e.L})<br>${oneLine(n)}</p>` +
        PARTS.map(([k, t]) => partBox(t, e[k], k !== "gate" && e.job ? e.job[k] : null)).join("") + launcherBox(n);
      arm($("found"));
      order = tourOrder(e); step = 0;
      setWord(order[0]);
    }

    // the tour: words march through on their own (strongest + side, strongest - side, an average word, then the rest),
    // then the next neuron. Clicking a word or neuron, or grabbing a slider, stops it; the button restarts it.
    // one word per step: with the 3D scene, the scene says when the word's story ends (onEnd); for the SVG, 3.8 s
    function schedule() { clearTimeout(timer); if (!fig3d) timer = setTimeout(loop, 3800); }
    let order = [], step = 0, touring = !matchMedia("(prefers-reduced-motion: reduce)").matches, visible = false, timer = null;
    function tourOrder(e) {
      const ws = [...e.words], pos = ws.slice().sort((a, b) => b.a - a.a)[0], neg = ws.slice().sort((a, b) => a.a - b.a)[0];
      const shut = [...ws, e.typical].sort((a, b) => silu(a.g) - silu(b.g))[0];             // the word the gate most firmly turns away
      const first = [pos, neg.a < 0 ? neg : null, shut].filter((w, i, all) => w && all.indexOf(w) === i);
      if (!first.includes(e.typical)) first.push(e.typical);
      return [...first, ...ws.filter((w) => !first.includes(w))];
    }
    const tourBtn = document.createElement("button"); tourBtn.type = "button"; tourBtn.className = "chip"; tourBtn.id = "tourBtn";
    $("wordPick").insertBefore(tourBtn, $("wordPick").querySelector(".lab").nextSibling);
    const showBtn = () => { tourBtn.textContent = touring ? "❚❚ pause" : "▶ play"; tourBtn.setAttribute("aria-pressed", touring ? "true" : "false"); };
    function stopTour() { touring = false; showBtn(); }
    tourBtn.addEventListener("click", () => { touring = !touring; showBtn(); if (touring) { if (scenePaused) setScenePaused(false); tick(); schedule(); } });
    // pausing the scene also pauses the tour; with reduced motion the scene starts paused
    const sceneBtn = document.createElement("button"); sceneBtn.type = "button"; sceneBtn.className = "chip"; sceneBtn.id = "sceneBtn"; sceneBtn.hidden = true;
    tourBtn.after(sceneBtn);
    const showSceneBtn = () => { sceneBtn.textContent = scenePaused ? "▶ play scene" : "❚❚ pause scene"; sceneBtn.setAttribute("aria-pressed", scenePaused ? "false" : "true"); };
    function setScenePaused(p) {
      scenePaused = p; heldKey = "";
      if (fig3d) fig3d.pause(p);
      if (p) { stopTour(); if (last3d) hold(); }
      showSceneBtn();
    }
    sceneBtn.addEventListener("click", () => setScenePaused(!scenePaused));
    showSceneBtn();
    function tick() {
      if (!touring || !visible) return;
      step += 1;
      if (step >= order.length) { setExample(E.examples[(E.examples.indexOf(ex) + 1) % E.examples.length]); return; }
      setWord(order[step]);
    }
    function loop() { tick(); schedule(); }
    schedule();
    // coming into view restarts the current word, so its story plays from the start and gets its full time
    new IntersectionObserver(([en]) => {
      const was = visible; visible = en.isIntersecting;
      if (visible && !was && touring) { setWord(order[step]); schedule(); }
    }, { threshold: 0.25 }).observe($("fig1"));
    showBtn();

    E.examples.forEach((e) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b._e = e;
      b.textContent = e.name; b.addEventListener("click", () => { stopTour(); setExample(e); }); $("exPick").appendChild(b);
    });
    gIn.addEventListener("input", () => { stopTour(); scene(+gIn.value, +uIn.value); });
    uIn.addEventListener("input", () => { stopTour(); scene(+gIn.value, +uIn.value); });
    setExample(ex);
    const pt = $("panelTip"); pt._tip = `<b>The 12 template sentences</b> (every token goes in at [X], bringing its own leading space if it has one):<ol>${E.panel.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`;
  }

  /* ---------- the numbers table: all 11,000 together; each cell's hover splits it by run ---------- */
  const fmt = (x) => Number(x).toLocaleString("en-GB");
  const pct = (x) => (100 * x).toFixed(x < 0.1 && x > 0 ? 1 : 0) + "%";
  function numbers(I) {
    const R = I.runs.random, X = I.runs["knockout-linked"], N = I.neurons, n = N.length;
    // parts code per neuron: gate, +, -; 0 not verified, 1 verified, 2 + generative check failed, 3 + generative check passed
    const count = (j, gen) => N.filter((r) => (gen ? r[3][j] === "3" : r[3][j] !== "0")).length;
    const split = (kind, k) => `Random sample: ${pct(R[kind][k])} of ${fmt(R.n)}<br>Knockout-linked: ${pct(X[kind][k])} of ${fmt(X.n)}` +
      (kind === "verified" && R.edge ? `<br><span class="tl">Including labels verified with the exam at the edge (lower confidence, reclassified after the run): ${pct(R.edge[k])} random, ${pct(X.edge[k])} knockout-linked.</span>` : "") +
      (kind === "exam_gen" && R.edge ? `<br><span class="tl">Labels verified with the exam at the edge have no generative check yet: it ran only on labels verified at the time.</span>` : "");
    const cell = (j, k, gen) => {
      const c = count(j, gen);
      return `<td class="n">${det(pct(c / n), `<b>${fmt(c)} of ${fmt(n)}</b> (${(100 * c / n).toFixed(1)}%)<br>${split(gen ? "exam_gen" : "verified", k)}`)}</td>`;
    };
    const rows = [["gate", "Gate"], ["pos", "Positive side"], ["neg", "Negative side"]].map(([k, t], j) =>
      `<tr><td>${t}</td>${cell(j, k, false)}${cell(j, k, true)}</tr>`);
    const fake = (kind) => {
      const ks = ["gate", "pos", "neg"], c = ks.map((k) => Math.round(R.pseudo[kind][k] * R.pseudo.n[k]) + Math.round(X.pseudo[kind][k] * X.pseudo.n[k]));
      const m = ks.map((k) => R.pseudo.n[k] + X.pseudo.n[k]);
      return `<td class="n">${det(c.map((x, j) => pct(x / m[j])).join(" / "), ks.map((k, j) => `${["Gate", "+ side", "− side"][j]}: <b>${c[j]} of ${m[j]}</b>`).join("<br>"))}</td>`;
    };
    const fakeTip = `<b>Fake neurons</b>: 100 per part in each run (200 in all), built from random mixtures of real gate rows and random directions, then labelled and checked exactly like the real ones. Shown as gate / + side / − side. In the 10,000-neuron run alone the fakes passed 3–4 of 100, above our pre-set bar of 2, but still at least ten times below real neurons.`;
    rows.push(`<tr class="fake"><td>${det("Fake neurons", fakeTip)} <span class="muted">(gate / + / −)</span></td>${fake("verified")}${fake("exam_gen")}</tr>`);
    const tb = $("numsTable").querySelector("tbody"); tb.innerHTML = rows.join(""); arm(tb);
    const v = [...Object.values(R.ctrl_median), ...Object.values(X.ctrl_median)], lo = Math.min(...v).toFixed(2), hi = Math.max(...v).toFixed(2);
    $("numsNote").innerHTML = `All ${det(fmt(n) + " neurons", `<b>Two runs, combined.</b> ${fmt(R.n_new)} neurons drawn at random plus ${R.n_bridge} shared with an earlier run, and ${fmt(X.n)} that knockouts had already tied to concepts. ` +
      `The knockout-linked neurons are easier to read, so the combined rates run higher than a random neuron's would; the random sample is the fair estimate for a whole model. Hover a number for each run's figure.`)} together. ` +
      `Other neurons' descriptions on the same test score ${lo === hi ? lo : lo + "–" + hi}, which is chance. Gates in the middle layers (12–23) pass least often. ` +
      `Of the ${R.ko_tested} random-sample neurons with knockout data, ${pct(R.candidate_junk / R.ko_tested)} have no nameable part and no knockout effect.`;
    arm($("numsNote"));
  }

  /* ---------- Figure 2: the map. An overview (one bar per layer), the chosen layer's neurons as squares, the side pane ---------- */
  const level = (n) => { const k = ["gate", "pos", "neg"].filter((p) => n[p].verified).length; return k ? String(k) : n.triage === "pattern-not-named" ? "p" : "n"; };
  const LVLAB = { "3": "All three parts labelled", "2": "Two parts", "1": "One part", p: "Pattern, not named", n: "Nothing yet" };
  // parts labelled, as an ordinal one-hue ramp (dark = more) plus grey for none; checked light to dark: OKLCH L 0.69 / 0.51 /
  // 0.34, gaps >= 0.17, light end 2.8:1 on white, hue spread 6 degrees; the grey sits 0.17 lighter than the light end
  const CAT = [[3, "All three parts labelled", "--lv3"], [2, "Two parts", "--lv2"], [1, "One part", "--lv1"], [0, "None labelled", "--lv0"]];
  function decode(I) {
    // one compact row per neuron: [id, set, triage, part codes, concepts broken, knockout profile, short gate, short +, short -]
    return I.neurons.map(([id, s, t, codes, ko, kp, sg, sp, sn]) => {
      const [L, i] = id.slice(1).split(":").map(Number), sh = [sg, sp, sn];
      const n = { id, L, i, set: I.sets[s], triage: I.triage[t], ko, ko_profile: I.ko_profiles[kp] };
      ["gate", "pos", "neg"].forEach((p, j) => { const c = +codes[j]; n[p] = { verified: c > 0, gen: c === 0 || c === 1 ? null : c === 3, short: sh[j] }; });
      n._s = (id + " " + sh.join(" ")).toLowerCase();
      n._lv = level(n);
      n._c = ["gate", "pos", "neg"].filter((p) => n[p].verified).length;
      n._g = ["gate", "pos", "neg"].filter((p) => n[p].gen === true).length;
      return n;
    });
  }
  function map(I) {
    const N = decode(I), pane = $("pane"), ov = $("overview"), grid = $("grid");
    const COL = Object.fromEntries(CAT.map(([k, , v]) => [k, css(v)]));
    // each layer's neurons, most labelled first; within a level, more generative-check passes first; then by index
    const byLayer = Array.from({ length: NL }, () => []);
    N.forEach((n, k) => byLayer[n.L].push(k));
    byLayer.forEach((ks) => ks.sort((a, b) => N[b]._c - N[a]._c || N[b]._g - N[a]._g || N[a].i - N[b].i));
    let whole = false, sel = 0, pinned = -1, hover = -1, koOn = false, match = null, byId = false;
    const dim = new Set();
    const inSet = () => true;                                  // both sets together
    // the concept overlay: the neurons a concept needs (data/concepts.json, fetched on first use), as dots on the layer bars
    const idToK = new Map(N.map((n, k) => [n.id, k]));
    let CX = null, FL = null, cxLoad = null, concept = null, linksOn = true, routesOn = true;
    const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    // the flow lines are optional: without flows.json the overlay still works
    const loadConcepts = () => cxLoad || (cxLoad = Promise.all([getJSON("data/concepts.json"), getJSON("data/flows.json").catch(() => null)])
      .then(([d, f]) => { CX = d; FL = f; CX._lc = d.concepts.map(([name]) => name.toLowerCase()); return d; }).catch((e) => { cxLoad = null; throw e; }));
    const POSLAB = ["not tested yet", "on the question's words", "where the answer is produced", "both"];
    const POSTIP = "Tested by switching the neuron off only on the question's tokens, or only where the answer is produced. So far that has been done for 533 of the 85,882 concept–neuron pairs, so most dots are grey.";
    const dsz = (drop) => Math.round(6 + 6 * Math.min(1, drop / 3));          // dot size by log-odds drop: 6 px up to 12 px at 3+
    const cdotTip = (x) => `<b>${esc(x.id)}</b> · layer ${x.L}<br>Switching it off alone drops the answer's log-odds by ${x.drop.toFixed(2)}.<br>` +
      `${x.extra ? "Start of a tested route; not in this concept's stable needed set.<br>" : ""}Where it acts: ${POSLAB[x.pos]}.<br>${x.k < 0 ? "No label yet (outside the 11,000)." : N[x.k].gate.verified ? `Gate: ${esc(N[x.k].gate.short)}` : "Studied here; no verified gate label."}`;
    function setConcept(ci) {
      concept = null; match = null; byId = false;
      if (ci >= 0) {
        const [name, rows] = CX.concepts[ci];
        const mk = (id, drop, ps, extra) => ({ id, L: +id.slice(1).split(":")[0], drop, pos: ps, k: idToK.has(id) ? idToK.get(id) : -1, extra });
        const items = rows.map(([j, d, ps]) => mk(CX.ids[j], d / 100, ps, false));
        const links = FL ? FL.links[ci].map(([a, b, v]) => ({ a: CX.ids[a], b: CX.ids[b], s: v / 1000 })) : [];
        const routes = FL && FL.routes[name] ? FL.routes[name].map(([a, b, rec, dA, ok]) => ({ a, b, rec, dA, ok: !!ok })) : [];
        for (const r of routes) {                                 // a route's source may sit outside the stable needed set
          if (!items.some((x) => x.id === r.a)) items.push(mk(r.a, r.dA, 0, true));
          if (!items.some((x) => x.id === r.b)) items.push(mk(r.b, 0, 0, true));
        }
        concept = { ci, name, items, links, routes };
        match = new Set(items.filter((x) => x.k >= 0).map((x) => x.id));
        sel = items[0].L;                                       // open on the layer of the most-needed neuron
      }
      all();
    }
    const inLayer = (L) => byLayer[L].filter((k) => inSet(N[k]));

    /* the overview: one 100%-stacked bar per layer, or each bar against the layer's 12,288 neurons */
    function overview() {
      const rows = [];
      for (let L = 0; L < NL; L++) {
        const S = inLayer(L), T = S.length, cnt = CAT.map(([c]) => S.filter((k) => N[k]._c === c).length);
        const cs = concept ? concept.items.filter((x) => x.L === L) : null;
        const hits = cs ? cs.length : match && !byId ? S.filter((k) => match.has(N[k].id)).length : 0;
        const dots = cs && cs.length ? `<span class="cdots">${cs.map((x) => `<i data-id="${x.id}" class="cdot tp${x.k < 0 ? " nolab" : ""}${x.extra ? " extra" : ""}" style="--c:var(--pos${x.pos});--d:${dsz(x.drop)}px" data-t="${esc(cdotTip(x))}"></i>`).join("")}</span>` : "";
        const segs = CAT.map(([c, lab], j) => cnt[j] ? `<span class="seg tp${dim.has(c) ? " dim" : ""}" style="flex-grow:${cnt[j]};background:${COL[c]}" data-t="${esc(
          `<b>Layer ${L} · ${lab.toLowerCase()}</b><br>${fmt(cnt[j])} of ${fmt(T)} neurons (${(100 * cnt[j] / T).toFixed(1)}%)` +
          (whole ? `<br><span class="tl">${(100 * cnt[j] / NI).toFixed(2)}% of the layer's ${fmt(NI)}</span>` : ""))}"></span>` : "").join("");
        const w = whole ? `width:${(100 * T / NI).toFixed(3)}%` : "width:100%";
        rows.push(`<button type="button" class="orow${L === sel ? " sel" : ""}" data-l="${L}" aria-pressed="${L === sel}" aria-label="Layer ${L}: ${T} neurons, ${CAT.map(([, lab], j) => `${cnt[j]} ${lab.toLowerCase()}`).join(", ")}">` +
          `<span class="olab" aria-hidden="true">${L % 5 === 0 || L === NL - 1 ? "L" + L : ""}</span>` +
          `<span class="otrack${whole ? " whole" : ""}"><span class="obar${concept ? " faded" : ""}" style="${w}">${segs}</span>${dots}</span>` +
          `<span class="ocount">${whole ? `${fmt(T)} of ${fmt(NI)}` : fmt(T)}</span><span class="ohit">${hits ? fmt(hits) : ""}</span></button>`);
      }
      ov.innerHTML = rows.join(""); arm(ov);
      flows();
    }
    /* flow lines over the bars: faint weight links, dark tested routes (dashed when not confirmed) */
    function flows() {
      const wrap = ov.parentElement; let svg = wrap.querySelector("svg.flows");
      if (!concept || (!linksOn && !routesOn) || !(concept.links.length + concept.routes.length)) { if (svg) svg.remove(); return; }
      if (!svg) { svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "flows"); wrap.appendChild(svg); }
      const box = wrap.getBoundingClientRect(), at = {};
      ov.querySelectorAll(".cdot[data-id]").forEach((el) => { const r = el.getBoundingClientRect(); at[el.dataset.id] = [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top]; });
      svg.setAttribute("width", box.width); svg.setAttribute("height", box.height);
      const curve = (a, b) => { const [x1, y1] = at[a], [x2, y2] = at[b], bend = 18 + Math.min(60, (y2 - y1) / 6); return `M${x1} ${y1} C${x1 + bend} ${y1 + (y2 - y1) / 3} ${x2 + bend} ${y2 - (y2 - y1) / 3} ${x2} ${y2}`; };
      let h = "";
      if (linksOn) for (const l of concept.links) if (at[l.a] && at[l.b]) h += `<path class="wl" style="opacity:${(0.25 + Math.min(0.5, l.s * 2)).toFixed(2)}" d="${curve(l.a, l.b)}"/>`;
      if (routesOn) for (const r of concept.routes) if (at[r.a] && at[r.b]) {
        const tip = `<b>Tested route</b> ${esc(r.a)} → ${esc(r.b)}<br>Switching off ${esc(r.a)} drops the answer's log-odds by ${r.dA.toFixed(2)}; restoring ${esc(r.b)} undoes ${Math.round(100 * r.rec)}% of that.<br>` +
          (r.ok ? `Confirmed: above the noise floor (${Math.round(100 * FL.floor)}%).` : `Not confirmed: at or below the noise floor (${Math.round(100 * FL.floor)}%).`) + `<br><span class="tl">Single routes can flip between GPU types (about 1 in 5).</span>`;
        const d = curve(r.a, r.b);
        h += `<path class="rt${r.ok ? "" : " no"}" d="${d}"/><path class="rthit tp" data-t="${esc(tip)}" d="${d}"/>`;
      }
      svg.innerHTML = h; arm(svg);
    }
    /* the chosen layer: one square per neuron, sized to fit */
    function squares() {
      const S = inLayer(sel), n = S.length, W = grid.parentElement.clientWidth || 300;
      let s = 16, cols = 1;
      for (; s >= 10; s--) { cols = Math.max(1, Math.floor((W + 2) / (s + 2))); if (Math.ceil(n / cols) * (s + 2) <= 420) break; }
      s = Math.max(s, 10); cols = Math.max(1, Math.floor((W + 2) / (s + 2)));
      grid.style.gridTemplateColumns = `repeat(${cols}, ${s}px)`; grid.style.gridAutoRows = s + "px";
      $("layerHead").textContent = `Layer ${sel} · ${fmt(n)} neurons, sorted by how much is labelled`;
      grid.innerHTML = S.map((k) => {
        const m = N[k], c = ["sq"];
        if (dim.has(m._c) || (match && !byId && !match.has(m.id))) c.push("dim");
        if (koOn && m.ko > 0) c.push("ko");
        if (match && (byId || concept) && match.has(m.id)) c.push("hit");
        if (k === pinned) c.push("pin");
        return `<i class="${c.join(" ")}" data-k="${k}" style="background:${COL[m._c]}"></i>`;
      }).join("");
      clist();
    }
    function clist() {
      const el = $("clist");
      if (!concept) { el.hidden = true; el.innerHTML = ""; return; }
      const cs = concept.items.filter((x) => x.L === sel);
      el.hidden = false;
      const DROPTIP = "How much switching this neuron off alone hurts the right answer: the drop in its log-odds, averaged over the concept's questions. 3 means the odds fall about 20-fold; 7 about 1,000-fold.";
      el.innerHTML = `<h5>Needed by ${esc(concept.name)} in layer ${sel}</h5>` + (cs.length ? `<div class="crow chead"><span></span><span>Neuron</span><span>${det("Drop", DROPTIP)}</span><span>Gate label</span></div>` : "") + (!cs.length ? `<span class="muted">None in this layer. Pick a layer with dots.</span>`
        : cs.map((x) => `<button type="button" class="crow${x.k < 0 ? " nolab" : ""}"${x.k < 0 ? ' tabindex="-1"' : ` data-k="${x.k}"`}><i class="cdot${x.k < 0 ? " nolab" : ""}" style="--c:var(--pos${x.pos})"></i>` +
          `<span class="cid">${esc(x.id)}</span><span class="cdrop">${x.drop.toFixed(2)}</span><span class="clab${x.k >= 0 && N[x.k].gate.verified ? "" : " muted"}">` +
          `${x.k < 0 ? "no label yet" : esc(N[x.k].gate.short || "no verified gate label")}</span></button>`).join(""));
      arm(el);
    }
    const mark = () => grid.querySelectorAll(".sq").forEach((el) => { const k = +el.dataset.k; el.classList.toggle("pin", k === pinned); el.classList.toggle("hov", k === hover && k !== pinned); });
    function key() {
      const S = N.filter(inSet);
      if (concept) {
        $("key").innerHTML = `<div class="ckey"><span><b>${det("Where it acts:", POSTIP)}</b></span>` + POSLAB.map((t, j) => `<span><i class="cdot" style="--c:var(--pos${j})"></i>${esc(t)}</span>`).join("") +
          `<span><i class="cdot" style="--c:var(--ink)"></i>studied here</span><span><i class="cdot nolab" style="--c:var(--ink)"></i>no label yet</span><span>size: ${det("log-odds drop", "How much switching the neuron off alone hurts the right answer (the drop in its log-odds, averaged over the concept's questions). 3 means the odds fall about 20-fold.")}</span>` +
          (FL ? `<label><input type="checkbox" id="linksBox"${linksOn ? " checked" : ""}><i class="ln"></i>weight links (${concept.links.length}; not shown to be causal)</label>` +
            `<label><input type="checkbox" id="routesBox"${routesOn ? " checked" : ""}><i class="ln rt"></i>tested route, confirmed <i class="ln no"></i>not confirmed (${concept.routes.length} tested)</label>` : "") + `</div>`;
        arm($("key"));
        const lb = $("linksBox"), rb = $("routesBox");
        if (lb) lb.addEventListener("change", () => { linksOn = lb.checked; flows(); });
        if (rb) rb.addEventListener("change", () => { routesOn = rb.checked; flows(); });
        $("koLab").textContent = `Breaks concepts (${fmt(S.filter((n) => n.ko > 0).length)})`;
        return;
      }
      $("key").innerHTML = CAT.map(([c, lab]) => `<button type="button" data-c="${c}" aria-pressed="${!dim.has(c)}" title="Click to ${dim.has(c) ? "show" : "dim"} this group"><i style="background:${COL[c]}"></i>${lab} <span class="n">${fmt(S.filter((n) => n._c === c).length)}</span></button>`).join("");
      $("koLab").textContent = `Breaks concepts (${fmt(S.filter((n) => n.ko > 0).length)})`;
      const T = S.length, A = N.length, M = NL * NI;
      $("modelwide").textContent = `${fmt(A)} of ${fmt(M)} neurons studied so far (${(100 * A / M).toFixed(1)}%), about ${fmt(Math.round(T / NL))} per layer.`;
    }
    function summary() {
      const S = N.filter(inSet), T = S.length;
      if (concept) {
        const it = concept.items.filter((x) => !x.extra), ls = new Set(it.map((x) => x.L)).size, st = it.filter((x) => x.k >= 0).length, ms = it.filter((x) => x.pos > 0).length;
        $("summary").innerHTML = `<b>${esc(concept.name)}</b> clearly needs ${fmt(it.length)} neuron${it.length === 1 ? "" : "s"} across ${ls} layer${ls === 1 ? "" : "s"}: switching any one off alone drops the right answer beyond the noise bar. ` +
          `${fmt(st)} are among the 11,000 studied here; ${fmt(it.length - st)} have no label yet. ` +
          (concept.routes.length ? `${concept.routes.length} route${concept.routes.length === 1 ? " was" : "s were"} tested by knockout, ${concept.routes.filter((r) => r.ok).length} confirmed` +
            (concept.items.some((x) => x.extra) ? "; square dots are routes' starting neurons outside that set. " : ". ") : "No routes were tested by knockout for this concept. ") + ` ${ms ? `Where it acts was tested for ${fmt(ms)}.` : "Where it acts hasn't been tested for this concept."} ` +
          `<button type="button" class="chip cclear" id="cclear">× clear concept</button><br><span class="muted">One concept is an example, not evidence: across 400 held-out neurons, labels agree with knockouts in early (+0.23) and late (+0.14) layers, and the whole chain holds for 6%.</span>`;
        $("cclear").addEventListener("click", () => { find.value = ""; setConcept(-1); });
        return;
      }
      if (!match) { $("summary").innerHTML = `${fmt(T)} neurons.`; return; }
      const h = S.filter((n) => match.has(n.id)), ls = new Set(h.map((n) => n.L)).size;
      $("summary").innerHTML = !h.length ? `None of these ${fmt(T)} match. Earlier, concept-by-concept results are on <a href="../map/">the concept map</a>.`
        : byId ? `Neuron ${esc(h[0].id)} is in layer ${h[0].L}.` : `${fmt(h.length)} of ${fmt(T)} neurons match, in ${ls} layer${ls === 1 ? "" : "s"}.`;
    }
    const all = () => { key(); summary(); overview(); squares(); };

    // the details live in one file per layer, fetched the first time a neuron in that layer is hovered or pinned
    const layers = {}, detail = {};
    const loadLayer = (L) => layers[L] || (layers[L] = fetch(`data/neurons/L${L}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => { detail[L] = d.neurons; }).catch((e) => { delete layers[L]; throw e; }));
    const setName = (n) => n.set === "bridge" ? "random sample · bridge (also in the earlier run)" : n.set === "random" ? "random sample" : "knockout-linked";
    let paneK = -2, waitT = null;
    function quickLine(n) {
      const what = (p, none) => !p.verified ? `<span class="muted">${none}</span>` : `${esc(p.short)}${p.gen === false ? ' <span class="muted">(exam only)</span>' : ""}`;
      const row = (k, v) => `<span class="k">${k}</span><span>${v}</span>`;
      return `<span class="sumgrid">${row("Gate:", `opens for ${what(n.gate, "nothing we can name yet")}`)}${row("Positive:", what(n.pos, "no verified label"))}${row("Negative:", what(n.neg, "no verified label"))}</span>`;
    }
    function panel(k) {
      paneK = k; clearTimeout(waitT);
      if (k < 0) { pane.innerHTML = `<span class="muted">Hover over a square to see what we know about that neuron. Click to pin it here.</span>`; return; }
      const n = N[k], d = detail[n.L] && detail[n.L][n.id];
      const pin = k === pinned ? `<button type="button" class="chip pin" id="unpin">📌 Pinned · unpin</button>` : "";
      const head = `${pin}<h4>Neuron ${esc(n.id)}</h4><p class="sub">Layer ${n.L} · ${esc(LVLAB[n._lv])} · ${setName(n)}</p>`;
      if (d) {
        pane.innerHTML = `${head}<p class="one">${oneLine(d)}</p>${PARTS.map(([p, t]) => partBox(t, d[p], p !== "gate" ? d.job[p] : null)).join("")}${launcherBox(d)}`;
        arm(pane);
      } else {
        pane.innerHTML = `${head}<p class="one">${quickLine(n)}</p><p class="loading"><span class="spin" aria-hidden="true"></span>Loading the details…</p>`;
        // on hover, wait a beat so sweeping across the squares doesn't fetch on every one
        waitT = setTimeout(() => loadLayer(n.L).then(() => { if (paneK === k) panel(k); })
          .catch((e) => { if (paneK === k) pane.querySelector(".loading").textContent = `Couldn't load the details (${e.message}).`; }), k === pinned ? 0 : 150);
      }
      const b = $("unpin"); if (b) b.addEventListener("click", () => { pinned = -1; mark(); panel(hover); });
    }

    // squares: hover previews, click pins (click again to unpin)
    const sqOf = (e) => e.target.closest && e.target.closest(".sq");
    grid.addEventListener("mouseover", (e) => { const el = sqOf(e); if (!el) return; const k = +el.dataset.k; if (k !== hover) { hover = k; mark(); if (pinned < 0) panel(k); } });
    grid.addEventListener("mouseleave", () => { hover = -1; mark(); panel(pinned); });
    $("clist").addEventListener("click", (e) => { const b = e.target.closest(".crow[data-k]"); if (!b) return; const k = +b.dataset.k; pinned = k; mark(); panel(k); });
    grid.addEventListener("click", (e) => { const el = sqOf(e); if (!el) return; const k = +el.dataset.k; pinned = k === pinned ? -1 : k; mark(); panel(pinned >= 0 ? pinned : k); });
    // the overview: click (or Enter) picks a layer; up and down arrows move through them
    const pick = (L, focus) => { sel = clamp(L, 0, NL - 1); overview(); squares(); if (focus) ov.querySelector(`[data-l="${sel}"]`).focus(); };
    // on a phone the squares sit below the bars, so bring them into view
    ov.addEventListener("click", (e) => { const r = e.target.closest(".orow"); if (!r) return; pick(+r.dataset.l); if (matchMedia("(max-width: 700px)").matches) $("layerHead").scrollIntoView({ block: "start", behavior: "smooth" }); });
    ov.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); pick(sel + (e.key === "ArrowDown" ? 1 : -1), true); } });

    const chips = (id, opts, cur, on) => {
      $(id).innerHTML = opts.map(([k, lab]) => `<button type="button" class="chip" data-v="${k}" aria-pressed="${k === cur}">${lab}</button>`).join("");
      $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; $(id).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); on(b.dataset.v); });
    };
    chips("scale", [["share", "Share of studied neurons"], ["whole", "Share of the whole layer"]], "share", (v) => { whole = v === "whole"; overview(); });
    $("key").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const c = +b.dataset.c; dim.has(c) ? dim.delete(c) : dim.add(c); key(); overview(); squares(); });
    $("koBox").addEventListener("change", () => { koOn = $("koBox").checked; squares(); });
    const find = $("find"), list = $("findList");
    function search() {
      if (concept && find.value === concept.name) return;
      concept = null;
      const t = find.value.trim().toLowerCase();
      byId = /^l\d+:\d+$/.test(t);
      if (!t) match = null;
      else if (byId) {
        const k = N.findIndex((n) => n.id.toLowerCase() === t);
        match = new Set(k >= 0 ? [N[k].id] : []);
        if (k >= 0) {                                   // jump to it: its layer, pinned
          const n = N[k];
          sel = n.L; pinned = k; panel(k);
        }
      } else match = new Set(N.filter((n) => n._s.includes(t)).map((n) => n.id));
      all();
      const hit = grid.querySelector(".hit"); if (hit) hit.scrollIntoView({ block: "nearest" });
    }
    // example neurons: every part passes the exam and the generative check (checked here too; any that doesn't is left out)
    const EX = [["Music", "L31:7508"], ["Colour blue", "L5:576"], ["Novels vs film", "L11:2604"], ["Pandas and wildlife", "L12:3919"], ["Drinks", "L12:10092"],
                ["Job titles", "L24:8003"], ["Football vs basketball", "L32:4814"], ["“But” and “though”", "L8:9447"]]
      .map(([name, id]) => [name, N.findIndex((n) => n.id === id)])
      .filter(([, k]) => k >= 0 && ["gate", "pos", "neg"].every((p) => N[k][p].verified && N[k][p].gen === true));
    const goTo = (k) => { find.value = N[k].id; search(); };
    $("mapEx").insertAdjacentHTML("beforeend", EX.map(([name, k]) => `<button type="button" class="chip" data-k="${k}">${esc(name)}</button>`).join(""));
    $("mapEx").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { closeList(); goTo(+b.dataset.k); } });
    const CEX = ["Amazon rainforest", "Marathon", "Martial arts", "Shark", "Turkish language", "Italian cuisine", "Rainbow", "Old Kingdom of Egypt"];   // the last four have a confirmed route
    const goConcept = (ci) => { find.value = CX.concepts[ci][0]; setConcept(ci); };
    $("mapCx").insertAdjacentHTML("beforeend", CEX.map((name) => `<button type="button" class="chip" data-c="${esc(name)}">${esc(name)}</button>`).join(""));
    $("mapCx").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return; closeList();
      loadConcepts().then(() => { const ci = CX.concepts.findIndex(([name]) => name === b.dataset.c); if (ci >= 0) goConcept(ci); })
        .catch((err) => { $("summary").textContent = `Couldn't load the concepts (${err.message}).`; });
    });

    // the dropdown: up to 12 matches, strongest-labelled first; the examples when the box is empty
    const MAXL = 12;
    let opts = [], act = -1, blurT = null;
    function conceptsFor(t) {
      if (!CX) return [];
      if (!t) return CEX.map((name) => CX.concepts.findIndex(([n]) => n === name)).filter((ci) => ci >= 0);
      if (t.length < 2 || /^l\d/.test(t)) return [];
      const out = [];
      CX._lc.forEach((n, ci) => { if (n.includes(t)) out.push(ci); });
      return out.sort((a, b) => (CX._lc[a].startsWith(t) ? 0 : 1) - (CX._lc[b].startsWith(t) ? 0 : 1) || CX._lc[a].length - CX._lc[b].length).slice(0, 5);
    }
    function candidates(t) {
      if (!t) return { ks: EX.map(([, k]) => k), more: 0 };
      const ks = [];
      N.forEach((n, k) => { if (n.id.toLowerCase().startsWith(t) || n._s.includes(t)) ks.push(k); });
      ks.sort((a, b) => N[b]._c - N[a]._c || N[b]._g - N[a]._g || N[a].L - N[b].L || N[a].i - N[b].i);
      return { ks: ks.slice(0, MAXL), more: Math.max(0, ks.length - MAXL) };
    }
    function openList() {
      const t = find.value.trim().toLowerCase(), { ks, more } = candidates(t), cs = conceptsFor(t);
      opts = [...cs.map((ci) => ({ c: ci })), ...ks.map((k) => ({ k }))]; act = -1;
      if (!opts.length) { closeList(); return; }
      const setLab = (n) => (n.set === "knockout-linked" ? "knockout-linked" : "random");
      const chead = cs.length ? `<li class="fhead" role="presentation">Concepts</li>` + cs.map((ci, j) => {
        const n = CX.concepts[ci][1].length;
        return `<li role="option" id="fo${j}" data-j="${j}" aria-selected="false"><span class="fline"><span class="fid">${esc(CX.concepts[ci][0])}</span>` +
          `<span class="fmeta">concept · needs ${n} neuron${n === 1 ? "" : "s"}</span></span></li>`;
      }).join("") : "";
      list.innerHTML = chead + (ks.length ? `<li class="fhead${cs.length ? " fhead2" : ""}" role="presentation">${t ? "Neurons" : "Example neurons"}</li>` : "") + ks.map((k, jj) => {
        const n = N[k], j = jj + cs.length;
        return `<li role="option" id="fo${j}" data-j="${j}" aria-selected="false"><span class="fline"><span class="fid">${esc(n.id)}</span>` +
          `<span class="fmeta">layer ${n.L} · ${setLab(n)}</span><span class="fbadge b${n._c}">${n._c} of 3</span></span>` +
          `<span class="flab${n.gate.verified ? "" : " muted"}">${esc(n.gate.short || "no gate label")}</span></li>`;
      }).join("") + (more ? `<li class="fmore" role="presentation">… ${fmt(more)} more</li>` : "");
      list.hidden = false; find.setAttribute("aria-expanded", "true"); find.removeAttribute("aria-activedescendant");
    }
    function closeList() { list.hidden = true; opts = []; act = -1; find.setAttribute("aria-expanded", "false"); find.removeAttribute("aria-activedescendant"); }
    function setAct(j) {
      act = (j + opts.length) % opts.length;
      list.querySelectorAll("[role=option]").forEach((li) => { const on = +li.dataset.j === act; li.setAttribute("aria-selected", on); if (on) li.scrollIntoView({ block: "nearest" }); });
      find.setAttribute("aria-activedescendant", "fo" + act);
    }
    find.addEventListener("input", () => { search(); openList(); });
    find.addEventListener("focus", () => { clearTimeout(blurT); openList(); if (!CX) loadConcepts().then(() => { if (document.activeElement === find) openList(); }).catch(() => {}); });
    find.addEventListener("blur", () => { blurT = setTimeout(closeList, 180); });
    find.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeList(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (list.hidden) openList(); if (opts.length) setAct(act < 0 && e.key === "ArrowUp" ? -1 : act + (e.key === "ArrowDown" ? 1 : -1)); return; }
      if (e.key === "Enter" && !list.hidden && act >= 0) { e.preventDefault(); const o = opts[act]; closeList(); o.c !== undefined ? goConcept(o.c) : goTo(o.k); }
    });
    list.addEventListener("mousedown", (e) => e.preventDefault());   // keep the focus in the box
    list.addEventListener("click", (e) => { const li = e.target.closest("[role=option]"); if (!li) return; const o = opts[+li.dataset.j]; closeList(); o.c !== undefined ? goConcept(o.c) : goTo(o.k); });
    const R = I.runs.random, X = I.runs["knockout-linked"];
    $("koNote").textContent = `Knockout results exist for ${fmt(R.ko_tested + X.ko_tested)} of the ${fmt(R.n_ko + X.n)} neurons.`;
    let rt = null, gw = 0;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { flows(); if (grid.parentElement.clientWidth !== gw) { gw = grid.parentElement.clientWidth; squares(); } }, 80); });
    pinned = N.findIndex((n) => n.id === EXAMPLE); sel = pinned >= 0 ? N[pinned].L : 0;
    all(); gw = grid.parentElement.clientWidth; panel(pinned);
  }
  const EXAMPLE = "L31:7508";   // music: every part labelled, and knocking it out breaks singing and bassoon

  /* ---------- plain-English definitions on hover or tap (first mention) ---------- */
  const TERMS = [
    ["MLP layers?", "The part of each layer made of neurons (the other part is attention). Qwen3-8B has 36 layers of 12,288 neurons."],
    ["neurons?", "Small units inside the model. For every token, each one produces a single number: how strongly it's firing."],
    ["gate", "The neuron's first reading of each token: a fixed direction in the model's running total. Passed through SiLU, it sets how far the neuron opens."],
    ["up", "The neuron's second reading of each token. Its sign picks which way the neuron pushes (the + or the − side), and its size scales the push."],
    ["SiLU", "A smooth on-switch: about 0 for negative inputs (dipping slightly below zero), and about the input itself for positive ones."],
    ["activation", "The number a neuron produces for a token. Big means it's firing strongly; the sign says which way it pushes."],
    ["residual stream", "The running total the model carries from layer to layer. Each neuron adds its push to it."],
    ["down vector", "A fixed direction, set by training, that the neuron adds to the model's running total whenever it fires."],
    ["tokens?", "The chunks a model reads and writes text in: a short word, or part of a longer one."],
    ["template sentences", "Short sentences with a gap; every token in the vocabulary is tried in the gap."],
    ["glitch tokens", "Rare, under-trained tokens that produce extreme values in many unrelated neurons."],
    ["LLM", "A large language model, like the one being studied. Here a separate one (Luna) writes the descriptions."],
    ["calibrated judge", "A model whose answers are probabilities that match how often it's right, so its scores can be compared."],
    ["held-out", "Kept back: the describer never saw these tokens, so the exam tests whether the label generalises."],
    ["decoys", "Tokens chosen to look like the real favourites on the surface (similar spelling, script or length) but that the neuron doesn't favour."],
    ["pseudo-neurons", "Fake neurons with random weights in the same range as real ones. A good method should fail to label them."],
    ["logit lens", "Reading a direction inside the model straight through its output table, to see which words it makes more likely."],
    ["knockouts?", "Switching a neuron off (setting it to 0) and measuring what the model can no longer do."],
    ["log-odds", "Chances on a log scale. Unlike probability, it doesn't flatten out near certainty."],
    ["Sparse autoencoders", "A second model trained to rewrite a network's activity into a larger set of more readable features."],
    ["transcoders", "Like sparse autoencoders, but trained to imitate a whole MLP layer with readable features."],
    ["weights", "The model's fixed numbers, set in training. Reading them needs no text and no running."],
    ["AUC", "How well a score separates two groups: 0.5 is guessing, 1 is perfect."],
  ];
  function addTerms() {
    const done = new Set();
    document.querySelectorAll("[data-copy], figcaption").forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      // the earliest new term in each run of text, then the same for the rest of it, so one sentence can hold several
      const walk = (node) => {
        if (!node || node.parentElement.closest("a, .term, .det, h1, h2, .top")) return;
        let best = null;
        for (const [term, tip] of TERMS) {
          if (done.has(term)) continue;
          const m = new RegExp("\\b" + term + "\\b", "i").exec(node.nodeValue);
          if (m && (!best || m.index < best.m.index)) best = { m, term, tip };
        }
        if (!best) return;
        done.add(best.term);
        const after = node.splitText(best.m.index), rest = after.splitText(best.m[0].length);
        const span = document.createElement("span");
        span.className = "term"; span.tabIndex = 0; span._tip = esc(best.tip); span.textContent = after.nodeValue;
        after.replaceWith(span);
        walk(rest);
      };
      nodes.forEach(walk);
    });
  }

  addTerms();
  fetch("data/examples.json").then((r) => r.json()).then(figure1).catch((e) => { $("sceneState").textContent = "Couldn't load the examples (" + e.message + ")."; });
  fetch("data/index.json").then((r) => r.json()).then((I) => { numbers(I); map(I); })
    .catch((e) => { $("pane").textContent = "Couldn't load the map data (" + e.message + ")."; });
})();
