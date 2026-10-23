/* Countersign console. Vanilla JS, no build step.
   The server enforces every rule; this file only decides what to show and offers
   the actions the current person is allowed to take. */
"use strict";

const ROLE_RANK = { client: 0, auditor: 0, junior: 1, manager: 2, partner: 3 };

const LANES = {
  ai_led_spot_check: {
    label: "AI-led, spot-checked",
    explain: "The AI extracts the key terms. Anything below the confidence threshold, plus a random sample of the rest, goes to a person.",
  },
  ai_drafts_human_confirms: {
    label: "AI drafts, a person confirms each item",
    explain: "Every flag needs a decision from a person, and a rejection needs a reason.",
  },
  human_led_blind: {
    label: "Human-led, blind first pass",
    explain: "The reviewer writes their own top risks first. The AI's list stays sealed until they submit.",
  },
  ai_drafts_human_edits: {
    label: "AI drafts, a person edits",
    explain: "Each proposed redline is approved, rejected or rewritten by a person.",
  },
  human_led: {
    label: "Human-led",
    explain: "The manager ranks what to ask for. The AI only supplies benchmark ranges.",
  },
};

const REASONS = {
  verified_against_source: "Checked against the contract",
  client_instruction: "Client instruction",
  market_practice: "In line with market practice",
  not_in_source: "Not in the contract",
  below_materiality: "Below materiality",
  duplicate: "Duplicate",
  better_fit_for_client: "Better fit for the client",
  other: "Other",
};

const EVENT_LABELS = {
  engagement_opened: ["Engagement opened", false],
  milestone_started: ["AI run started", false],
  proposals_generated: ["AI proposals recorded", false],
  proposals_sealed: ["AI list sealed", false],
  blind_assessment_submitted: ["Own risks submitted", true],
  proposals_revealed: ["AI list unsealed", false],
  item_decided: ["Decision recorded", true],
  controls_evaluated: ["Planted checks revealed", false],
  milestone_escalated: ["Escalated to manager", false],
  priorities_set: ["Asks ranked", true],
  milestone_signed: ["Signed", true],
  engagement_released: ["Report signed and released", true],
  engagement_stopped: ["Stopped by client", true],
};

const PRIORITY_LABELS = { must_have: "Must-have", trade_off: "Trade-off", nice_to_have: "Nice to have" };

const money = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const S = {
  user: localStorage.getItem("countersign.user") || "lea.brunner",
  users: [],
  meta: { reason_codes: Object.keys(REASONS), risk_taxonomy: {}, demo: false, seed_stages: [] },
  eid: null,
  summary: null,
  eng: null,
  invoice: null,
  trail: null,
  activity: [],
  verify: null,
  quality: null,
  ledger: [],
  active: null,
  open: null, // { itemId, action }
  justSigned: null,
  busy: false,
};

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const me = () => S.users.find((u) => u.id === S.user) || { id: S.user, role: "junior", name: S.user };
const rank = (role) => ROLE_RANK[role] ?? 0;
const isStaff = () => rank(me().role) >= 1;
const fmtTime = (iso) => (iso ? when.format(new Date(iso)) : "");
const chf = (n) => `CHF ${money.format(n)}`;
const initials = (name) => name.replace(/^Dr\.\s*/, "").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

// ----------------------------------------------------------------- network
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "X-User": S.user, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = typeof data === "object" ? data.detail : data;
    const msg = Array.isArray(detail) ? detail.map((d) => d.msg.replace(/^Value error, /, "")).join("; ") : detail;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data;
}

function toast(message, kind = "") {
  const t = $("#toast");
  t.textContent = message;
  t.className = `toast show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), kind === "error" ? 6000 : 3500);
}

async function act(fn, success) {
  if (S.busy) return;
  S.busy = true;
  try {
    const result = await fn();
    const msg = typeof success === "function" ? success(result) : success;
    if (msg) toast(msg);
    await refresh();
    return result;
  } catch (err) {
    toast(err.message, "error");
  } finally {
    S.busy = false;
  }
}

// ------------------------------------------------------------------- load
async function boot() {
  [S.users, S.meta] = await Promise.all([api("/api/users"), api("/api/meta")]);
  if (!S.users.some((u) => u.id === S.user)) S.user = S.users[0].id;
  const sel = $("#user-select");
  sel.innerHTML = S.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}${rank(u.role) >= 1 ? ` (${esc(u.role)})` : ""}</option>`).join("");
  sel.value = S.user;
  sel.addEventListener("change", async () => {
    S.user = sel.value;
    localStorage.setItem("countersign.user", S.user);
    S.open = null;
    await refresh();
  });
  if (S.meta.demo) {
    $("#demo-reset").hidden = false;
    const rs = $("#reset-select");
    rs.innerHTML = `<option value="">Reset to stage</option>` +
      S.meta.seed_stages.map((s) => `<option value="${esc(s)}">${esc(stageLabel(s))}</option>`).join("");
    rs.addEventListener("change", async () => {
      if (!rs.value) return;
      const stage = rs.value;
      rs.value = "";
      S.active = null;
      S.open = null;
      await act(() => api(`/api/demo/reset?stage=${encodeURIComponent(stage)}`, { method: "POST" }), `Demo reset: ${stageLabel(stage)}`);
    });
  }
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  await refresh();
}

function stageLabel(s) {
  return {
    opened: "Intake done", M1: "Extraction signed", M2: "Benchmark signed", "M3-sealed": "Risk screening, AI list sealed",
    M3: "Risk screening signed", M4: "Redlines signed", M5: "Priorities signed", released: "Report released",
  }[s] || s;
}

async function refresh() {
  const list = await api("/api/engagements").catch(() => []);
  S.summary = list[0] || null;
  S.eid = S.summary?.id || null;
  S.eng = S.invoice = S.trail = S.verify = S.quality = null;
  S.activity = [];
  S.ledger = [];
  if (S.eid) {
    const role = me().role;
    const jobs = [
      api(`/api/engagements/${S.eid}/invoice`).then((d) => (S.invoice = d)),
      api(`/api/engagements/${S.eid}/trail`).then((d) => (S.trail = d)),
      api(`/api/engagements/${S.eid}/ledger/verify`).then((d) => (S.verify = d)),
    ];
    if (role !== "client") {
      jobs.push(api(`/api/engagements/${S.eid}`).then((d) => (S.eng = d)));
      jobs.push(api(`/api/engagements/${S.eid}/activity`).then((d) => (S.activity = d)));
    }
    if (role === "auditor") {
      jobs.push(api(`/api/reviewers/lea.brunner/quality`).then((d) => (S.quality = d)));
      jobs.push(api(`/api/engagements/${S.eid}/ledger`).then((d) => (S.ledger = d)));
    }
    await Promise.all(jobs.map((j) => j.catch((e) => console.warn(e))));
  }
  render();
}

// ----------------------------------------------------------------- render
function render() {
  renderHeader();
  const role = me().role;
  if (!S.eid) {
    $("#rail").innerHTML = "";
    $("#side").innerHTML = "";
    $("#work").innerHTML = `<section class="panel panel-pad"><h2>No engagements yet</h2><p class="muted">Open one through the API, or start the server with <code>COUNTERSIGN_SEED=M2</code> to load the Alpina case.</p></section>`;
    return;
  }
  if (role === "client") {
    $("#rail").innerHTML = "";
    $("#work").innerHTML = renderClient();
  } else if (role === "auditor") {
    $("#rail").innerHTML = "";
    $("#work").innerHTML = renderBackstage();
  } else {
    if (!S.active) S.active = defaultStep();
    $("#rail").innerHTML = renderRail();
    $("#work").innerHTML = renderStep();
  }
  $("#side").innerHTML = renderSide();
  $("#layout").classList.toggle("layout--wide", role === "client" || role === "auditor");
  if (S.justSigned) setTimeout(() => (S.justSigned = null), 600);
}

function renderHeader() {
  const s = S.summary;
  $("#matter").innerHTML = s
    ? `<div><strong>${esc(s.client)}</strong> and ${esc(S.eng?.counterparty || S.trail?.counterparty || "")}<span class="level level-${esc(s.review_level)}">${esc(cap(s.review_level))} review</span></div>
       <div class="sub">${esc(s.matter)}</div>`
    : "";
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function defaultStep() {
  const ms = S.eng.milestones.find((m) => m.status !== "signed");
  return ms ? ms.key : "release";
}

function stepStatusText(m) {
  const line = S.invoice?.lines.find((l) => l.milestone === m.key);
  return {
    not_started: "Not started",
    awaiting_blind_assessment: "Waiting for your own risks",
    in_review: `In review, ${m.pending} open`,
    escalated: "Escalated to manager",
    ready_to_sign: "Ready to sign",
    signed: line ? `Signed, billed ${chf(line.amount)}` : "Signed",
  }[m.status];
}

function renderRail() {
  const e = S.eng;
  const prevSigned = (i) => i === 0 || e.milestones[i - 1].status === "signed";
  const items = [
    `<li><button class="step is-signed" data-step="intake" ${S.active === "intake" ? 'aria-current="step"' : ""}>
       <span class="step-num">0</span><span><span class="step-title">Intake</span><span class="step-meta">${esc(cap(e.review_level))} review set</span></span></button></li>`,
    ...e.milestones.map((m, i) => {
      const cls = m.status === "signed" ? "is-signed" : m.status === "escalated" ? "is-escalated"
        : ["awaiting_blind_assessment", "in_review", "ready_to_sign"].includes(m.status) ? "is-attention"
        : !prevSigned(i) ? "is-locked" : "";
      return `<li><button class="step ${cls}" data-step="${m.key}" ${S.active === m.key ? 'aria-current="step"' : ""}>
        <span class="step-num">${i + 1}</span><span><span class="step-title">${esc(m.title)}</span><span class="step-meta">${esc(stepStatusText(m))}</span></span></button></li>`;
    }),
    `<li><button class="step ${e.status === "released" ? "is-signed" : ""}" data-step="release" ${S.active === "release" ? 'aria-current="step"' : ""}>
       <span class="step-num">6</span><span><span class="step-title">Final sign-off</span><span class="step-meta">${e.status === "released" ? "Released to client" : `By the ${esc(e.policy.final_signer)}`}</span></span></button></li>`,
  ];
  return `<ol>${items.join("")}</ol>`;
}

function renderStep() {
  if (S.active === "intake") return renderIntake();
  if (S.active === "release") return renderRelease();
  const ms = S.eng.milestones.find((m) => m.key === S.active);
  return ms ? renderMilestone(ms) : "";
}

// ---------------------------------------------------------------- intake
function renderIntake() {
  const e = S.eng;
  const p = e.policy;
  const team = Object.entries(e.team).map(([role, u]) => `<dt>${esc(cap(role))}</dt><dd>${esc(u.name)}</dd>`).join("");
  return `<section class="panel">
    <div class="ms-head"><span class="ms-kicker">Step 0 of 6</span><h2>Intake</h2>
      <p class="lane">The client team answered the questionnaire. The review level follows from published rules, so nobody has to trust a hidden score.</p></div>
    <div class="ms-body">
      <dl class="facts">
        <dt>Client is the</dt><dd>${esc(e.intake.client_role)}</dd>
        <dt>Priorities</dt><dd>${esc(e.intake.priorities.join(", "))}</dd>
        <dt>Client importance</dt><dd>${esc(e.intake.client_importance)}</dd>
        <dt>Term</dt><dd>${esc(e.intake.term_years)} years</dd>
        <dt>Annual value</dt><dd>${chf(e.intake.annual_value_chf)}</dd>
        <dt>Commercial tier</dt><dd>${e.tier === "assisted" ? "Assisted: fixed price per signed milestone" : "Agent-led subscription"}</dd>
      </dl>
      <div class="notice ink"><h4>Review level: ${esc(cap(e.review_level))}</h4>
        <ul class="rules">${e.review_rationale.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>
      <h3 class="section-gap">What ${esc(e.review_level)} review means here</h3>
      <ul class="rules">
        <li>AI output below ${Math.round(p.confidence_threshold * 100)}% confidence goes to a person.</li>
        <li>${Math.round(p.spot_check_rate * 100)}% of the confident AI output is spot-checked anyway.</li>
        <li>${p.controls_per_engagement} planted check${p.controls_per_engagement === 1 ? " is" : "s are"} hidden in the AI's output. Approving one escalates the step to the manager.</li>
        <li>Each milestone is signed by name. The final report is signed by the ${esc(p.final_signer)}.</li>
      </ul>
      <h3 class="section-gap">Team</h3><dl class="facts">${team}</dl>
    </div></section>`;
}

// ------------------------------------------------------------- milestone
function canDecide(ms) {
  const u = me();
  if (!isStaff() || ms.status === "signed" || S.eng.status !== "open") return false;
  if (!Object.values(S.eng.team).some((t) => t.id === u.id)) return false;
  const need = ms.escalation ? ms.escalation.required_role : ms.signer_role;
  return rank(u.role) >= rank(need);
}

function renderMilestone(ms) {
  const idx = S.eng.milestones.indexOf(ms);
  const lane = LANES[ms.lane];
  const head = `<div class="ms-head"><span class="ms-kicker">Step ${idx + 1} of 6, ${esc(lane.label)}</span>
    <h2>${esc(ms.title)}</h2><p class="lane">${esc(lane.explain)}</p></div>`;
  let body = "";

  if (ms.status === "not_started") {
    const prev = S.eng.milestones[idx - 1];
    const blocked = prev && prev.status !== "signed";
    const allowed = isStaff() && rank(me().role) >= rank(ms.signer_role);
    body = blocked
      ? `<div class="notice ochre"><h4>Waiting for step ${idx}</h4><p>${esc(prev.title)} has to be signed first. Each step is bought and billed on its own.</p></div>`
      : allowed && S.eng.status === "open"
        ? `<div class="notice ink"><h4>Ready to run</h4><p>${ms.lane === "human_led_blind" ? "The AI will prepare its list and seal it. You will see it only after writing down your own risks." : "The AI prepares its proposals. Nothing counts until a person decides and signs."}</p>
           <div class="actions" style="margin-top:12px"><button class="btn btn-ink" data-action="start" data-key="${ms.key}">Run the AI for this step</button></div></div>`
        : `<div class="notice"><p>This step is run by a ${esc(ms.signer_role)} or above.</p></div>`;
    return `<section class="panel">${head}<div class="ms-body">${body}</div></section>`;
  }

  if (ms.status === "awaiting_blind_assessment") {
    return `<section class="panel">${head}<div class="ms-body">${renderSealed(ms)}</div></section>`;
  }

  if (ms.escalation) {
    body += `<div class="notice oxblood"><h4>Escalated to the manager</h4><p>A planted check in this step was approved, so the source was not verified. ${esc(S.eng.team.manager.name)} must review the items and sign instead.</p></div>`;
  }
  if (ms.controls && ms.controls.passed) {
    body += `<div class="notice moss"><h4>Planted check caught</h4><p>${ms.controls.control_item_ids.map(esc).join(", ")} was a deliberately false AI finding. Rejecting it shows the contract was actually checked.</p></div>`;
  }
  if (ms.lane === "human_led_blind" && ms.gap) body += renderGap(ms);
  if (ms.key === "M5" || ms.lane === "human_led") body += renderPriorities(ms);

  const items = ms.items.filter((i) => ms.lane !== "human_led" || i.route !== "informational");
  if (items.length) body += `<ol class="items">${items.map((it) => renderItem(ms, it)).join("")}</ol>`;
  return `<section class="panel">${head}<div class="ms-body">${body}</div>${renderSignbar(ms)}${renderSignatures(ms.signatures, ms.key)}</section>`;
}

function renderSealed(ms) {
  const reviewer = S.eng.team[ms.signer_role];
  const mine = reviewer && reviewer.id === S.user;
  const codes = Object.entries(S.meta.risk_taxonomy);
  const row = (i) => `<div class="finding-row">
      <label class="field"><span>Risk type</span><select name="code-${i}"><option value="">Choose a type</option>${codes.map(([c, l]) => `<option value="${esc(c)}">${esc(c)}: ${esc(l)}</option>`).join("")}</select></label>
      <label class="field"><span>What could go wrong</span><input name="desc-${i}" placeholder="In your own words"></label>
      <span></span></div>`;
  return `<div class="sealed">
      <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="9" y="18" width="22" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 18v-5a6 6 0 0 1 12 0v5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      <div><strong>The AI's list is sealed: ${ms.sealed.count} items</strong>
        <p class="muted">Its fingerprint is already on the record, so it cannot change after you answer: <span class="mono">${esc(ms.sealed.commitment.slice(0, 24))}…</span></p></div>
    </div>
    ${mine
      ? `<form class="findings" data-form="blind" data-key="${ms.key}">
          <p>Before you see the AI's list, write down the risks you see. The gap between your list and the AI's becomes your learning record.</p>
          ${[0, 1, 2].map(row).join("")}
          <div class="actions"><button class="btn btn-ink" type="submit">Submit my risks and open the AI list</button></div>
        </form>`
      : `<div class="notice"><p>Waiting for ${esc(reviewer?.name || "the reviewer")} to write their own risks.</p></div>`}`;
}

function renderGap(ms) {
  const g = ms.gap;
  const list = (a) => (a.length ? a.map((c) => `${esc(c)} <span class="muted">${esc(S.meta.risk_taxonomy[c] || "")}</span>`).join("<br>") : `<span class="muted">None</span>`);
  return `<div class="gap">
    <div><strong>Found by both</strong><div class="codes">${list(g.matched)}</div></div>
    <div class="learn"><strong>Only the AI found</strong><div class="codes">${list(g.ai_only)}</div></div>
    <div><strong>Only ${esc(ms.blind_by || "the reviewer")} found</strong><div class="codes">${list(g.human_only)}</div></div>
  </div>`;
}

function renderItem(ms, it) {
  const pct = Math.round(it.confidence * 100);
  const low = it.route === "low_confidence";
  const tags = [
    `<span class="mono">${esc(it.id)}</span>`,
    it.clause_ref ? `<span class="tag">Clause ${esc(it.clause_ref)}</span>` : "",
    it.risk_code ? `<span class="tag">Risk ${esc(it.risk_code)}</span>` : "",
    low ? `<span class="tag low">Low confidence</span>` : "",
    it.route === "spot_check" ? `<span class="tag spot">Spot check</span>` : "",
    `<span class="conf ${low ? "is-low" : ""}" title="AI confidence"><span class="conf-bar"><i style="width:${pct}%"></i></span>${pct}%</span>`,
  ].join("");
  const d = it.data || {};
  let extra = "";
  if (d.value) extra = `<dl><dt>Extracted</dt><dd>${esc(d.value)}</dd></dl>`;
  if (d.contract) extra = `<dl><dt>Contract</dt><dd>${esc(d.contract)}</dd><dt>Market</dt><dd>${esc(d.market)}</dd></dl>`;
  if (d.proposed_text) extra = `<div class="proposed">${esc(d.proposed_text)}</div>`;
  return `<li class="item" id="item-${esc(it.id)}">
    <div class="ai"><div class="ai-meta">${tags}</div><h4>${esc(it.title)}</h4><p>${esc(it.detail)}</p>${extra}</div>
    ${renderHuman(ms, it)}
  </li>`;
}

function renderHuman(ms, it) {
  const open = S.open && S.open.itemId === it.id;
  const may = canDecide(ms);
  if (open) return `<div class="human is-decided">${renderDecideForm(ms, it, S.open.action)}</div>`;

  if (it.decision) {
    const dec = it.decision;
    const label = { approve: "Approved", reject: "Rejected", edit: "Rewritten" }[dec.action];
    const control = it.control_outcome
      ? `<p class="control-flag ${it.control_outcome}">${it.control_outcome === "caught" ? "This was a planted check, and it was caught." : "This was a planted check, and it was approved."}</p>`
      : "";
    const change = may && ms.status !== "signed" ? `<p style="margin-top:8px"><button class="btn-link" data-action="open" data-item="${esc(it.id)}" data-act="${dec.action}">Change decision</button></p>` : "";
    return `<div class="human is-decided"><div class="verdict">
      <p><span class="act ${dec.action}">${label}</span> by <span class="who">${esc(it.decided_by)}</span> <span class="muted">${esc(fmtTime(it.decided_at))}</span></p>
      ${dec.reason_code ? `<p class="reason">${esc(REASONS[dec.reason_code])}${dec.reason_text ? `: ${esc(dec.reason_text)}` : ""}</p>` : dec.reason_text ? `<p class="reason">${esc(dec.reason_text)}</p>` : ""}
      ${dec.resolved_value ? `<p class="reason"><span class="muted">Resolved:</span> ${esc(dec.resolved_value)}</p>` : ""}
      ${dec.follow_up ? `<p class="reason"><span class="muted">Follow-up:</span> ${esc(dec.follow_up)}</p>` : ""}
      ${dec.evidence_ref ? `<p class="reason"><span class="muted">Evidence:</span> ${esc(dec.evidence_ref)}</p>` : ""}
      ${dec.revised_text ? `<div class="revised">${esc(dec.revised_text)}</div>` : ""}
      ${control}${change}</div></div>`;
  }
  if (it.route === "auto_accepted") {
    return `<div class="human is-auto"><p class="muted">Accepted without review: ${Math.round(it.confidence * 100)}% is above the ${Math.round(S.eng.policy.confidence_threshold * 100)}% threshold.</p>
      ${may && ms.status !== "signed" ? `<p style="margin-top:8px"><button class="btn-link" data-action="open" data-item="${esc(it.id)}" data-act="approve">Check it anyway</button></p>` : ""}</div>`;
  }
  if (it.route === "informational") return `<div class="human"><p class="muted">Reference only.</p></div>`;
  if (!may) {
    const who = ms.escalation ? S.eng.team.manager.name : S.eng.team[ms.signer_role]?.name;
    return `<div class="human"><p class="muted">Waiting for a decision from ${esc(who || "the reviewer")}.</p></div>`;
  }
  const lane = ms.lane;
  return `<div class="human"><p class="muted" style="margin-bottom:8px">${it.route === "low_confidence" ? "The AI is unsure. Check the clause and record what it says." : "Your decision"}</p>
    <div class="actions">
      <button class="btn btn-approve" data-action="open" data-item="${esc(it.id)}" data-act="approve">Approve</button>
      <button class="btn btn-reject" data-action="open" data-item="${esc(it.id)}" data-act="reject">Reject</button>
      ${lane === "ai_drafts_human_edits" ? `<button class="btn" data-action="open" data-item="${esc(it.id)}" data-act="edit">Rewrite</button>` : ""}
    </div></div>`;
}

function renderDecideForm(ms, it, action) {
  const prior = it.decision && it.decision.action === action ? it.decision : null;
  const chips = S.meta.reason_codes.map((c) => `<label class="chip"><input type="radio" name="reason_code" value="${esc(c)}" ${prior?.reason_code === c ? "checked" : ""}><span>${esc(REASONS[c] || c)}</span></label>`).join("");
  const verb = { approve: "Approve", reject: "Reject with this reason", edit: "Save the rewrite" }[action];
  return `<form class="decide-form" data-form="decide" data-key="${ms.key}" data-item="${esc(it.id)}" data-act="${action}">
    <strong class="verdict">${{ approve: "Approve", reject: "Reject", edit: "Rewrite" }[action]} ${esc(it.id)}</strong>
    ${action === "edit" ? `<label>Your version<textarea name="revised_text" required>${esc(prior?.revised_text || it.data?.proposed_text || "")}</textarea></label>` : ""}
    ${it.route === "low_confidence" ? `<label>What the clause actually says<input name="resolved_value" value="${esc(prior?.resolved_value || "")}" placeholder="Your reading of the clause"></label>` : ""}
    <div><span class="muted" style="font-size:13.5px">Reason ${action === "approve" ? "(optional)" : "(required)"}</span><div class="chips" style="margin-top:4px">${chips}</div></div>
    <label>In your words<textarea name="reason_text" placeholder="${action === "approve" ? "Optional" : "Why"}">${esc(prior?.reason_text || "")}</textarea></label>
    <label>Evidence<input name="evidence_ref" value="${esc(prior?.evidence_ref || "")}" placeholder="e.g. client email, 14 Oct"></label>
    <div class="actions"><button class="btn btn-ink" type="submit">${verb}</button><button class="btn" type="button" data-action="cancel">Cancel</button></div>
  </form>`;
}

function renderPriorities(ms) {
  const refs = ms.items.filter((i) => i.route === "informational");
  const refBlock = refs.length
    ? `<h3 style="margin-top:16px">Benchmark ranges from the AI</h3><ul class="rules">${refs.map((r) => `<li><strong>${esc(cap(r.title.replace(/^Benchmark: /, "")))}</strong>: <span class="muted">${esc(r.detail)}</span></li>`).join("")}</ul>`
    : "";
  if (ms.priorities.length) {
    const rows = ms.priorities.map((a) => {
      const cls = { must_have: "prio-must", trade_off: "prio-trade", nice_to_have: "prio-nice" }[a.priority];
      return `<li><span class="${cls}">${PRIORITY_LABELS[a.priority]}</span><span>${esc(a.label)}${a.ref_item_id ? ` <span class="mono muted">${esc(a.ref_item_id)}</span>` : ""}${a.note ? `<br><span class="muted">${esc(a.note)}</span>` : ""}</span></li>`;
    }).join("");
    return `${refBlock}<h3 style="margin-top:20px">Asks, ranked by <span class="verdict"><span class="who">${esc(ms.priorities_by)}</span></span></h3><ul class="prio-list">${rows}</ul>`;
  }
  const redlines = S.eng.milestones.find((m) => m.key === "M4")?.items.filter((i) => i.decision && i.decision.action !== "reject") || [];
  const may = canDecide(ms);
  if (!may) return `${refBlock}<div class="notice"><p>Waiting for ${esc(S.eng.team.manager.name)} to rank the asks.</p></div>`;
  const opt = (sel) => Object.entries(PRIORITY_LABELS).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
  const row = (r, i) => `<div class="prio-row">
      <label class="field"><span>Ask</span><input name="label-${i}" value="${esc(r.title)}"></label>
      <label class="field"><span>Priority</span><select name="prio-${i}">${opt("nice_to_have")}</select></label>
      <label class="field"><span>Redline</span><input name="ref-${i}" value="${esc(r.id)}" readonly></label>
      <label class="field"><span>Note</span><input name="note-${i}" placeholder="Optional"></label>
      <span></span></div>`;
  return `${refBlock}<form class="findings" data-form="priorities" data-key="${ms.key}" data-count="${redlines.length}">
      <p>Rank the redlines for the negotiation. The AI does not rank; it only supplies the ranges above.</p>
      ${redlines.map(row).join("")}
      <div class="actions"><button class="btn btn-ink" type="submit">Save the ranking</button></div></form>`;
}

function renderSignbar(ms) {
  if (ms.status === "signed") return "";
  const outstanding = ms.required_signers.filter((r) => !r.signed);
  const mine = outstanding.find((r) => r.user === S.user);
  let state;
  let button = "";
  if (ms.pending > 0) state = `${ms.pending} item${ms.pending === 1 ? "" : "s"} still need a decision before anyone can sign.`;
  else if (ms.lane === "human_led" && !ms.priorities.length) state = "Rank the asks to finish this step.";
  else {
    state = `Needs the signature of ${outstanding.map((r) => `${esc(r.name)} (${esc(r.role)})`).join(" and ")}.`;
    if (ms.accepts_controls && !ms.controls) state += " Signing reveals whether this step held a planted check.";
    if (mine) button = `<button class="btn btn-ink" data-action="sign" data-key="${ms.key}">Sign ${esc(ms.key)} as ${esc(me().name)}</button>`;
  }
  return `<div class="signbar"><span class="state">${state}</span>${button}</div>`;
}

function seal(sig, idKey) {
  const id = `ring-${idKey}`;
  const ring = `${sig.digest.slice(0, 44)}  ✦  `;
  const name = sig.signer_name || sig.signer;
  return `<svg class="seal ${S.justSigned === idKey ? "stamp-in" : ""}" viewBox="0 0 112 112" role="img" aria-label="Seal of ${esc(name)}">
    <defs><path id="${id}" d="M56,56 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0"/></defs>
    <circle cx="56" cy="56" r="54" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <circle cx="56" cy="56" r="37" fill="none" stroke="currentColor" stroke-width="1"/>
    <text class="ring-text"><textPath href="#${id}">${esc(ring)}</textPath></text>
    <text class="initials" x="56" y="62" text-anchor="middle">${esc(initials(name))}</text>
    <text class="role" x="56" y="78" text-anchor="middle">${esc(sig.role)}</text>
  </svg>`;
}

function renderSignatures(sigs, key) {
  if (!sigs || !sigs.length) return "";
  return `<div class="signatures">${sigs.map((s, i) => `<div class="signature">${seal(s, `${key}-${i}`)}
      <div><div class="name">${esc(s.signer_name)}</div>
        <div class="detail">${esc(cap(s.role))}${s.escalated ? ", after escalation" : ""}</div>
        <div class="detail">Digest <span class="mono">${esc(s.digest.slice(0, 16))}…</span></div>
        <div class="detail">Ed25519 key <span class="mono">${esc(s.key_id.split(":")[1] || s.key_id)}</span></div></div></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- release
function renderRelease() {
  const e = S.eng;
  const unsigned = e.milestones.filter((m) => m.status !== "signed");
  const finalSigner = e.team[e.policy.final_signer];
  let body;
  if (e.status === "released") {
    body = `<div class="notice moss"><h4>Released to ${esc(e.client)}</h4><p>The client receives the report and the one-page decision trail below.</p></div>${renderHeadlines()}`;
  } else if (e.status === "stopped") {
    body = `<div class="notice ochre"><h4>Stopped by the client</h4><p>${esc(e.stopped.reason)}. Only signed milestones are billed.</p></div>`;
  } else if (unsigned.length) {
    body = `<div class="notice"><p>${unsigned.length} milestone${unsigned.length === 1 ? " is" : "s are"} still unsigned: ${unsigned.map((m) => esc(m.title)).join(", ")}.</p></div>`;
  } else {
    body = `<div class="notice ink"><h4>All five milestones are signed</h4><p>${esc(finalSigner.name)} signs the final report. The signature covers every milestone signature and the whole record up to this point.</p>
      ${finalSigner.id === S.user ? `<div class="actions" style="margin-top:12px"><button class="btn btn-ink" data-action="release">Sign and release the report</button></div>` : ""}</div>${renderHeadlines()}`;
  }
  const sig = e.released ? [{ ...e.released, signer_name: e.released.signer_name }] : [];
  return `<section class="panel"><div class="ms-head"><span class="ms-kicker">Step 6 of 6, Human-led</span><h2>Final sign-off</h2>
    <p class="lane">The ${esc(e.policy.final_signer)} signs the report that goes to the client.</p></div>
    <div class="ms-body">${body}</div>${renderSignatures(sig, "release")}</section>`;
}

function renderHeadlines() {
  if (!S.trail) return "";
  return `<h3 class="section-gap">What the client's one-page trail will say</h3><ul class="headlines">${S.trail.headlines.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`;
}

// -------------------------------------------------------------- client view
function renderClient() {
  const t = S.trail;
  if (!t) return `<section class="panel panel-pad"><p>Loading…</p></section>`;
  const sigRows = t.signatures.map((s) => `<tr><td>${esc(s.milestone)} ${esc(s.title)}</td><td class="who">${esc(s.signer)}</td><td>${esc(s.role)}${s.escalated ? ", escalated" : ""}</td><td>${esc(fmtTime(s.signed_at))}</td><td class="mono">${esc(s.digest.slice(0, 12))}</td><td>${s.verified ? "Verified" : "Invalid"}</td></tr>`).join("");
  const stop = t.status === "open"
    ? `<form class="findings" data-form="stop"><h3>Stop after the signed steps</h3><p class="muted">You pay only for milestones that are already signed.</p>
        <label class="field"><span>Reason</span><input name="reason" required placeholder="e.g. Deal on hold"></label>
        <div class="actions"><button class="btn" type="submit">Stop the engagement</button></div></form>`
    : "";
  return `<section class="panel panel-pad">
    <span class="ms-kicker">Decision trail for ${esc(t.client)}</span><h2>${esc(t.matter)}</h2>
    <p class="muted" style="margin-top:6px">${esc(cap(t.review_level))} review: ${esc(t.review_rationale.join("; "))}</p>
    <h3 class="section-gap">What people did with the AI's work</h3>
    <ul class="headlines">${t.headlines.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
    <h3 class="section-gap">Who signed</h3>
    ${t.signatures.length ? `<table class="sig-table"><thead><tr><th>Milestone</th><th>Signed by</th><th>Role</th><th>When</th><th>Digest</th><th>Signature</th></tr></thead><tbody>${sigRows}</tbody></table>` : `<p class="muted">Nothing signed yet.</p>`}
    ${t.released_by ? `<p style="margin-top:12px">Final report signed by <span class="verdict"><span class="who">${esc(t.released_by)}</span></span></p>` : ""}
    ${t.learning_points.length ? `<h3 class="section-gap">Learning points</h3><ul class="rules">${t.learning_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${stop ? `<div class="section-gap">${stop}</div>` : ""}
  </section>`;
}

// ----------------------------------------------------------- backstage view
function renderBackstage() {
  const q = S.quality;
  const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
  const metrics = q
    ? [
        [q.decisions, "Decisions recorded"],
        [pct(q.reason_coverage), "Decisions with a reason"],
        [q.rejections, "AI items rejected"],
        [q.edits, "AI drafts rewritten"],
        [`${q.controls_caught} of ${q.controls_caught + q.controls_missed}`, "Planted checks caught"],
        [pct(q.blind_recall), "Blind-pass recall"],
        [q.own_insights_ai_missed, "Own findings the AI missed"],
        [q.fast_approvals, "Approvals under 4 seconds"],
        [q.milestones_signed, "Milestones signed"],
      ].map(([v, l]) => `<div class="metric"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")
    : "";
  const rows = S.ledger.slice().reverse().map((e) => `<tr><td>${e.n}</td><td>${esc((EVENT_LABELS[e.type] || [e.type])[0])}${e.payload.milestone ? ` <span class="muted">${esc(e.payload.milestone)}</span>` : ""}</td><td>${esc(e.actor)}</td><td>${esc(fmtTime(e.occurred_at))}</td><td class="mono">${esc(e.prev_hash.slice(0, 10))}</td><td class="mono">${esc(e.hash.slice(0, 10))}</td></tr>`).join("");
  return `<section class="panel panel-pad">
    <span class="ms-kicker">Quality and Risk, backstage view</span><h2>Lea Brunner, reviewer record</h2>
    <p class="muted" style="margin-top:6px;max-width:70ch">Evidence for the review conversation, taken from the same record as the invoice. There is deliberately no single score.</p>
    <div class="metrics">${metrics}</div>
    <h3 class="section-gap">Raw ledger, newest first</h3>
    <p class="muted">Each event carries the hash of the one before it. Editing any past event breaks every hash after it.</p>
    <table class="ledger-table"><thead><tr><th>#</th><th>Event</th><th>Actor</th><th>When</th><th>Previous</th><th>Hash</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

// ------------------------------------------------------------------- side
function renderSide() {
  const inv = S.invoice;
  let invoice = "";
  if (inv) {
    const lines = inv.lines.map((l) => `<tr><td>${esc(l.milestone)} ${esc(l.title)}<span class="signedby">${esc(l.signed_by)}</span></td><td class="amt">${chf(l.amount)}</td></tr>`).join("");
    const saving = inv.saving_vs_hourly != null
      ? `<div class="compare">Full review quoted at ${chf(inv.quote_total)}. Billed by the hour before AI, the same work cost ${chf(inv.quote_hourly_equivalent)}: the client pays ${Math.round(inv.saving_vs_hourly * 100)}% less.</div>`
      : "";
    invoice = `<section class="panel panel-pad invoice"><h3>Invoice, ${esc(inv.status)}</h3>
      <p class="muted" style="font-size:13px;margin:-6px 0 8px">Each line is one signed milestone at the published rate, ${esc(inv.review_level)} review adds ${Math.round((inv.review_multiplier - 1) * 100)}%.</p>
      ${inv.lines.length ? `<table><tbody>${lines}<tr class="total"><td>Total</td><td class="amt">${chf(inv.total)}</td></tr></tbody></table>` : `<p class="muted">Nothing is billable until a milestone is signed.</p>`}
      ${saving}
      ${inv.not_billed.length ? `<p class="pending">Not billed yet: ${inv.not_billed.map(esc).join(", ")}</p>` : ""}
      ${inv.note ? `<p class="pending">${esc(inv.note)}</p>` : ""}
    </section>`;
  }
  const v = S.verify;
  const chain = v ? `<div class="chain ${v.ok ? "" : "bad"}"><span class="dot"></span>${v.ok ? `Hash chain verifies, ${v.length} events` : `Chain broken at event ${v.first_bad_n}`}</div>` : "";
  let feed = "";
  if (S.activity.length) {
    feed = `<section class="panel panel-pad"><h3>Decision record</h3><ol class="feed">${S.activity.slice().reverse().slice(0, 40).map((e) => {
      const [label, ink] = EVENT_LABELS[e.type] || [e.type, false];
      return `<li><span class="n">${e.n}</span><span><span class="ev ${ink ? "ink" : ""}">${esc(label)}</span>${e.milestone ? ` <span class="muted">${esc(e.milestone)}</span>` : ""}<br><span class="muted">${esc(e.actor)}, ${esc(fmtTime(e.occurred_at))}</span> <span class="mono hash">${esc(e.hash.slice(0, 8))}</span></span></li>`;
    }).join("")}</ol>${chain}</section>`;
  } else if (chain) {
    feed = `<section class="panel panel-pad"><h3>Integrity</h3>${chain}</section>`;
  }
  return invoice + feed;
}

// ----------------------------------------------------------------- events
function onClick(ev) {
  const step = ev.target.closest("[data-step]");
  if (step) {
    S.active = step.dataset.step;
    S.open = null;
    render();
    $("#work").focus({ preventScroll: true });
    return;
  }
  const btn = ev.target.closest("[data-action]");
  if (!btn) return;
  const { action, key } = btn.dataset;
  if (action === "start") act(() => api(`/api/engagements/${S.eid}/milestones/${key}/start`, { method: "POST" }), "AI run complete. Proposals recorded.");
  if (action === "open") { S.open = { itemId: btn.dataset.item, action: btn.dataset.act }; render(); document.getElementById(`item-${S.open.itemId}`)?.scrollIntoView({ block: "nearest" }); }
  if (action === "cancel") { S.open = null; render(); }
  if (action === "sign") {
    act(async () => {
      const r = await api(`/api/engagements/${S.eid}/milestones/${key}/sign`, { method: "POST" });
      if (r.signed) S.justSigned = `${key}-${r.engagement.milestones.find((m) => m.key === key).signatures.length - 1}`;
      if (r.escalated) toast(r.message, "error");
      return r;
    }, (r) => (r.signed ? r.message : null));
  }
  if (action === "release") {
    S.justSigned = "release-0";
    act(() => api(`/api/engagements/${S.eid}/release`, { method: "POST" }), "Report signed and released to the client.");
  }
}

function onSubmit(ev) {
  const form = ev.target.closest("form[data-form]");
  if (!form) return;
  ev.preventDefault();
  const fd = new FormData(form);
  const kind = form.dataset.form;
  if (kind === "decide") {
    const body = { action: form.dataset.act };
    for (const k of ["reason_code", "reason_text", "revised_text", "resolved_value", "evidence_ref"]) {
      const v = (fd.get(k) || "").toString().trim();
      if (v) body[k] = v;
    }
    const { key, item } = form.dataset;
    act(() => api(`/api/engagements/${S.eid}/milestones/${key}/items/${item}/decision`, { method: "POST", body }), () => {
      S.open = null;
      return `${item} ${{ approve: "approved", reject: "rejected", edit: "rewritten" }[body.action]} and recorded.`;
    });
  }
  if (kind === "blind") {
    const findings = [];
    for (let i = 0; i < 3; i++) {
      const description = (fd.get(`desc-${i}`) || "").toString().trim();
      const risk_code = (fd.get(`code-${i}`) || "").toString() || null;
      if (description) findings.push({ risk_code, description });
    }
    if (!findings.length) return toast("Write at least one risk before the AI list opens.", "error");
    act(() => api(`/api/engagements/${S.eid}/milestones/${form.dataset.key}/blind-assessment`, { method: "POST", body: { findings } }), "Your risks are on the record. The AI list is now open.");
  }
  if (kind === "priorities") {
    const asks = [];
    for (let i = 0; i < Number(form.dataset.count); i++) {
      const label = (fd.get(`label-${i}`) || "").toString().trim();
      if (!label) continue;
      asks.push({ label, priority: fd.get(`prio-${i}`), ref_item_id: fd.get(`ref-${i}`) || null, note: (fd.get(`note-${i}`) || "").toString().trim() || null });
    }
    act(() => api(`/api/engagements/${S.eid}/milestones/${form.dataset.key}/priorities`, { method: "POST", body: { asks } }), "Ranking saved.");
  }
  if (kind === "stop") {
    act(() => api(`/api/engagements/${S.eid}/stop`, { method: "POST", body: { reason: fd.get("reason") } }), "Engagement stopped. Only signed milestones are billed.");
  }
}

boot().catch((err) => toast(err.message, "error"));
