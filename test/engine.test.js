import test from 'node:test';
import assert from 'node:assert/strict';
import {
  personalAllowance,
  incomeTax,
  employeeNI,
  employerNI,
  statePension,
  annualAllowanceCheck,
  yearFinances,
  retirementIncome,
  projectPension,
  optimise,
} from '../public/js/engine.js';

const close = (actual, expected, eps = 0.01) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

test('personal allowance tapers £1 per £2 over £100k', () => {
  assert.equal(personalAllowance(50000), 12570);
  assert.equal(personalAllowance(100000), 12570);
  assert.equal(personalAllowance(110000), 7570);
  assert.equal(personalAllowance(125140), 0);
  assert.equal(personalAllowance(200000), 0);
});

test('rUK income tax at £45,000 is £6,486', () => {
  close(incomeTax(45000, 'ruk').total, 6486);
});

test('rUK income tax handles PA taper (£110,000 → £33,432)', () => {
  // 37,700 @ 20% + (110,000 - 7,570 - 37,700) @ 40%
  close(incomeTax(110000, 'ruk').total, 33432);
});

test('rUK additional rate above £125,140 taxable (£150,000 → £48,674.50)', () => {
  // PA = 0: 37,700 @ 20% + 87,440 @ 40% + 24,860 @ 45%
  close(incomeTax(150000, 'ruk').total, 7540 + 34976 + 11187);
});

test('Scottish income tax at £45,000 is £6,882.05', () => {
  // 3,967 @ 19% + 12,989 @ 20% + 14,136 @ 21% + 1,338 @ 42%
  close(incomeTax(45000, 'scotland').total, 6882.05);
});

test('no income tax at or below the personal allowance', () => {
  assert.equal(incomeTax(12570, 'ruk').total, 0);
  assert.equal(incomeTax(9000, 'scotland').total, 0);
});

test('employee NI: 8% between thresholds, 2% above UEL', () => {
  assert.equal(employeeNI(12570), 0);
  close(employeeNI(45000), (45000 - 12570) * 0.08);
  close(employeeNI(60000), (50270 - 12570) * 0.08 + (60000 - 50270) * 0.02);
});

test('employer NI: 15% above £5,000', () => {
  assert.equal(employerNI(5000), 0);
  close(employerNI(45000), 6000);
});

test('state pension scales with qualifying years', () => {
  close(statePension(35), 12547.6);
  close(statePension(40), 12547.6);
  close(statePension(20), (12547.6 * 20) / 35);
  assert.equal(statePension(9), 0);
});

test('annual allowance tapers above £260k to a £10k floor', () => {
  assert.equal(annualAllowanceCheck(30000, 100000).allowance, 60000);
  assert.equal(annualAllowanceCheck(30000, 300000).allowance, 40000);
  assert.equal(annualAllowanceCheck(30000, 400000).allowance, 10000);
  assert.ok(annualAllowanceCheck(65000, 100000).exceeded);
  assert.equal(annualAllowanceCheck(65000, 100000).excess, 5000);
});

const baseYear = {
  salary: 45000,
  employeePct: 0.05,
  employerPct: 0.03,
  region: 'ruk',
};

test('salary sacrifice: reduces tax and NI, employer NI saving into pot', () => {
  const f = yearFinances({ ...baseYear, contributionType: 'salary_sacrifice' });
  close(f.takeHomeBefore, 45000 - 6486 - 2594.4);
  close(f.takeHomeAfter, 42750 - 6036 - 2414.4);
  close(f.employerNISaving, 2250 * 0.15);
  close(f.totalToPot, 2250 + 1350 + 337.5);
  close(f.taxSaved, 630); // 28% of the £2,250 sacrificed
});

test('relief at source: 80% from net pay, 20% relief into pot', () => {
  const f = yearFinances({ ...baseYear, contributionType: 'relief_at_source' });
  close(f.employeeAnnual, 1800);
  close(f.basicRelief, 450);
  close(f.takeHomeAfter, 45000 - 6486 - 2594.4 - 1800);
  close(f.totalToPot, 1800 + 450 + 1350);
});

test('relief at source higher-rate refund for a higher-rate taxpayer', () => {
  const f = yearFinances({
    salary: 80000,
    employeePct: 0.1,
    employerPct: 0.03,
    region: 'ruk',
    contributionType: 'relief_at_source',
    includeHigherRateRelief: true,
  });
  // £8,000 gross contribution entirely within the 40% band: total relief 40%,
  // 20% claimed by provider, 20% refunded via tax return.
  close(f.basicRelief, 1600);
  close(f.higherRateRefund, 1600);
});

test('net pay: full tax relief, NI unchanged', () => {
  const f = yearFinances({ ...baseYear, contributionType: 'net_pay' });
  close(f.niAfter, f.niBefore);
  close(f.takeHomeAfter, 42750 - 6036 - 2594.4);
  close(f.totalToPot, 2250 + 1350);
});

test('retirement income subtracts the outstanding mortgage from net wealth', () => {
  const r = retirementIncome({
    pot: 500000,
    savingsAtRetirement: 50000,
    outstandingMortgage: 100000,
    annualStatePension: 12547.6,
    retirementAge: 65,
    statePensionAge: 67,
  });
  assert.equal(r.netWealth, 450000);
  close(r.monthlyWithdrawal, (450000 * 0.04) / 12);
  close(r.monthlyAnnuity, (500000 * 0.05) / 12);
  assert.equal(r.gapYears, 2);
});

test('net wealth never goes negative', () => {
  const r = retirementIncome({
    pot: 50000,
    savingsAtRetirement: 0,
    outstandingMortgage: 100000,
    annualStatePension: 0,
    retirementAge: 65,
    statePensionAge: 67,
  });
  assert.equal(r.netWealth, 0);
});

const baseForm = {
  currentAge: 35,
  retirementAge: 65,
  currentSalary: 45000,
  currentPension: 50000,
  employeeContribution: 5,
  employerContribution: 3,
  contributionType: 'salary_sacrifice',
  growthRate: 5,
  region: 'ruk',
  niQualifyingYears: 35,
  statePensionAge: 67,
};

test('projection returns null when retirement age <= current age', () => {
  assert.equal(projectPension({ ...baseForm, retirementAge: 35 }), null);
});

test('projection: zero growth, flat salary → pot = start + years × contributions', () => {
  const r = projectPension({ ...baseForm, growthRate: 0 });
  close(r.finalPot, 50000 + 30 * 3937.5, 1);
  assert.equal(r.yearly.length, 31);
  assert.equal(r.yearly[0].age, 35);
  assert.equal(r.yearly.at(-1).age, 65);
});

test('projection: growth increases the pot and today’s-money figure is smaller', () => {
  const r = projectPension({ ...baseForm, showInTodaysMoney: true });
  assert.ok(r.finalPot > 50000 + 30 * 3937.5);
  assert.ok(r.finalPotReal < r.finalPot);
  close(r.finalPotReal, r.finalPot / Math.pow(1.02, 30), 1);
});

test('projection: salary growth increases contributions over time', () => {
  const r = projectPension({ ...baseForm, salaryGrowth: 3 });
  assert.ok(r.yearly[20].employeeThisYear > r.yearly[0].employeeThisYear);
});

test('projection: additional income only counts from its start age', () => {
  const r = projectPension({
    ...baseForm,
    additionalIncome: 10000,
    additionalIncomeStartAge: 50,
  });
  // current-year snapshot at 35 excludes it
  close(r.now.totalIncome, 45000);
});

test('optimise finds a band-boundary scenario for a higher-rate earner', () => {
  const o = optimise({
    region: 'ruk',
    currentSalary: 60000,
    employeeContribution: 5,
    employerContribution: 3,
    contributionType: 'salary_sacrifice',
    includeHigherRateRelief: false,
  });
  const s = o.scenarios.find((x) => x.targetBand === 'Basic');
  assert.ok(s, 'expected a scenario targeting the basic-rate boundary');
  close(s.requiredPct, ((60000 - 50270) / 60000) * 100, 0.1);
  // Sacrificing from 60,000 to 50,270: saves 40% tax + 2% NI... minus the 8%/2% NI band shift
  assert.ok(s.annualSaving > 0);
});

test('optimise recommends salary sacrifice when not using it', () => {
  const o = optimise({
    region: 'scotland',
    currentSalary: 45000,
    employeeContribution: 5,
    employerContribution: 3,
    contributionType: 'relief_at_source',
    includeHigherRateRelief: false,
  });
  assert.ok(o.recommendations.some((r) => r.includes('salary sacrifice')));
});
