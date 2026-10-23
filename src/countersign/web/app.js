/* Countersign console. Vanilla JS, no build step.
   The server enforces every rule; this file only decides what to show and offers
   the actions the current person is allowed to take.
   Two views: Engagement (one deliverable, milestone by milestone) and Firm (the service
   catalogue of every department, with a quote builder that applies the guardrails live). */
"use strict";

const ROLE_RANK = { client: 0, auditor: 0, junior: 1, manager: 2, partner: 3 };
const SLOT_MIN = { junior: "junior", manager: "manager", partner: "partner", quality_reviewer: "partner", client: "client" };

const LANES = {
  ai_led_spot_check: { label: "AI-led, spot-checked", explain: "The AI does the first pass. Anything below the confidence threshold, plus a random sample of the rest, goes to a person." },
  ai_drafts_human_confirms: { label: "AI drafts, a person confirms each item", explain: "Every item needs a decision from a person, and a rejection needs a reason." },
  human_led_blind: { label: "Human-led, blind first pass", explain: "The reviewer writes their own view first. The AI's list stays sealed until they submit." },
  ai_drafts_human_edits: { label: "AI drafts, a person edits", explain: "Each draft is approved, rejected or rewritten by a person." },
  human_led: { label: "Human-led", explain: "A person decides. The AI only supplies reference data." },
};

const REASONS = {
  verified_against_source: "Checked against the source",
  client_instruction: "Client instruction",
  market_practice: "In line with market practice",
  not_in_source: "Not in the source",
  below_materiality: "Below materiality",
  duplicate: "Duplicate",
  better_fit_for_client: "Better fit for the client",
  other: "Other",
};

const OPTIONS = {
  per_deliverable: "Per deliverable",
  outcome_linked: "Outcome-linked (fees at risk)",
  client_platform: "Client runs the platform",
  retainer: "Annual retainer",
  engagement_fee: "Audit engagement fee",
  classic: "Classic (hourly)",
};
const CONSEQUENCES = { internal_use: "Internal use", external_reliance: "External reliance", regulatory: "Regulatory" };
const TIERS = { tier1: "Tier 1", tier2: "Tier 2", tier3: "Tier 3" };
const SLOTS = { junior: "Junior", manager: "Manager", partner: "Partner", quality_reviewer: "Quality reviewer", client: "Client" };
const PRIORITY_LABELS = { must_have: "Must-have", trade_off: "Trade-off", nice_to_have: "Nice to have" };

const EVENT_LABELS = {
  engagement_opened: ["Intake recorded", false],
  pricing_confirmed: ["Pricing confirmed", true],
  milestone_started: ["AI run started", false],
  proposals_generated: ["AI proposals recorded", false],
  proposals_sealed: ["AI list sealed", false],
  blind_assessment_submitted: ["Own findings submitted", true],
  proposals_revealed: ["AI list unsealed", false],
  item_decided: ["Decision recorded", true],
  controls_evaluated: ["Planted checks revealed", false],
  milestone_escalated: ["Escalated to manager", false],
  conclusions_recorded: ["Conclusions recorded", true],
  milestone_signed: ["Milestone signed", true],
  deliverable_signed: ["Deliverable signed", true],
  deliverable_released: ["Released to client", false],
  outcome_measured: ["Outcome measured", true],
  engagement_stopped: ["Stopped by client", true],
};

const money = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const when = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const DEFAULT_QUOTE = {
  service_id: "consulting.operating_model_diagnostic",
  option: "outcome_linked",
  complexity: "",
  consequence: "",
  intake: { client_importance: "standard", is_audit_client: false, reliance: "internal_use", value_at_stake_chf: 40000000, duration_years: 1, cross_border: true, bespoke: true },
  at_risk: { share: 0.15, kpi: "Order-to-cash cycle time", unit: " days", baseline: 62, threshold: 55, full_at: 45, higher_is_better: false, measured_by: "the client's ERP" },
};

const S = {
  user: localStorage.getItem("countersign.user") || "lea.brunner",
  view: localStorage.getItem("countersign.view") || "engagement",
  users: [],
  meta: { reason_codes: Object.keys(REASONS), risk_taxonomy: {}, demo: false, seed_stages: [] },
  catalogue: null,
  eid: null, summary: null, eng: null, invoice: null, trail: null, activity: [], verify: null, quality: null, ledger: [],
  active: null, open: null, justSigned: null, busy: false,
  quote: JSON.parse(JSON.stringify(DEFAULT_QUOTE)), quoteResult: null, examples: {},
  pricingPreview: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const me = () => S.users.find((u) => u.id === S.user) || { id: S.user, role: "junior", name: S.user };
const rank = (role) => ROLE_RANK[role] ?? 0;
const isStaff = () => rank(me().role) >= 1;
const fmtTime = (iso) => (iso ? when.format(new Date(iso)) : "");
const chf = (n) => `CHF ${money.format(n)}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const initials = (name) => name.replace(/^Dr\.\s*/, "").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const onTeam = () => S.eng && Object.values(S.eng.team).some((t) => t.id === S.user);

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
  toast._t = setTimeout(() => (t.className = "toast"), kind === "error" ? 6500 : 3500);
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
  [S.users, S.meta, S.catalogue] = await Promise.all([api("/api/users"), api("/api/meta"), api("/api/catalogue")]);
  if (!S.users.some((u) => u.id === S.user)) S.user = S.users[0].id;
  const sel = $("#user-select");
  sel.innerHTML = S.users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}${rank(u.role) >= 1 ? ` (${esc(u.role)})` : ""}</option>`).join("");
  sel.value = S.user;
  sel.addEventListener("change", async () => {
    S.user = sel.value;
    localStorage.setItem("countersign.user", S.user);
    S.open = null;
    S.active = null;
    await refresh();
  });
  if (S.meta.demo) {
    $("#demo-reset").hidden = false;
    const rs = $("#reset-select");
    rs.innerHTML = `<option value="">Reset to stage</option>` + S.meta.seed_stages.map((s) => `<option value="${esc(s)}">${esc(stageLabel(s))}</option>`).join("");
    rs.addEventListener("change", async () => {
      if (!rs.value) return;
      const stage = rs.value;
      rs.value = "";
      S.active = null;
      S.open = null;
      S.pricingPreview = null;
      await act(() => api(`/api/demo/reset?stage=${encodeURIComponent(stage)}`, { method: "POST" }), `Demo reset: ${stageLabel(stage)}`);
    });
  }
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);
  document.addEventListener("change", onInput);
  await refresh();
  loadExamples();
}

function stageLabel(s) {
  return {
    opened: "Intake done, pricing not confirmed", priced: "Pricing confirmed", M1: "Extraction signed", M2: "Benchmark signed",
    "M3-sealed": "Risk screening, AI list sealed", M3: "Risk screening signed", M4: "Redlines signed", M5: "Priorities signed",
    released: "Deliverable signed",
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
  if (S.view === "firm" && !S.quoteResult) await runQuote();
  render();
}

async function loadExamples() {
  const services = S.catalogue.departments.flatMap((d) => d.services.map((s) => ({ d, s })));
  await Promise.all(services.map(async ({ d, s }) => {
    const option = d.policy.options.includes("per_deliverable") ? "per_deliverable" : d.policy.options[0];
    const body = { service_id: s.id, option, complexity: "tier2", consequence: s.min_consequence, intake: { reliance: s.min_consequence } };
    try { S.examples[s.id] = (await api("/api/quote", { method: "POST", body })).quote; } catch (e) { console.warn(e); }
  }));
  if (S.view === "firm") render();
}

// ----------------------------------------------------------------- render
function render() {
  const role = me().role;
  if (role === "client") S.view = "engagement";
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === S.view));
    b.hidden = role === "client" && b.dataset.view === "firm";
  });
  renderHeader();
  const layout = $("#layout");
  if (S.view === "firm") {
    layout.className = "layout layout--wide";
    $("#rail").innerHTML = "";
    $("#work").innerHTML = renderFirm();
    $("#side").innerHTML = renderQuoteResult();
    return;
  }
  if (!S.eid) {
    layout.className = "layout layout--wide";
    $("#rail").innerHTML = "";
    $("#side").innerHTML = "";
    $("#work").innerHTML = `<section class="panel panel-pad"><h2>No engagements yet</h2><p class="muted">Start the server with <code>COUNTERSIGN_SEED=M3-sealed</code> to load the Alpina case, or open one through the API.</p></section>`;
    return;
  }
  if (role === "client" || role === "auditor") {
    layout.className = "layout layout--wide";
    $("#rail").innerHTML = "";
    $("#work").innerHTML = role === "client" ? renderClient() : renderBackstage();
  } else if (!S.eng) {
    layout.className = "layout layout--wide";
    $("#rail").innerHTML = "";
    $("#work").innerHTML = `<section class="panel panel-pad"><h2>Not on this engagement</h2><p class="muted">${esc(me().name)} is not staffed on ${esc(S.summary.client)}. Open the Firm view to see the catalogue.</p></section>`;
  } else {
    layout.className = "layout";
    if (!S.active) S.active = defaultStep();
    $("#rail").innerHTML = renderRail();
    $("#work").innerHTML = renderStep();
    const pf = document.querySelector("form[data-form=pricing]");
    if (pf && !S.pricingPreview) previewPricing(pf);
  }
  $("#side").innerHTML = renderSide();
  if (S.justSigned) setTimeout(() => (S.justSigned = null), 600);
}

function renderHeader() {
  if (S.view === "firm") {
    $("#matter").innerHTML = `<div><strong>Firm catalogue</strong></div><div class="sub">Every department, one unit: Judgment plus Signature</div>`;
    return;
  }
  const s = S.summary;
  const level = S.eng?.policy?.level || s?.review_level;
  $("#matter").innerHTML = s
    ? `<div><strong>${esc(s.client)}</strong>, ${esc(s.department)}${level ? `<span class="level level-${esc(level)}">${esc(cap(level))} review</span>` : ""}</div>
       <div class="sub">${esc(s.matter)}</div>`
    : "";
}

function defaultStep() {
  if (!S.eng.pricing) return "intake";
  const ms = S.eng.milestones.find((m) => m.status !== "signed");
  return ms ? ms.key : "signature";
}

function stepStatusText(m) {
  const line = S.invoice?.judgment_lines?.find((l) => l.milestone === m.key);
  return {
    not_started: "Not started",
    awaiting_blind_assessment: "Waiting for own findings",
    in_review: `In review, ${m.pending} open`,
    escalated: "Escalated to manager",
    ready_to_sign: "Ready to sign",
    signed: line && line.amount ? `Signed, earned ${chf(line.amount)}` : "Signed",
  }[m.status];
}

function renderRail() {
  const e = S.eng;
  const n = e.milestones.length;
  const prevSigned = (i) => i === 0 || e.milestones[i - 1].status === "signed";
  const step = (key, num, title, meta, cls) =>
    `<li><button class="step ${cls}" data-step="${key}" ${S.active === key ? 'aria-current="step"' : ""}><span class="step-num">${num}</span><span><span class="step-title">${esc(title)}</span><span class="step-meta">${esc(meta)}</span></span></button></li>`;
  const intakeMeta = e.pricing ? `${TIERS[e.pricing.complexity]}, ${CONSEQUENCES[e.pricing.consequence].toLowerCase()}` : "Pricing to confirm";
  const items = [
    step("intake", 0, "Intake and pricing", intakeMeta, e.pricing ? "is-signed" : "is-attention"),
    ...e.milestones.map((m, i) => {
      const cls = m.status === "signed" ? "is-signed" : m.status === "escalated" ? "is-escalated"
        : ["awaiting_blind_assessment", "in_review", "ready_to_sign"].includes(m.status) ? "is-attention"
        : !e.pricing || !prevSigned(i) ? "is-locked" : "";
      return step(m.key, i + 1, m.title, stepStatusText(m), cls);
    }),
    step("signature", n + 1, "Signature", e.released_at ? "Signed and released" : `By ${(e.pricing?.final_signers || []).map((s) => SLOTS[s].toLowerCase()).join(" and ") || "the signer"}`,
      e.released_at ? "is-signed" : e.status === "awaiting_signature" ? "is-attention" : "is-locked"),
  ];
  return `<ol>${items.join("")}</ol>`;
}

function renderStep() {
  if (S.active === "intake") return renderIntake();
  if (S.active === "signature") return renderSignatureStep();
  const ms = S.eng.milestones.find((m) => m.key === S.active);
  return ms ? renderMilestone(ms) : "";
}

// ------------------------------------------------------------ intake and pricing
function renderIntake() {
  const e = S.eng;
  const i = e.intake;
  const r = e.recommendation;
  const n = e.milestones.length + 1;
  const team = Object.entries(e.team).map(([slot, u]) => `<dt>${esc(SLOTS[slot] || slot)}</dt><dd>${esc(u.name)}</dd>`).join("");
  const facts = `<dl class="facts">
      <dt>Service</dt><dd>${esc(e.department)}: ${esc(e.service)}</dd>
      <dt>Deliverable</dt><dd>${esc(e.deliverable)}</dd>
      ${i.client_position ? `<dt>Client is the</dt><dd>${esc(i.client_position)}</dd>` : ""}
      ${i.priorities.length ? `<dt>Priorities</dt><dd>${esc(i.priorities.join(", "))}</dd>` : ""}
      <dt>Relied on for</dt><dd>${esc(CONSEQUENCES[i.reliance])}</dd>
      <dt>Value at stake</dt><dd>${chf(i.value_at_stake_chf)}${i.duration_years ? ` over ${esc(i.duration_years)} years` : ""}</dd>
      <dt>Audit client</dt><dd>${i.is_audit_client ? "Yes" : "No"}</dd>
    </dl>`;
  const recBlock = `<div class="rec-grid">
      <div><h4>Judgment: ${esc(TIERS[r.complexity])}</h4><ul class="rules">${r.complexity_rationale.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div><h4>Signature: ${esc(CONSEQUENCES[r.consequence])}</h4><ul class="rules">${r.consequence_rationale.map((x) => `<li>${esc(cap(x))}</li>`).join("")}</ul></div>
    </div>`;
  let pricing;
  if (e.pricing) {
    const p = e.pricing;
    const q = p.quote;
    pricing = `<div class="notice ink"><h4>Priced and locked by <span class="verdict"><span class="who">${esc(p.confirmed_by)}</span></span></h4>
        <p>${esc(OPTIONS[p.option])}: Judgment ${esc(TIERS[p.complexity])} ${chf(q.judgment_full)} plus Signature (${esc(CONSEQUENCES[p.consequence].toLowerCase())}) ${chf(q.signature)}. Price list ${esc(q.price_list_version)}.</p>
        ${p.overrides.length ? `<p style="margin-top:6px"><strong>Overrode the recommendation:</strong> ${esc(p.overrides.join("; "))}. Reason: ${esc(p.override_reason)}</p>` : `<p style="margin-top:6px">Accepted the platform's recommendation.</p>`}
      </div>
      <h3 class="section-gap">What this means for the review</h3>
      <ul class="rules">${p.review_rationale.map((x) => `<li>${esc(cap(x))}</li>`).join("")}
        <li>AI output below ${pct(e.policy.confidence_threshold)} confidence goes to a person; ${pct(e.policy.spot_check_rate)} of the rest is spot-checked.</li>
        <li>${e.policy.controls_per_engagement} planted check${e.policy.controls_per_engagement === 1 ? " is" : "s are"} hidden in the AI's output.</li>
        <li>The deliverable is signed by the ${p.final_signers.map((s) => SLOTS[s].toLowerCase()).join(" and the ")}.</li></ul>`;
  } else {
    pricing = canConfirmPricing() ? renderPricingForm() : `<div class="notice ochre"><h4>Waiting for pricing</h4><p>${esc(e.team.manager?.name || "The manager")} confirms the tiers. Work cannot start before that.</p></div>`;
  }
  return `<section class="panel">
    <div class="ms-head"><span class="ms-kicker">Step 0 of ${n}</span><h2>Intake and pricing</h2>
      <p class="lane">The platform recommends both tiers from the intake, with its reasons. A named manager confirms or overrides them on the record. Client importance never raises the price.</p></div>
    <div class="ms-body">${facts}
      <h3 class="section-gap">The platform recommends</h3>${recBlock}
      <div class="section-gap">${pricing}</div>
      <h3 class="section-gap">Team</h3><dl class="facts">${team}</dl>
    </div></section>`;
}

function canConfirmPricing() {
  return onTeam() && rank(me().role) >= 2 && !S.eng.pricing && S.eng.status === "awaiting_pricing";
}

function deptOf(serviceId) {
  return S.catalogue.departments.find((d) => d.services.some((s) => s.id === serviceId));
}

function renderPricingForm() {
  const e = S.eng;
  const r = e.recommendation;
  const d = deptOf(e.service_id);
  const sel = (name, map, value, keys) => `<select name="${name}">${(keys || Object.keys(map)).map((k) => `<option value="${k}" ${k === value ? "selected" : ""}>${esc(map[k])}</option>`).join("")}</select>`;
  const pv = S.pricingPreview;
  const preview = pv ? `<div class="quote-mini ${pv.allowed ? "" : "bad"}">${pv.allowed
      ? `${chf(pv.quote.judgment_fixed)} Judgment + ${chf(pv.quote.signature)} Signature = <strong>${chf(pv.quote.total_fixed)}</strong>${pv.quote.saving_vs_hourly != null ? ` <span class="muted">vs ${chf(pv.quote.historical_fee)} hourly before AI</span>` : ""}`
      : pv.quote.violations.map((v) => `<p>${esc(v.message)}</p>`).join("")}</div>` : "";
  return `<form class="pricing-form" data-form="pricing">
      <h3>Confirm the pricing</h3>
      <div class="form-row">
        <label class="field"><span>Judgment tier</span>${sel("complexity", TIERS, r.complexity)}</label>
        <label class="field"><span>Signature tier</span>${sel("consequence", CONSEQUENCES, r.consequence)}</label>
        <label class="field"><span>Commercial option</span>${sel("option", OPTIONS, r.option, d.policy.options)}</label>
      </div>
      <label class="field"><span>Reason, if you change a recommended tier</span><input name="override_reason" placeholder="Required only for overrides"></label>
      ${preview}
      <div class="actions"><button class="btn btn-ink" type="submit">Confirm and lock the price</button></div>
    </form>`;
}

// ------------------------------------------------------------- milestone
function canDecide(ms) {
  const u = me();
  if (!isStaff() || ms.status === "signed" || S.eng.status !== "open" || !onTeam()) return false;
  const need = ms.escalation ? ms.escalation.required_slot : ms.lead;
  return rank(u.role) >= rank(SLOT_MIN[need]);
}

function renderMilestone(ms) {
  const idx = S.eng.milestones.indexOf(ms);
  const n = S.eng.milestones.length + 1;
  const lane = LANES[ms.lane];
  const share = S.eng.pricing ? ` Earns ${pct(ms.weight)} of the Judgment line (${chf(S.eng.pricing.quote.judgment_fixed * ms.weight)}) when signed.` : "";
  const head = `<div class="ms-head"><span class="ms-kicker">Step ${idx + 1} of ${n}, ${esc(lane.label)}</span>
    <h2>${esc(ms.title)}</h2><p class="lane">${esc(lane.explain)}${esc(share)}</p></div>`;
  let body = "";

  if (ms.status === "not_started") {
    const prev = S.eng.milestones[idx - 1];
    const allowed = isStaff() && onTeam() && rank(me().role) >= rank(SLOT_MIN[ms.lead]);
    if (!S.eng.pricing) body = `<div class="notice ochre"><h4>Pricing first</h4><p>The manager confirms the price before any work starts.</p></div>`;
    else if (prev && prev.status !== "signed") body = `<div class="notice ochre"><h4>Waiting for step ${idx}</h4><p>${esc(prev.title)} has to be signed first. The client can stop after any signed step.</p></div>`;
    else if (allowed && S.eng.status === "open") body = `<div class="notice ink"><h4>Ready to run</h4><p>${ms.lane === "human_led_blind" ? "The AI prepares its list and seals it. You see it only after writing your own findings." : "The AI prepares its proposals. Nothing counts until a person decides and signs."}</p>
           <div class="actions" style="margin-top:12px"><button class="btn btn-ink" data-action="start" data-key="${ms.key}">Run the AI for this step</button></div></div>`;
    else body = `<div class="notice"><p>This step is led by the ${esc(SLOTS[ms.lead].toLowerCase())}.</p></div>`;
    return `<section class="panel">${head}<div class="ms-body">${body}</div></section>`;
  }

  if (ms.status === "awaiting_blind_assessment") return `<section class="panel">${head}<div class="ms-body">${renderSealed(ms)}</div></section>`;

  if (ms.escalation) body += `<div class="notice oxblood"><h4>Escalated to the manager</h4><p>A planted check in this step was approved, so the source was not verified. ${esc(S.eng.team.manager.name)} reviews the items and signs instead.</p></div>`;
  if (ms.controls && ms.controls.passed) body += `<div class="notice moss"><h4>Planted check caught</h4><p>${ms.controls.control_item_ids.map(esc).join(", ")} was a deliberately false AI finding. Rejecting it shows the source was actually checked.</p></div>`;
  if (ms.lane === "human_led_blind" && ms.gap) body += renderGap(ms);
  if (ms.lane === "human_led") body += renderConclusions(ms);

  const items = ms.items.filter((i) => ms.lane !== "human_led" || i.route !== "informational");
  if (items.length) body += `<ol class="items">${items.map((it) => renderItem(ms, it)).join("")}</ol>`;
  return `<section class="panel">${head}<div class="ms-body">${body}</div>${renderSignbar(ms)}${renderSignatures(ms.signatures, ms.key)}</section>`;
}

function renderSealed(ms) {
  const reviewer = S.eng.team[ms.lead];
  const mine = reviewer && reviewer.id === S.user;
  const codes = Object.entries(S.meta.risk_taxonomy);
  const row = (i) => `<div class="finding-row">
      <label class="field"><span>Risk type</span><select name="code-${i}"><option value="">Choose a type</option>${codes.map(([c, l]) => `<option value="${esc(c)}">${esc(c)}: ${esc(l)}</option>`).join("")}</select></label>
      <label class="field"><span>What could go wrong</span><input name="desc-${i}" placeholder="In your own words"></label><span></span></div>`;
  return `<div class="sealed">
      <svg viewBox="0 0 40 40" aria-hidden="true"><rect x="9" y="18" width="22" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 18v-5a6 6 0 0 1 12 0v5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      <div><strong>The AI's list is sealed: ${ms.sealed.count} items</strong>
        <p class="muted">Its fingerprint is already on the record, so it cannot change after you answer: <span class="mono">${esc(ms.sealed.commitment.slice(0, 24))}…</span></p></div>
    </div>
    ${mine
      ? `<form class="findings" data-form="blind" data-key="${ms.key}"><p>Before you see the AI's list, write down what you see. The gap between your list and the AI's becomes your learning record.</p>
          ${[0, 1, 2].map(row).join("")}<div class="actions"><button class="btn btn-ink" type="submit">Submit my findings and open the AI list</button></div></form>`
      : `<div class="notice"><p>Waiting for ${esc(reviewer?.name || "the reviewer")} to write their own findings.</p></div>`}`;
}

function renderGap(ms) {
  const g = ms.gap;
  const list = (a) => (a.length ? a.map((c) => `${esc(c)} <span class="muted">${esc(S.meta.risk_taxonomy[c] || "")}</span>`).join("<br>") : `<span class="muted">None</span>`);
  return `<div class="gap"><div><strong>Found by both</strong><div class="codes">${list(g.matched)}</div></div>
    <div class="learn"><strong>Only the AI found</strong><div class="codes">${list(g.ai_only)}</div></div>
    <div><strong>Only ${esc(ms.blind_by || "the reviewer")} found</strong><div class="codes">${list(g.human_only)}</div></div></div>`;
}

function renderItem(ms, it) {
  const p = Math.round(it.confidence * 100);
  const low = it.route === "low_confidence";
  const tags = [
    `<span class="mono">${esc(it.id)}</span>`,
    it.clause_ref ? `<span class="tag">Clause ${esc(it.clause_ref)}</span>` : "",
    it.risk_code ? `<span class="tag">Risk ${esc(it.risk_code)}</span>` : "",
    low ? `<span class="tag low">Low confidence</span>` : "",
    it.route === "spot_check" ? `<span class="tag spot">Spot check</span>` : "",
    `<span class="conf ${low ? "is-low" : ""}" title="AI confidence"><span class="conf-bar"><i style="width:${p}%"></i></span>${p}%</span>`,
  ].join("");
  const d = it.data || {};
  let extra = "";
  if (d.value) extra = `<dl><dt>Extracted</dt><dd>${esc(d.value)}</dd></dl>`;
  if (d.contract) extra = `<dl><dt>Contract</dt><dd>${esc(d.contract)}</dd><dt>Market</dt><dd>${esc(d.market)}</dd></dl>`;
  if (d.proposed_text) extra = `<div class="proposed">${esc(d.proposed_text)}</div>`;
  return `<li class="item" id="item-${esc(it.id)}"><div class="ai"><div class="ai-meta">${tags}</div><h4>${esc(it.title)}</h4><p>${esc(it.detail)}</p>${extra}</div>${renderHuman(ms, it)}</li>`;
}

function renderHuman(ms, it) {
  const may = canDecide(ms);
  if (S.open && S.open.itemId === it.id) return `<div class="human is-decided">${renderDecideForm(ms, it, S.open.action)}</div>`;
  if (it.decision) {
    const dec = it.decision;
    const label = { approve: "Approved", reject: "Rejected", edit: "Rewritten" }[dec.action];
    const control = it.control_outcome ? `<p class="control-flag ${it.control_outcome}">${it.control_outcome === "caught" ? "This was a planted check, and it was caught." : "This was a planted check, and it was approved."}</p>` : "";
    const change = may ? `<p style="margin-top:8px"><button class="btn-link" data-action="open" data-item="${esc(it.id)}" data-act="${dec.action}">Change decision</button></p>` : "";
    return `<div class="human is-decided"><div class="verdict">
      <p><span class="act ${dec.action}">${label}</span> by <span class="who">${esc(it.decided_by)}</span> <span class="muted">${esc(fmtTime(it.decided_at))}</span></p>
      ${dec.reason_code ? `<p class="reason">${esc(REASONS[dec.reason_code])}${dec.reason_text ? `: ${esc(dec.reason_text)}` : ""}</p>` : dec.reason_text ? `<p class="reason">${esc(dec.reason_text)}</p>` : ""}
      ${dec.resolved_value ? `<p class="reason"><span class="muted">Resolved:</span> ${esc(dec.resolved_value)}</p>` : ""}
      ${dec.follow_up ? `<p class="reason"><span class="muted">Follow-up:</span> ${esc(dec.follow_up)}</p>` : ""}
      ${dec.evidence_ref ? `<p class="reason"><span class="muted">Evidence:</span> ${esc(dec.evidence_ref)}</p>` : ""}
      ${dec.revised_text ? `<div class="revised">${esc(dec.revised_text)}</div>` : ""}${control}${change}</div></div>`;
  }
  if (it.route === "auto_accepted") {
    return `<div class="human is-auto"><p class="muted">Accepted without review: ${Math.round(it.confidence * 100)}% is above the ${pct(S.eng.policy.confidence_threshold)} threshold.</p>
      ${may ? `<p style="margin-top:8px"><button class="btn-link" data-action="open" data-item="${esc(it.id)}" data-act="approve">Check it anyway</button></p>` : ""}</div>`;
  }
  if (it.route === "informational") return `<div class="human"><p class="muted">Reference only.</p></div>`;
  if (!may) {
    const who = ms.escalation ? S.eng.team.manager.name : S.eng.team[ms.lead]?.name;
    return `<div class="human"><p class="muted">Waiting for a decision from ${esc(who || "the reviewer")}.</p></div>`;
  }
  return `<div class="human"><p class="muted" style="margin-bottom:8px">${it.route === "low_confidence" ? "The AI is unsure. Check the source and record what it says." : "Your decision"}</p>
    <div class="actions">
      <button class="btn btn-approve" data-action="open" data-item="${esc(it.id)}" data-act="approve">Approve</button>
      <button class="btn btn-reject" data-action="open" data-item="${esc(it.id)}" data-act="reject">Reject</button>
      ${ms.lane === "ai_drafts_human_edits" ? `<button class="btn" data-action="open" data-item="${esc(it.id)}" data-act="edit">Rewrite</button>` : ""}
    </div></div>`;
}

function renderDecideForm(ms, it, action) {
  const prior = it.decision && it.decision.action === action ? it.decision : null;
  const chips = S.meta.reason_codes.map((c) => `<label class="chip"><input type="radio" name="reason_code" value="${esc(c)}" ${prior?.reason_code === c ? "checked" : ""}><span>${esc(REASONS[c] || c)}</span></label>`).join("");
  const verb = { approve: "Approve", reject: "Reject with this reason", edit: "Save the rewrite" }[action];
  return `<form class="decide-form" data-form="decide" data-key="${ms.key}" data-item="${esc(it.id)}" data-act="${action}">
    <strong class="verdict">${{ approve: "Approve", reject: "Reject", edit: "Rewrite" }[action]} ${esc(it.id)}</strong>
    ${action === "edit" ? `<label>Your version<textarea name="revised_text" required>${esc(prior?.revised_text || it.data?.proposed_text || "")}</textarea></label>` : ""}
    ${it.route === "low_confidence" ? `<label>What the source actually says<input name="resolved_value" value="${esc(prior?.resolved_value || "")}" placeholder="Your reading"></label>` : ""}
    <div><span class="muted" style="font-size:13.5px">Reason ${action === "approve" ? "(optional)" : "(required)"}</span><div class="chips" style="margin-top:4px">${chips}</div></div>
    <label>In your words<textarea name="reason_text" placeholder="${action === "approve" ? "Optional" : "Why"}">${esc(prior?.reason_text || "")}</textarea></label>
    <label>Evidence<input name="evidence_ref" value="${esc(prior?.evidence_ref || "")}" placeholder="e.g. client email, 14 Oct"></label>
    <div class="actions"><button class="btn btn-ink" type="submit">${verb}</button><button class="btn" type="button" data-action="cancel">Cancel</button></div></form>`;
}

function renderConclusions(ms) {
  const refs = ms.items.filter((i) => i.route === "informational");
  const refBlock = refs.length ? `<h3 style="margin-top:16px">Reference data from the AI</h3><ul class="rules">${refs.map((r) => `<li><strong>${esc(cap(r.title.replace(/^Benchmark: /, "")))}</strong>: <span class="muted">${esc(r.detail)}</span></li>`).join("")}</ul>` : "";
  if (ms.conclusions.length) {
    const rows = ms.conclusions.map((a) => {
      const cls = { must_have: "prio-must", trade_off: "prio-trade", nice_to_have: "prio-nice" }[a.priority] || "prio-nice";
      return `<li><span class="${cls}">${esc(PRIORITY_LABELS[a.priority] || "Conclusion")}</span><span>${esc(a.label)}${a.ref_item_id ? ` <span class="mono muted">${esc(a.ref_item_id)}</span>` : ""}${a.note ? `<br><span class="muted">${esc(a.note)}</span>` : ""}</span></li>`;
    }).join("");
    return `${refBlock}<h3 style="margin-top:20px">Decided by <span class="verdict"><span class="who">${esc(ms.conclusions_by)}</span></span></h3><ul class="prio-list">${rows}</ul>`;
  }
  const prior = S.eng.milestones.slice(0, S.eng.milestones.indexOf(ms)).flatMap((m) => m.items).filter((i) => i.decision && i.decision.action !== "reject" && i.kind === "redline");
  if (!canDecide(ms)) return `${refBlock}<div class="notice"><p>Waiting for ${esc(S.eng.team[ms.lead]?.name || "the manager")} to decide.</p></div>`;
  const opt = (sel) => Object.entries(PRIORITY_LABELS).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
  const row = (r, i) => `<div class="prio-row">
      <label class="field"><span>Ask</span><input name="label-${i}" value="${esc(r.title)}"></label>
      <label class="field"><span>Priority</span><select name="prio-${i}">${opt("nice_to_have")}</select></label>
      <label class="field"><span>From</span><input name="ref-${i}" value="${esc(r.id)}" readonly></label>
      <label class="field"><span>Note</span><input name="note-${i}" placeholder="Optional"></label><span></span></div>`;
  return `${refBlock}<form class="findings" data-form="conclusions" data-key="${ms.key}" data-count="${prior.length}">
      <p>Rank what to ask for. The AI does not rank; it only supplies the reference data above.</p>
      ${prior.map(row).join("")}<div class="actions"><button class="btn btn-ink" type="submit">Save the ranking</button></div></form>`;
}

function renderSignbar(ms) {
  if (ms.status === "signed") return "";
  const outstanding = ms.required_signers.filter((r) => !r.signed);
  const mine = outstanding.find((r) => r.user === S.user);
  let state;
  let button = "";
  if (ms.pending > 0) state = `${ms.pending} item${ms.pending === 1 ? "" : "s"} still need a decision before anyone can sign.`;
  else if (ms.lane === "human_led" && !ms.conclusions.length) state = "Record the conclusions to finish this step.";
  else {
    state = `Needs the signature of ${outstanding.map((r) => `${esc(r.name)} (${esc(SLOTS[r.slot].toLowerCase())})`).join(" and ")}.`;
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
    <circle cx="56" cy="56" r="54" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="56" cy="56" r="37" fill="none" stroke="currentColor" stroke-width="1"/>
    <text class="ring-text"><textPath href="#${id}">${esc(ring)}</textPath></text>
    <text class="initials" x="56" y="62" text-anchor="middle">${esc(initials(name))}</text>
    <text class="role" x="56" y="78" text-anchor="middle">${esc(SLOTS[sig.slot] || sig.slot)}</text></svg>`;
}

function renderSignatures(sigs, key) {
  if (!sigs || !sigs.length) return "";
  return `<div class="signatures">${sigs.map((s, i) => `<div class="signature">${seal(s, `${key}-${i}`)}
      <div><div class="name">${esc(s.signer_name)}</div><div class="detail">${esc(SLOTS[s.slot] || s.slot)}${s.escalated ? ", after escalation" : ""}</div>
        <div class="detail">Digest <span class="mono">${esc(s.digest.slice(0, 16))}…</span></div>
        <div class="detail">Ed25519 key <span class="mono">${esc(s.key_id.split(":")[1] || s.key_id)}</span></div></div></div>`).join("")}</div>`;
}

// --------------------------------------------------------- the Signature line
function renderSignatureStep() {
  const e = S.eng;
  const n = e.milestones.length + 1;
  const p = e.pricing;
  let body;
  if (!p) body = `<div class="notice"><p>Pricing is not confirmed yet.</p></div>`;
  else if (e.stopped) body = `<div class="notice ochre"><h4>Stopped by the client</h4><p>${esc(e.stopped.reason)}. Only signed milestones are billed, and no Signature line.</p></div>`;
  else if (e.released_at) {
    body = `<div class="notice moss"><h4>Signed and released to ${esc(e.client)}</h4><p>KPMG now carries the liability for this deliverable. The Signature line is billed.</p></div>${renderOutcome()}${renderHeadlines()}`;
  } else if (e.status !== "awaiting_signature") {
    const unsigned = e.milestones.filter((m) => m.status !== "signed");
    body = `<div class="notice"><p>${unsigned.length} milestone${unsigned.length === 1 ? " is" : "s are"} still unsigned: ${unsigned.map((m) => esc(m.title)).join(", ")}.</p></div>`;
  } else {
    const mine = e.final_signers_outstanding.find((s) => s.user === S.user);
    body = `<div class="notice ink"><h4>Every milestone is signed</h4><p>Still to sign: ${e.final_signers_outstanding.map((s) => `${esc(s.name)} (${esc(SLOTS[s.slot].toLowerCase())})`).join(" and ")}. The signature covers every milestone signature, the locked price and the whole record up to this point.</p>
      ${mine ? `<div class="actions" style="margin-top:12px"><button class="btn btn-ink" data-action="sign-deliverable">Sign the deliverable as ${esc(me().name)}</button></div>` : ""}</div>${renderHeadlines()}`;
  }
  const signers = p ? p.final_signers.map((s) => SLOTS[s].toLowerCase()).join(" and the ") : "signer";
  return `<section class="panel"><div class="ms-head"><span class="ms-kicker">Step ${n} of ${n}, the Signature line</span><h2>Signature</h2>
    <p class="lane">${p ? `${esc(CONSEQUENCES[p.consequence])}, so the ${esc(signers)} sign${p.final_signers.length === 1 ? "s" : ""}. Priced at ${chf(p.quote.signature)}.` : ""}</p></div>
    <div class="ms-body">${body}</div>${renderSignatures(e.deliverable_signatures, "deliverable")}</section>`;
}

function renderOutcome() {
  const p = S.eng.pricing;
  if (!p || p.option !== "outcome_linked") return "";
  const a = p.at_risk;
  if (S.eng.outcome) return `<div class="notice ink"><h4>Outcome measured: ${esc(S.eng.outcome.value)}${esc(a.unit)}</h4><p>${pct(S.eng.outcome.payout_ratio)} of the at-risk ${chf(p.quote.judgment_at_risk)} is paid. Recorded by ${esc(S.eng.outcome.recorded_by)} from ${esc(S.eng.outcome.evidence_ref)}.</p></div>`;
  return `<form class="findings" data-form="outcome"><h3>Record the measured outcome</h3>
    <p class="muted">${esc(a.kpi)}: nothing below ${esc(a.threshold)}${esc(a.unit)}, all of the at-risk ${chf(p.quote.judgment_at_risk)} at ${esc(a.full_at)}${esc(a.unit)}. Measured from ${esc(a.measured_by)}.</p>
    <div class="form-row"><label class="field"><span>Measured value</span><input name="value" type="number" step="any" required></label>
    <label class="field"><span>Evidence</span><input name="evidence_ref" required placeholder="e.g. ERP report, Q2"></label></div>
    <div class="actions"><button class="btn" type="submit">Record the outcome</button></div></form>`;
}

function renderHeadlines() {
  if (!S.trail) return "";
  return `<h3 class="section-gap">What the client's one-page trail says</h3><ul class="headlines">${S.trail.headlines.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`;
}

// -------------------------------------------------------------- client view
function renderClient() {
  const t = S.trail;
  if (!t) return `<section class="panel panel-pad"><p>Loading…</p></section>`;
  const sigRows = t.signatures.map((s) => `<tr><td>${esc(s.milestone)} ${esc(s.title)}</td><td class="who">${esc(s.signer)}</td><td>${esc(s.role)}${s.escalated ? ", escalated" : ""}</td><td>${esc(fmtTime(s.signed_at))}</td><td class="mono">${esc(s.digest.slice(0, 12))}</td><td>${s.verified ? "Verified" : "Invalid"}</td></tr>`).join("");
  const stop = ["open", "awaiting_pricing", "awaiting_signature"].includes(t.status)
    ? `<form class="findings" data-form="stop"><h3>Stop after the signed steps</h3><p class="muted">You pay only for milestones already signed.</p>
        <label class="field"><span>Reason</span><input name="reason" required placeholder="e.g. Deal on hold"></label>
        <div class="actions"><button class="btn" type="submit">Stop the engagement</button></div></form>` : "";
  return `<section class="panel panel-pad">
    <span class="ms-kicker">Decision trail for ${esc(t.client)}</span><h2>${esc(t.matter)}</h2>
    <p class="muted" style="margin-top:6px">${esc(t.department)}, ${esc(t.service)}. Judgment ${esc(TIERS[t.complexity])}, Signature ${esc((CONSEQUENCES[t.consequence] || "").toLowerCase())}${t.pricing_confirmed_by ? `, confirmed by ${esc(t.pricing_confirmed_by)}` : ""}.</p>
    <h3 class="section-gap">What people did with the AI's work</h3><ul class="headlines">${t.headlines.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
    <h3 class="section-gap">Who signed</h3>
    ${t.signatures.length ? `<table class="sig-table"><thead><tr><th>Milestone</th><th>Signed by</th><th>As</th><th>When</th><th>Digest</th><th>Signature</th></tr></thead><tbody>${sigRows}</tbody></table>` : `<p class="muted">Nothing signed yet.</p>`}
    ${t.deliverable_signed_by.length ? `<p style="margin-top:12px">Deliverable signed by <span class="verdict"><span class="who">${esc(t.deliverable_signed_by.join(", "))}</span></span></p>` : ""}
    ${t.learning_points.length ? `<h3 class="section-gap">Learning points</h3><ul class="rules">${t.learning_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${stop ? `<div class="section-gap">${stop}</div>` : ""}</section>`;
}

// ----------------------------------------------------------- backstage view
function renderBackstage() {
  const q = S.quality;
  const metrics = q ? [
    [q.decisions, "Decisions recorded"], [q.reason_coverage == null ? "n/a" : pct(q.reason_coverage), "Decisions with a reason"],
    [q.rejections, "AI items rejected"], [q.edits, "AI drafts rewritten"],
    [`${q.controls_caught} of ${q.controls_caught + q.controls_missed}`, "Planted checks caught"],
    [q.blind_recall == null ? "n/a" : pct(q.blind_recall), "Blind-pass recall"], [q.own_insights_ai_missed, "Own findings the AI missed"],
    [q.fast_approvals, "Approvals under 4 seconds"], [q.milestones_signed, "Milestones signed"],
  ].map(([v, l]) => `<div class="metric"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("") : "";
  const rows = S.ledger.slice().reverse().map((e) => `<tr><td>${e.n}</td><td>${esc((EVENT_LABELS[e.type] || [e.type])[0])}${e.payload.milestone ? ` <span class="muted">${esc(e.payload.milestone)}</span>` : ""}</td><td>${esc(e.actor)}</td><td>${esc(fmtTime(e.occurred_at))}</td><td class="mono">${esc(e.prev_hash.slice(0, 10))}</td><td class="mono">${esc(e.hash.slice(0, 10))}</td></tr>`).join("");
  return `<section class="panel panel-pad">
    <span class="ms-kicker">Quality and Risk, backstage view</span><h2>Lea Brunner, reviewer record</h2>
    <p class="muted" style="margin-top:6px;max-width:70ch">Evidence for the review conversation, from the same record as the invoice. There is deliberately no single score.</p>
    <div class="metrics">${metrics}</div>
    <h3 class="section-gap">Raw ledger, newest first</h3><p class="muted">Each event carries the hash of the one before it. Editing any past event breaks every hash after it.</p>
    <table class="ledger-table"><thead><tr><th>#</th><th>Event</th><th>Actor</th><th>When</th><th>Previous</th><th>Hash</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

// ------------------------------------------------------------------ side
function renderSide() {
  const inv = S.invoice;
  let invoice = "";
  if (inv && inv.status === "awaiting_pricing") {
    invoice = `<section class="panel panel-pad invoice"><h3>Invoice</h3><p class="muted">Nothing is priced until the manager confirms the tiers.</p></section>`;
  } else if (inv) {
    const lines = inv.judgment_lines.map((l) => `<tr><td>${esc(l.milestone)} ${esc(l.title)} <span class="muted">${pct(l.weight)}</span><span class="signedby">${esc(l.signed_by)}</span></td><td class="amt">${chf(l.amount)}</td></tr>`).join("");
    const sigRow = `<tr class="line-head"><td>Signature, ${esc(CONSEQUENCES[inv.consequence].toLowerCase())}${inv.signature_billed ? `<span class="signedby">${esc(inv.signature_by.join(", "))}</span>` : `<span class="muted"> billed when signed</span>`}</td><td class="amt">${inv.signature_billed ? chf(inv.signature) : `<span class="muted">${chf(inv.signature)}</span>`}</td></tr>`;
    const atRisk = inv.at_risk ? `<tr><td>At risk on the outcome${inv.at_risk_paid != null ? "" : `<span class="muted"> settled when measured</span>`}</td><td class="amt">${inv.at_risk_paid != null ? chf(inv.at_risk_paid) : `<span class="muted">up to ${chf(inv.at_risk)}</span>`}</td></tr>` : "";
    const compare = inv.saving_vs_hourly != null ? `<div class="compare">Quoted at ${chf(inv.quote_total)}. The same deliverable billed by the hour before AI: ${chf(inv.historical_fee)}. The client pays ${pct(inv.saving_vs_hourly)} less.</div>` : "";
    invoice = `<section class="panel panel-pad invoice"><h3>Invoice, ${esc(inv.status)}</h3>
      <p class="muted" style="font-size:13px;margin:-6px 0 8px">${esc(OPTIONS[inv.option])}. Judgment is earned milestone by milestone; Signature when the deliverable is signed.</p>
      <table><tbody>
        <tr class="line-head"><td>Judgment, ${esc(TIERS[inv.complexity])} <span class="muted">${chf(inv.judgment_full)}</span></td><td class="amt">${chf(inv.judgment_accrued)}</td></tr>
        ${lines}${atRisk}${sigRow}
        <tr class="total"><td>${inv.status === "final" ? "Total" : "Due so far"}</td><td class="amt">${chf(inv.total_due)}</td></tr></tbody></table>
      ${compare}
      ${inv.not_yet_earned.length ? `<p class="pending">Not yet earned: ${inv.not_yet_earned.map(esc).join(", ")}</p>` : ""}
      ${inv.notes.map((n) => `<p class="pending">${esc(n)}</p>`).join("")}</section>`;
  }
  const v = S.verify;
  const chain = v ? `<div class="chain ${v.ok ? "" : "bad"}"><span class="dot"></span>${v.ok ? `Hash chain verifies, ${v.length} events` : `Chain broken at event ${v.first_bad_n}`}</div>` : "";
  let feed = "";
  if (S.activity.length) {
    feed = `<section class="panel panel-pad"><h3>Decision record</h3><ol class="feed">${S.activity.slice().reverse().slice(0, 40).map((e) => {
      const [label, ink] = EVENT_LABELS[e.type] || [e.type, false];
      return `<li><span class="n">${e.n}</span><span><span class="ev ${ink ? "ink" : ""}">${esc(label)}</span>${e.milestone ? ` <span class="muted">${esc(e.milestone)}</span>` : ""}<br><span class="muted">${esc(e.actor)}, ${esc(fmtTime(e.occurred_at))}</span> <span class="mono hash">${esc(e.hash.slice(0, 8))}</span></span></li>`;
    }).join("")}</ol>${chain}</section>`;
  } else if (chain) feed = `<section class="panel panel-pad"><h3>Integrity</h3>${chain}</section>`;
  return invoice + feed;
}

// --------------------------------------------------------------- firm view
function renderFirm() {
  const c = S.catalogue;
  const q = S.quote;
  const d = deptOf(q.service_id);
  const svcOptions = c.departments.map((dep) => `<optgroup label="${esc(dep.name)}">${dep.services.map((s) => `<option value="${esc(s.id)}" ${s.id === q.service_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</optgroup>`).join("");
  const sel = (path, map, value, keys, auto) => `<select data-q="${path}">${auto ? `<option value="">Recommended</option>` : ""}${(keys || Object.keys(map)).map((k) => `<option value="${k}" ${k === value ? "selected" : ""}>${esc(map[k])}</option>`).join("")}</select>`;
  const chk = (path, label, value) => `<label class="check"><input type="checkbox" data-q="${path}" ${value ? "checked" : ""}><span>${esc(label)}</span></label>`;
  const num = (path, label, value, step = "any") => `<label class="field"><span>${esc(label)}</span><input type="number" step="${step}" data-q="${path}" value="${esc(value)}"></label>`;
  const txt = (path, label, value) => `<label class="field"><span>${esc(label)}</span><input data-q="${path}" value="${esc(value)}"></label>`;
  const ar = q.at_risk;
  const atRisk = q.option === "outcome_linked" ? `<fieldset class="atrisk"><legend>Fees at risk (Judgment line only)</legend>
      <div class="form-row">${num("at_risk.share", "Share at risk (0 to 1)", ar.share, "0.01")}${txt("at_risk.kpi", "KPI", ar.kpi)}${txt("at_risk.measured_by", "Measured from", ar.measured_by)}</div>
      <div class="form-row">${num("at_risk.baseline", "Baseline today", ar.baseline)}${num("at_risk.threshold", "Payment starts at", ar.threshold)}${num("at_risk.full_at", "Paid in full at", ar.full_at)}
        <label class="field"><span>Direction</span><select data-q="at_risk.higher_is_better"><option value="false" ${!ar.higher_is_better ? "selected" : ""}>Lower is better</option><option value="true" ${ar.higher_is_better ? "selected" : ""}>Higher is better</option></select></label></div></fieldset>` : "";
  const builder = `<section class="panel panel-pad quote-builder"><span class="ms-kicker">Quote builder, price list ${esc(c.price_list_version)}</span><h2>Price any deliverable in any department</h2>
      <p class="muted" style="margin-top:6px;max-width:72ch">Same unit everywhere: a Judgment line priced by complexity, a Signature line priced by consequence. Each department's policy pack decides what may be sold. Try an audit client with an outcome-linked fee.</p>
      <form class="quote-form" data-form="quote" autocomplete="off">
        <div class="form-row"><label class="field wide"><span>Service</span><select data-q="service_id">${svcOptions}</select></label>
          <label class="field"><span>Commercial option</span>${sel("option", OPTIONS, q.option)}</label></div>
        <div class="form-row">${chk("intake.is_audit_client", "Audit client", q.intake.is_audit_client)}${chk("intake.client_importance", "Key client", q.intake.client_importance === "key")}${chk("intake.cross_border", "Cross-border", q.intake.cross_border)}${chk("intake.bespoke", "Bespoke or novel", q.intake.bespoke)}</div>
        <div class="form-row"><label class="field"><span>Relied on for</span>${sel("intake.reliance", CONSEQUENCES, q.intake.reliance)}</label>${num("intake.value_at_stake_chf", "Value at stake (CHF)", q.intake.value_at_stake_chf, "100000")}${num("intake.duration_years", "Duration (years)", q.intake.duration_years, "1")}</div>
        <div class="form-row"><label class="field"><span>Judgment tier</span>${sel("complexity", TIERS, q.complexity, null, true)}</label><label class="field"><span>Signature tier</span>${sel("consequence", CONSEQUENCES, q.consequence, null, true)}</label></div>
        ${atRisk}</form>
      ${d ? `<div class="policy-pack"><h4>${esc(d.name)} policy pack</h4><p>Sells: ${d.policy.options.map((o) => `<span class="tag">${esc(OPTIONS[o])}</span>`).join(" ")}</p><ul class="rules">${d.policy.rationale.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
    </section>`;
  const cards = c.departments.map((dep) => `<article class="dept"><h3>${esc(dep.name)}</h3><p class="muted">${esc(dep.summary)}</p>
      ${dep.services.map((s) => {
        const ex = S.examples[s.id];
        return `<button class="svc" data-pick="${esc(s.id)}"><span class="svc-name">${esc(s.name)}</span>
          <span class="lanes">${s.milestones.map((m) => `<i class="lane-dot lane-${m.lane}" title="${esc(m.title)}: ${esc(LANES[m.lane].label)}"></i>`).join("")}</span>
          ${ex ? `<span class="svc-price">${chf(ex.judgment_full)} + ${chf(ex.signature)} = <strong>${chf(ex.total_fixed)}</strong> <span class="muted">vs ${chf(ex.historical_fee)}</span></span>` : ""}</button>`;
      }).join("")}</article>`).join("");
  const legend = Object.entries(LANES).map(([k, v]) => `<span><i class="lane-dot lane-${k}"></i>${esc(v.label)}</span>`).join("");
  return `${builder}<section class="panel panel-pad section-gap"><span class="ms-kicker">Service catalogue</span><h2>Six departments, one unit</h2>
      <p class="muted" style="margin-top:6px">Example prices at Tier 2 and each service's minimum consequence, against the same deliverable billed by the hour before AI. Pick a service to quote it.</p>
      <div class="lane-legend">${legend}</div><div class="dept-grid">${cards}</div></section>`;
}

function renderQuoteResult() {
  const r = S.quoteResult;
  if (!r) return `<section class="panel panel-pad"><p class="muted">Pricing…</p></section>`;
  const q = r.quote;
  const rec = r.recommendation;
  const violations = q.violations.length ? `<div class="violations">${q.violations.map((v) => `<div class="notice oxblood"><h4>Refused by the policy pack</h4><p>${esc(v.message)}</p><p class="mono muted" style="margin-top:4px">${esc(v.rule)}</p></div>`).join("")}</div>` : "";
  const ext = { two_lines: "Invoiced as two lines", engagement_fee: "Invoiced as one fixed audit fee", retainer: "Covered by the annual retainer", hourly: "Billed by the hour" }[q.external_billing];
  return `<section class="panel panel-pad invoice quote-result ${r.allowed ? "" : "refused"}"><h3>${esc(q.service_name)}</h3>
      <p class="muted" style="font-size:13px;margin:-6px 0 8px">${esc(q.department)}. ${esc(OPTIONS[q.option])}. ${esc(ext)}.</p>
      ${violations}
      <table><tbody>
        <tr class="line-head"><td>Judgment, ${esc(TIERS[q.complexity])}${q.judgment_fixed !== q.judgment_full ? ` <span class="muted">list ${chf(q.judgment_full)}</span>` : ""}</td><td class="amt">${chf(q.judgment_fixed)}</td></tr>
        ${q.judgment_at_risk ? `<tr><td>At risk on the outcome</td><td class="amt">up to ${chf(q.judgment_at_risk)}</td></tr>` : ""}
        <tr class="line-head"><td>Signature, ${esc(CONSEQUENCES[q.consequence].toLowerCase())}</td><td class="amt">${chf(q.signature)}</td></tr>
        <tr class="total"><td>${q.option === "classic" ? "Hourly estimate" : "Per deliverable"}</td><td class="amt">${chf(q.total_fixed)}</td></tr></tbody></table>
      ${q.saving_vs_hourly != null ? `<div class="compare ${q.saving_vs_hourly < 0 ? "dearer" : ""}">Billed by the hour before AI: ${chf(q.historical_fee)} (${esc(q.reference_hours)} hours). ${q.saving_vs_hourly >= 0 ? `The client pays ${pct(q.saving_vs_hourly)} less.` : `This costs ${pct(-q.saving_vs_hourly)} more, because the signature carries liability.`}</div>` : ""}
      <dl class="facts small"><dt>Review</dt><dd>${esc(cap(q.review_level))}</dd><dt>Signed by</dt><dd>${q.signers.map((s) => esc(SLOTS[s])).join(" and ")}</dd>
        <dt>Recommended</dt><dd>${esc(TIERS[rec.complexity])}, ${esc(CONSEQUENCES[rec.consequence].toLowerCase())}</dd></dl>
      <ul class="rules small">${rec.complexity_rationale.map((x) => `<li>${esc(x)}</li>`).join("")}${rec.consequence_rationale.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${q.notes.map((n) => `<p class="pending">${esc(n)}</p>`).join("")}</section>`;
}

let quoteTimer = null;
async function runQuote() {
  const q = S.quote;
  const body = {
    service_id: q.service_id,
    option: q.option,
    intake: q.intake,
    ...(q.complexity ? { complexity: q.complexity } : {}),
    ...(q.consequence ? { consequence: q.consequence } : {}),
    ...(q.option === "outcome_linked" ? { at_risk: q.at_risk } : {}),
  };
  try {
    S.quoteResult = await api("/api/quote", { method: "POST", body });
  } catch (err) {
    S.quoteResult = { allowed: false, recommendation: { complexity: "tier1", consequence: "internal_use", complexity_rationale: [], consequence_rationale: [] },
      quote: { violations: [{ rule: "invalid-input", message: err.message }], service_name: "Check the inputs", department: "", option: q.option, external_billing: "two_lines", complexity: "tier1", consequence: "internal_use", judgment_fixed: 0, judgment_full: 0, judgment_at_risk: 0, signature: 0, total_fixed: 0, saving_vs_hourly: null, review_level: "", signers: [], notes: [] } };
  }
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p];
  o[parts.at(-1)] = value;
}

async function previewPricing(form) {
  const fd = new FormData(form);
  const body = { service_id: S.eng.service_id, option: fd.get("option"), complexity: fd.get("complexity"), consequence: fd.get("consequence"), intake: S.eng.intake };
  try { S.pricingPreview = await api("/api/quote", { method: "POST", body }); } catch (e) { S.pricingPreview = null; }
  const pv = form.querySelector(".quote-mini");
  const fresh = document.createElement("div");
  fresh.innerHTML = renderPricingForm();
  const newPv = fresh.querySelector(".quote-mini");
  if (pv && newPv) pv.replaceWith(newPv);
  else if (newPv) form.querySelector(".actions").before(newPv);
}

// ----------------------------------------------------------------- events
function onInput(ev) {
  const el = ev.target;
  if (el.dataset && el.dataset.q) {
    let value = el.type === "checkbox" ? el.checked : el.value;
    if (el.dataset.q === "intake.client_importance") value = el.checked ? "key" : "standard";
    if (el.type === "number") value = el.value === "" ? 0 : Number(el.value);
    if (el.dataset.q === "at_risk.higher_is_better") value = el.value === "true";
    setPath(S.quote, el.dataset.q, value);
    const structural = ["service_id", "option"].includes(el.dataset.q);
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async () => {
      await runQuote();
      if (structural) $("#work").innerHTML = renderFirm();
      $("#side").innerHTML = renderQuoteResult();
    }, ev.type === "input" && el.type !== "checkbox" ? 250 : 0);
    return;
  }
  const pricing = el.closest && el.closest("form[data-form=pricing]");
  if (pricing && ev.type === "change" && el.name !== "override_reason") previewPricing(pricing);
}

function onClick(ev) {
  const tab = ev.target.closest("#tabs button");
  if (tab) {
    S.view = tab.dataset.view;
    localStorage.setItem("countersign.view", S.view);
    if (S.view === "firm" && !S.quoteResult) runQuote().then(render);
    render();
    return;
  }
  const pick = ev.target.closest("[data-pick]");
  if (pick) {
    S.quote.service_id = pick.dataset.pick;
    const d = deptOf(S.quote.service_id);
    if (!d.policy.options.includes(S.quote.option)) S.quote.option = d.policy.options.includes("per_deliverable") ? "per_deliverable" : d.policy.options[0];
    runQuote().then(() => { render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    return;
  }
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
  if (action === "sign-deliverable") {
    S.justSigned = `deliverable-${S.eng.deliverable_signatures.length}`;
    act(() => api(`/api/engagements/${S.eid}/sign-deliverable`, { method: "POST" }), (e) => (e.released_at ? "Deliverable signed and released. The Signature line is billed." : "Signed. Waiting for the second signer."));
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
    if (!findings.length) return toast("Write at least one finding before the AI list opens.", "error");
    act(() => api(`/api/engagements/${S.eid}/milestones/${form.dataset.key}/blind-assessment`, { method: "POST", body: { findings } }), "Your findings are on the record. The AI list is now open.");
  }
  if (kind === "conclusions") {
    const conclusions = [];
    for (let i = 0; i < Number(form.dataset.count); i++) {
      const label = (fd.get(`label-${i}`) || "").toString().trim();
      if (!label) continue;
      conclusions.push({ label, priority: fd.get(`prio-${i}`), ref_item_id: fd.get(`ref-${i}`) || null, note: (fd.get(`note-${i}`) || "").toString().trim() || null });
    }
    act(() => api(`/api/engagements/${S.eid}/milestones/${form.dataset.key}/conclusions`, { method: "POST", body: { conclusions } }), "Ranking saved.");
  }
  if (kind === "pricing") {
    const r = S.eng.recommendation;
    const body = { complexity: fd.get("complexity"), consequence: fd.get("consequence"), option: fd.get("option") };
    const reason = (fd.get("override_reason") || "").toString().trim();
    if (reason) body.override_reason = reason;
    if ((body.complexity !== r.complexity || body.consequence !== r.consequence) && !reason) return toast("Changing a recommended tier needs a written reason.", "error");
    act(() => api(`/api/engagements/${S.eid}/pricing`, { method: "POST", body }), () => { S.active = null; S.pricingPreview = null; return "Pricing confirmed and locked on the record."; });
  }
  if (kind === "outcome") {
    act(() => api(`/api/engagements/${S.eid}/outcome`, { method: "POST", body: { value: Number(fd.get("value")), evidence_ref: fd.get("evidence_ref") } }), "Outcome recorded. The at-risk part is settled.");
  }
  if (kind === "stop") {
    act(() => api(`/api/engagements/${S.eid}/stop`, { method: "POST", body: { reason: fd.get("reason") } }), "Engagement stopped. Only signed milestones are billed.");
  }
}

boot().catch((err) => toast(err.message, "error"));
