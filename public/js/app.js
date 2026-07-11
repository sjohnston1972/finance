import { TAX_YEAR, TAX_CONFIG, CONTRIBUTION_TYPES } from './tax-data.js';
import { projectPension, validateInputs, optimise } from './engine.js';
import { buildCharts, updateCharts } from './charts.js';

/* ── Helpers ─────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

const gbp0 = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});
const gbp2 = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (v) => gbp0.format(Math.round(v));

const escapeHTML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/* ── State ───────────────────────────────────────────── */

let currentRegion = 'scotland';
let currentGrowthRate = 5;
let lastResult = null;
let lastForm = null;
let chatHistory = []; // [{role, content}] follow-up turns after the first analysis

const NUMBER_FIELDS = [
  'currentAge', 'retirementAge', 'currentSalary', 'currentPension', 'currentSavings',
  'outstandingMortgage', 'additionalIncome', 'additionalIncomeStartAge',
  'employeeContribution', 'employerContribution', 'niQualifyingYears',
  'statePensionAge', 'salaryGrowth',
];

function getForm() {
  const form = {};
  for (const id of NUMBER_FIELDS) form[id] = parseFloat($(id).value) || 0;
  form.contributionType = $('contributionType').value;
  form.includeHigherRateRelief =
    form.contributionType === 'relief_at_source' && $('includeHigherRateRelief').checked;
  form.showInTodaysMoney = $('inflationToggle').checked;
  form.growthRate = currentGrowthRate;
  form.region = currentRegion;
  return form;
}

function setForm(data) {
  for (const id of NUMBER_FIELDS) {
    if (data[id] !== undefined) $(id).value = data[id];
  }
  $('contributionType').value = data.contributionType ?? 'salary_sacrifice';
  $('includeHigherRateRelief').checked = !!data.includeHigherRateRelief;
  $('inflationToggle').checked = !!data.showInTodaysMoney;
  setGrowthRate(data.growthRate ?? 5);
  setRegion(data.region === 'ruk' || data.region === 'england' ? 'ruk' : 'scotland');
  syncContributionType();
}

/* ── Theme ───────────────────────────────────────────── */

function resolvedTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  const next = resolvedTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  buildCharts(next);
}

/* ── Controls ────────────────────────────────────────── */

function setRegion(region) {
  currentRegion = region;
  for (const btn of $('regionControl').querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(btn.dataset.region === region));
  }
}

function setGrowthRate(rate) {
  currentGrowthRate = parseFloat(rate) || 5;
  for (const btn of $('growthControl').querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(parseFloat(btn.dataset.rate) === currentGrowthRate));
  }
}

function syncContributionType() {
  const type = $('contributionType').value;
  $('contributionExplainer').textContent = CONTRIBUTION_TYPES[type]?.explainer ?? '';
  const showRelief = type === 'relief_at_source';
  $('higherRateReliefField').hidden = !showRelief;
  if (!showRelief) $('includeHigherRateRelief').checked = false;
}

/* ── Calculation + render ────────────────────────────── */

function recalc() {
  const form = getForm();
  localStorage.setItem('plannerForm', JSON.stringify(form));

  if (!(form.currentAge > 0 && form.currentSalary > 0 && form.retirementAge > form.currentAge)) {
    $('stripValue').textContent = '—';
    $('stripNote').textContent =
      form.retirementAge <= form.currentAge && form.currentAge > 0
        ? 'Retirement age must be after your current age.'
        : 'Enter your age, retirement age and salary to build your statement.';
    $('stripTimeline').hidden = true;
    return;
  }

  const result = projectPension(form);
  if (!result) return;
  lastResult = result;
  lastForm = form;
  render(result, form);
}

function render(result, form) {
  const real = result.showInTodaysMoney;
  const pot = real ? result.finalPotReal : result.finalPot;

  // Statement strip
  $('stripLabel').textContent = `Projected pot at ${form.retirementAge}`;
  $('stripValue').textContent = fmt(pot);
  const paidIn = result.yearly.at(-1).cumulativeContributions;
  $('stripNote').innerHTML =
    `${real ? "in <em>today's money</em> · " : ''}` +
    `${fmt(paidIn)} paid in, ${fmt(result.finalPot - paidIn)} growth over ${result.years} years`;

  // Timeline
  $('stripTimeline').hidden = false;
  const span = form.retirementAge - form.currentAge;
  $('timelineFill').style.width = '100%';
  $('timelineStart').textContent = `Age ${form.currentAge}`;
  $('timelineEnd').textContent = `Retire at ${form.retirementAge}`;
  const sp = $('timelineSP');
  if (form.statePensionAge > form.currentAge && form.statePensionAge < form.retirementAge) {
    sp.style.display = 'block';
    sp.style.left = `${(((form.statePensionAge - form.currentAge) / span) * 100).toFixed(1)}%`;
  } else {
    sp.style.display = 'none';
  }

  // Stat tiles
  const now = result.now;
  $('takeHomeBefore').textContent = fmt(now.takeHomeBefore / 12);
  $('takeHomeAfter').textContent = fmt(now.takeHomeAfter / 12);
  $('taxSaved').textContent = fmt(now.taxSaved);

  const r = result.retirement;
  const potForIncome = real
    ? Math.max(0, result.finalPotReal + Math.round(r.savingsAtRetirement / Math.pow(1.02, result.years)) - r.outstandingMortgage)
    : r.netWealth;
  const monthlyIncome = (potForIncome * 0.04) / 12 + r.monthlyStatePension;
  $('retirementIncome').textContent = fmt(monthlyIncome);
  let sub = `4% rule ${fmt((potForIncome * 0.04) / 12)}/mo + state pension ${fmt(r.monthlyStatePension)}/mo`;
  if (r.outstandingMortgage > 0) sub += ` · after ${fmt(r.outstandingMortgage)} mortgage`;
  $('retirementIncomeSub').textContent = sub;

  // State pension note
  const spInfo = $('statePensionInfo');
  if (r.annualStatePension > 0) {
    spInfo.hidden = false;
    let text = `State pension: ${fmt(r.annualStatePension)}/yr from age ${form.statePensionAge}.`;
    if (r.gapYears > 0) {
      text += ` Your private pension carries the first ${r.gapYears} year${r.gapYears > 1 ? 's' : ''} of retirement alone.`;
    }
    spInfo.textContent = text;
  } else {
    spInfo.hidden = true;
  }

  // Annual allowance warning
  const aa = result.allowance;
  const aaEl = $('allowanceWarning');
  if (aa.exceeded || aa.approaching) {
    aaEl.hidden = false;
    aaEl.textContent = aa.exceeded
      ? `Annual allowance exceeded: ${fmt(aa.totalContributions)}/yr goes into your pension against an allowance of ${fmt(aa.allowance)}. The ${fmt(aa.excess)} excess may incur a tax charge.`
      : `Contributions of ${fmt(aa.totalContributions)}/yr are approaching your ${fmt(aa.allowance)} annual allowance.`;
  } else {
    aaEl.hidden = true;
  }

  // Validation notices
  const warnings = validateInputs(form, result);
  const vEl = $('validationNotice');
  vEl.hidden = warnings.length === 0;
  vEl.innerHTML = warnings.map((w) => `<p>${escapeHTML(w)}</p>`).join('');

  updateCharts(result, resolvedTheme());
}

/* ── Breakdown modal ─────────────────────────────────── */

function openBreakdown(kind) {
  if (!lastResult) return;
  const now = lastResult.now;
  const isAfter = kind === 'after';
  $('breakdownTitle').textContent = isAfter
    ? 'Tax breakdown — after pension'
    : 'Tax breakdown — before pension';

  const tax = isAfter ? now.taxAfter : now.taxBefore;
  const ni = isAfter ? now.niAfter : now.niBefore;
  const employerNIVal = isAfter ? now.employerNIAfter : now.employerNIBefore;

  const row = (label, yearly, cls = '') =>
    `<tr class="${cls}"><td>${label}</td><td>${gbp2.format(yearly)}</td><td>${gbp2.format(yearly / 12)}</td><td>${gbp2.format(yearly / 52)}</td></tr>`;

  let html = '<table class="ledger"><thead><tr><th>Item</th><th>Yearly</th><th>Monthly</th><th>Weekly</th></tr></thead><tbody>';
  let total = 0;
  for (const band of tax.breakdown) {
    total += band.tax;
    html += row(`${escapeHTML(band.name)} rate (${Math.round(band.rate * 100)}%)`, band.tax);
  }
  total += ni;
  html += row('National Insurance', ni);

  if (isAfter) {
    html += row('└ Your contribution', now.employeeAnnual, 'sub pot');
    html += row('└ Employer contribution', now.employerAnnual, 'sub pot');
    if (now.basicRelief > 0) html += row('└ Provider tax relief', now.basicRelief, 'sub pot');
    if (now.higherRateRefund > 0) html += row('└ Higher-rate refund (to you)', now.higherRateRefund, 'sub');
    if (now.employerNISaving > 0) html += row('└ Employer NI saving to pot', now.employerNISaving, 'sub pot');
    html += row('Total into pension', now.totalToPot, 'pot');
  }

  html += row('Total tax & NI', total, 'total');
  html += '</tbody></table>';
  html += `<p class="footnote" style="margin-top:12px">Employer NI of ${gbp2.format(employerNIVal)} is paid by your employer and not deducted from your pay.</p>`;

  $('breakdownContent').innerHTML = html;
  openModal('breakdownModal');
}

/* ── Optimisation modal ──────────────────────────────── */

function openOptimise() {
  if (!lastForm) {
    recalc();
    if (!lastForm) return;
  }
  const o = optimise(lastForm);
  let html = '';

  if (o.scenarios.length > 0) {
    html += '<p>Contributing enough to bring your income below a band threshold saves tax at your highest rate:</p>';
    html += '<div class="table-scroll"><table class="ledger"><thead><tr><th>Target</th><th>Required %</th><th>Extra contribution</th><th>Tax &amp; NI saved</th><th>Net cost</th></tr></thead><tbody>';
    for (const s of o.scenarios) {
      html += `<tr><td>Below ${escapeHTML(s.targetBand)} threshold (${fmt(s.thresholdIncome)})</td>` +
        `<td>${s.requiredPct}%</td><td>${fmt(s.additionalContribution)}</td>` +
        `<td>${fmt(s.annualSaving)}</td><td>${fmt(s.netCost)}</td></tr>`;
      if (s.exceedsAnnualAllowance) {
        html += `<tr><td colspan="5" style="color:var(--danger-border);font-size:0.8rem">⚠ This level of contribution exceeds the annual allowance.</td></tr>`;
      }
    }
    html += '</tbody></table></div>';
    html += '<p class="footnote" style="margin-top:8px">Net cost = extra pension contribution minus the tax and NI you no longer pay. The full contribution still lands in your pot.</p>';
  } else {
    html += '<p>No lower tax band is within reach of a higher contribution — your marginal rate is already at the bottom of the ladder for your salary.</p>';
  }

  if (o.recommendations.length > 0) {
    html += '<h3 style="margin-top:16px;font-size:0.95rem">Suggestions</h3>';
    for (const rec of o.recommendations) html += `<div class="opt-rec">${escapeHTML(rec)}</div>`;
  }

  $('optimiseContent').innerHTML = html;
  openModal('optimiseModal');
}

/* ── Scenarios ───────────────────────────────────────── */

const getScenarios = () => JSON.parse(localStorage.getItem('pensionScenarios') ?? '[]');
const storeScenarios = (s) => localStorage.setItem('pensionScenarios', JSON.stringify(s));

function saveScenario() {
  if (!lastForm) return;
  const name = prompt('Name this scenario:');
  if (!name) return;
  const scenarios = getScenarios();
  scenarios.push({ id: Date.now(), name: name.slice(0, 60), data: getForm(), date: new Date().toISOString() });
  storeScenarios(scenarios);
  renderScenarios();
}

function renderScenarios() {
  const scenarios = getScenarios();
  const list = $('scenarioList');
  $('compareBtn').hidden = scenarios.length < 2;
  if (scenarios.length === 0) {
    list.innerHTML = '<p class="empty">No saved scenarios yet.</p>';
    return;
  }
  list.innerHTML = '';
  for (const s of scenarios) {
    const item = document.createElement('div');
    item.className = 'scenario-item';
    item.innerHTML =
      `<div><div class="name">${escapeHTML(s.name)}</div>` +
      `<div class="date">${new Date(s.date).toLocaleDateString('en-GB')}</div></div>` +
      `<button type="button" class="delete" aria-label="Delete scenario">×</button>`;
    item.addEventListener('click', () => {
      setForm(s.data);
      recalc();
    });
    item.querySelector('.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`Delete scenario “${s.name}”?`)) return;
      storeScenarios(getScenarios().filter((x) => x.id !== s.id));
      renderScenarios();
    });
    list.appendChild(item);
  }
}

function showComparison() {
  const scenarios = getScenarios();
  const rows = scenarios
    .map((s) => ({ name: s.name, form: s.data, result: projectPension(s.data) }))
    .filter((s) => s.result);
  if (rows.length < 2) return;

  const metrics = [
    ['Salary', (s) => fmt(s.form.currentSalary)],
    ['You / employer %', (s) => `${s.form.employeeContribution}% / ${s.form.employerContribution}%`],
    ['Growth', (s) => `${s.form.growthRate}%`],
    ['Pot at retirement', (s) => fmt(s.result.finalPot)],
    ['Monthly take-home', (s) => fmt(s.result.now.takeHomeAfter / 12)],
    ['Tax & NI saved / yr', (s) => fmt(s.result.now.taxSaved)],
    ['Retirement income /mo', (s) => fmt(s.result.retirement.totalMonthlyWithdrawal)],
  ];

  let html = '<table class="ledger"><thead><tr><th>Metric</th>';
  for (const s of rows) html += `<th>${escapeHTML(s.name)}</th>`;
  html += '</tr></thead><tbody>';
  for (const [label, get] of metrics) {
    html += `<tr><td>${label}</td>${rows.map((s) => `<td>${get(s)}</td>`).join('')}</tr>`;
  }
  html += '</tbody></table>';

  $('comparisonTable').innerHTML = html;
  $('comparisonBlock').hidden = false;
  $('comparisonBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ── Export / print ──────────────────────────────────── */

function exportSummary() {
  if (!lastResult || !lastForm) return;
  const r = lastResult;
  const f = lastForm;
  const now = r.now;
  const ri = r.retirement;
  const regionLabel = TAX_CONFIG.regions[f.region].label;

  const row = (label, value) => `<tr><td>${label}</td><td>${value}</td></tr>`;
  const html = `<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8"><title>Pension plan summary</title>
<style>
body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111;line-height:1.55}
h1{font-size:1.5rem;border-bottom:3px double #555;padding-bottom:8px}
h2{font-size:1.05rem;margin-top:26px;border-bottom:1px solid #ccc;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin:10px 0;font-variant-numeric:tabular-nums}
td{padding:6px 10px;border-bottom:1px solid #eee}td:last-child{text-align:right;font-weight:600}
.hero{font-size:2.2rem;font-weight:700;margin:14px 0 2px}
.muted{color:#666;font-size:0.85rem}
</style></head><body>
<h1>Pension plan summary</h1>
<p class="muted">Generated ${new Date().toLocaleDateString('en-GB')} · ${regionLabel} · ${TAX_YEAR} tax rates</p>
<p class="hero">${fmt(r.finalPot)}</p>
<p class="muted">Projected pot at age ${f.retirementAge}${r.showInTodaysMoney ? ` (${fmt(r.finalPotReal)} in today's money)` : ''}</p>
<h2>Your details</h2><table>
${row('Age / retirement age', `${f.currentAge} / ${f.retirementAge} (${r.years} years)`)}
${row('Annual salary', fmt(f.currentSalary))}
${row('Current pension pot', fmt(f.currentPension))}
${row('Savings', fmt(f.currentSavings))}
${f.outstandingMortgage > 0 ? row('Outstanding mortgage', fmt(f.outstandingMortgage)) : ''}
</table>
<h2>Contributions</h2><table>
${row('You', `${f.employeeContribution}% (${fmt(now.employeeAnnual)}/yr)`)}
${row('Employer', `${f.employerContribution}% (${fmt(now.employerAnnual)}/yr)`)}
${row('Type', CONTRIBUTION_TYPES[f.contributionType].label)}
${row('Total into pension', `${fmt(now.totalToPot)}/yr`)}
${row('Tax & NI saved', `${fmt(now.taxSaved)}/yr`)}
</table>
<h2>Take-home pay</h2><table>
${row('Before pension', `${fmt(now.takeHomeBefore / 12)}/mo`)}
${row('After pension', `${fmt(now.takeHomeAfter / 12)}/mo`)}
</table>
<h2>Retirement income</h2><table>
${row('4% safe withdrawal', `${fmt(ri.monthlyWithdrawal)}/mo`)}
${row('Annuity estimate (5%)', `${fmt(ri.monthlyAnnuity)}/mo`)}
${row('State pension', `${fmt(ri.monthlyStatePension)}/mo from age ${f.statePensionAge}`)}
${row('Combined (4% + state)', `${fmt(ri.totalMonthlyWithdrawal)}/mo`)}
${ri.outstandingMortgage > 0 ? row('Mortgage cleared at retirement', fmt(ri.outstandingMortgage)) : ''}
</table>
<h2>Assumptions</h2><table>
${row('Investment growth', `${f.growthRate}%`)}
${row('Salary growth', `${f.salaryGrowth}%`)}
${row('Savings growth', '3%')}
</table>
<p class="muted">Estimate for illustration only — not financial advice.</p>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* ── Claude analysis ─────────────────────────────────── */

function planSummary() {
  const r = lastResult;
  const f = lastForm;
  const now = r.now;
  const ri = r.retirement;
  const aa = r.allowance;
  return [
    `Region: ${TAX_CONFIG.regions[f.region].label} (${TAX_YEAR} rates)`,
    `Age ${f.currentAge}, retiring at ${f.retirementAge} (${r.years} years away); state pension age ${f.statePensionAge} with ${f.niQualifyingYears} qualifying NI years`,
    `Salary £${f.currentSalary.toLocaleString()}${f.additionalIncome > 0 ? `, plus £${f.additionalIncome.toLocaleString()}/yr additional income from age ${f.additionalIncomeStartAge}` : ''}`,
    `Current pension pot £${f.currentPension.toLocaleString()}, savings £${f.currentSavings.toLocaleString()}, outstanding mortgage £${f.outstandingMortgage.toLocaleString()}`,
    `Contributions: employee ${f.employeeContribution}%, employer ${f.employerContribution}%, via ${CONTRIBUTION_TYPES[f.contributionType].label.toLowerCase()}${f.includeHigherRateRelief ? ' (claiming higher-rate relief)' : ''}`,
    `Total into pension £${Math.round(now.totalToPot).toLocaleString()}/yr; tax & NI saved £${Math.round(now.taxSaved).toLocaleString()}/yr`,
    `Take-home: £${Math.round(now.takeHomeBefore / 12).toLocaleString()}/mo before pension, £${Math.round(now.takeHomeAfter / 12).toLocaleString()}/mo after`,
    `Assumed growth ${f.growthRate}%/yr, salary growth ${f.salaryGrowth}%/yr`,
    `Projected pot at ${f.retirementAge}: £${r.finalPot.toLocaleString()}${r.showInTodaysMoney ? ` (£${r.finalPotReal.toLocaleString()} in today's money)` : ''}`,
    `Estimated retirement income: £${Math.round(ri.totalMonthlyWithdrawal).toLocaleString()}/mo (4% rule + state pension of £${Math.round(ri.annualStatePension).toLocaleString()}/yr)${ri.gapYears > 0 ? `; ${ri.gapYears}-year gap before state pension starts` : ''}`,
    `Annual allowance: ${aa.exceeded ? `EXCEEDED by £${aa.excess.toLocaleString()}` : aa.approaching ? 'approaching the limit' : 'within limits'} (£${Math.round(aa.totalContributions).toLocaleString()} of £${aa.allowance.toLocaleString()})`,
  ].join('\n');
}

// Minimal markdown → HTML. Input is escaped first, so the only HTML present
// is what we generate here.
function markdownToHTML(text) {
  const lines = escapeHTML(text).split('\n');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (!line.trim()) { closeList(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length + 1}>${h[2]}</h${h[1].length + 1}>`; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${line.replace(/^\s*([-*]|\d+\.)\s+/, '')}</li>`;
      continue;
    }
    closeList();
    html += `<p>${line}</p>`;
  }
  closeList();
  return html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function addChatMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'assistant') div.innerHTML = markdownToHTML(text);
  else div.textContent = text;
  $('analysisContent').appendChild(div);
  $('analysisContent').scrollTop = $('analysisContent').scrollHeight;
  return div;
}

async function streamAnalysis(question) {
  const container = $('analysisContent');
  const pending = document.createElement('div');
  pending.className = 'msg assistant';
  pending.innerHTML = '<span class="spinner"></span><span class="pending">Analysing your plan…</span>';
  container.appendChild(pending);
  container.scrollTop = container.scrollHeight;

  let accumulated = '';
  try {
    const response = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plan: planSummary(),
        question: question || undefined,
        history: chatHistory,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${response.status})`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const part of parts) {
        if (!part.trim()) continue;
        const event = JSON.parse(part);
        if (event.type === 'text') {
          accumulated += event.text;
          pending.innerHTML = markdownToHTML(accumulated);
          container.scrollTop = container.scrollHeight;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }
      }
    }
    if (!accumulated) throw new Error('No response received.');
    chatHistory.push(
      ...(question ? [{ role: 'user', content: question }] : []),
      { role: 'assistant', content: accumulated }
    );
  } catch (err) {
    pending.innerHTML = `<p><strong>Analysis failed.</strong> ${escapeHTML(err.message)}</p>`;
  }
}

function openAnalysis() {
  if (!lastResult) {
    recalc();
    if (!lastResult) return;
  }
  chatHistory = [];
  $('analysisContent').innerHTML = '';
  openModal('analysisModal');
  streamAnalysis();
}

/* ── Modals ──────────────────────────────────────────── */

let openModalId = null;

function openModal(id) {
  const modal = $(id);
  modal.hidden = false;
  openModalId = id;
  modal.querySelector('.close')?.focus();
}

function closeModal() {
  if (!openModalId) return;
  $(openModalId).hidden = true;
  openModalId = null;
}

/* ── Wiring ──────────────────────────────────────────── */

function init() {
  $('taxYear').textContent = TAX_YEAR;
  for (const el of document.querySelectorAll('.taxYearText')) el.textContent = TAX_YEAR;

  // Restore saved form (falls back to the defaults in the HTML).
  const saved = localStorage.getItem('plannerForm');
  if (saved) {
    try { setForm(JSON.parse(saved)); } catch { /* ignore corrupt state */ }
  } else {
    syncContributionType();
  }

  const recalcSoon = debounce(recalc, 250);

  $('regionControl').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-region]');
    if (!btn) return;
    setRegion(btn.dataset.region);
    recalc();
  });

  $('growthControl').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-rate]');
    if (!btn) return;
    setGrowthRate(btn.dataset.rate);
    recalc();
  });

  for (const id of NUMBER_FIELDS) $(id).addEventListener('input', recalcSoon);
  $('contributionType').addEventListener('change', () => { syncContributionType(); recalc(); });
  $('includeHigherRateRelief').addEventListener('change', recalc);
  $('inflationToggle').addEventListener('change', recalc);

  $('themeToggle').addEventListener('click', toggleTheme);
  $('takeHomeBeforeCard').addEventListener('click', () => openBreakdown('before'));
  $('takeHomeAfterCard').addEventListener('click', () => openBreakdown('after'));
  $('optimiseBtn').addEventListener('click', openOptimise);
  $('analyseBtn').addEventListener('click', openAnalysis);
  $('exportBtn').addEventListener('click', exportSummary);
  $('saveScenarioBtn').addEventListener('click', saveScenario);
  $('compareBtn').addEventListener('click', showComparison);

  $('analysisForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('analysisQuestion').value.trim();
    if (!q) return;
    $('analysisQuestion').value = '';
    addChatMessage('user', q);
    streamAnalysis(q);
  });

  // Modal close: backdrop, × button, Escape.
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) closeModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!document.documentElement.dataset.theme) buildCharts(resolvedTheme());
  });

  buildCharts(resolvedTheme());
  renderScenarios();
  recalc();
}

init();
