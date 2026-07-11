// Pure calculation engine — no DOM access, unit-tested via node --test.
import { TAX_CONFIG } from './tax-data.js';

export function personalAllowance(income) {
  const { personalAllowance: pa, personalAllowanceTaperThreshold: taper } = TAX_CONFIG;
  if (income <= taper) return pa;
  return Math.max(0, pa - Math.floor((income - taper) / 2));
}

// Income tax on gross income. Statutory bands apply to taxable income
// (gross minus the — possibly tapered — personal allowance).
export function incomeTax(gross, region) {
  const bands = TAX_CONFIG.regions[region].bands;
  const pa = personalAllowance(gross);
  const taxable = Math.max(0, gross - pa);
  let prev = 0;
  let total = 0;
  const breakdown = [];

  for (const band of bands) {
    if (taxable <= prev) break;
    const inBand = Math.min(taxable, band.taxableUpTo) - prev;
    if (inBand > 0) {
      const tax = inBand * band.rate;
      total += tax;
      breakdown.push({ name: band.name, rate: band.rate, taxable: inBand, tax });
    }
    prev = band.taxableUpTo;
  }
  return { total, breakdown };
}

export function employeeNI(salary) {
  const { primaryThreshold, upperEarningsLimit, mainRate, upperRate } = TAX_CONFIG.employeeNI;
  if (salary <= primaryThreshold) return 0;
  const main = (Math.min(salary, upperEarningsLimit) - primaryThreshold) * mainRate;
  const upper = Math.max(0, salary - upperEarningsLimit) * upperRate;
  return main + upper;
}

export function employerNI(salary) {
  const { secondaryThreshold, rate } = TAX_CONFIG.employerNI;
  return Math.max(0, salary - secondaryThreshold) * rate;
}

export function statePension(qualifyingYears) {
  const { fullAnnual, fullQualifyingYears, minQualifyingYears } = TAX_CONFIG.statePension;
  if (qualifyingYears < minQualifyingYears) return 0;
  return (Math.min(qualifyingYears, fullQualifyingYears) / fullQualifyingYears) * fullAnnual;
}

export function annualAllowanceCheck(totalContributions, adjustedIncome) {
  const {
    annualAllowance,
    annualAllowanceTaperThreshold: taper,
    annualAllowanceMinimum: floor,
  } = TAX_CONFIG;
  let allowance = annualAllowance;
  if (adjustedIncome > taper) {
    allowance = Math.max(floor, allowance - Math.floor((adjustedIncome - taper) / 2));
  }
  return {
    allowance,
    totalContributions,
    exceeded: totalContributions > allowance,
    approaching: totalContributions > allowance * 0.85 && totalContributions <= allowance,
    excess: Math.max(0, totalContributions - allowance),
    tapered: adjustedIncome > taper,
  };
}

// Take-home and pension flows for one year at a given salary.
// Returns tax/NI before and after pension, plus what lands in the pot.
export function yearFinances({
  salary,
  additionalIncome = 0,
  employeePct,
  employerPct,
  contributionType,
  includeHigherRateRelief = false,
  region,
}) {
  const totalIncome = salary + additionalIncome;

  const taxBefore = incomeTax(totalIncome, region);
  const niBefore = employeeNI(salary);
  const employerNIBefore = employerNI(salary);
  const takeHomeBefore = totalIncome - taxBefore.total - niBefore;

  const employerAnnual = salary * employerPct;
  let employeeAnnual = 0; // what leaves the employee's pay
  let basicRelief = 0; // provider-claimed relief (RAS)
  let higherRateRefund = 0; // claimed via tax return, goes to pocket not pot
  let taxableAfter = totalIncome;
  let niSalary = salary;
  let deductionFromNetPay = 0;

  if (contributionType === 'salary_sacrifice') {
    employeeAnnual = salary * employeePct;
    taxableAfter = totalIncome - employeeAnnual;
    niSalary = salary - employeeAnnual;
  } else if (contributionType === 'relief_at_source') {
    const grossContribution = salary * employeePct;
    employeeAnnual = grossContribution * 0.8;
    basicRelief = grossContribution * 0.2;
    deductionFromNetPay = employeeAnnual;
    if (includeHigherRateRelief) {
      const reduced = incomeTax(totalIncome - grossContribution, region);
      higherRateRefund = Math.max(0, taxBefore.total - reduced.total - basicRelief);
    }
  } else {
    // net pay arrangement
    employeeAnnual = salary * employeePct;
    taxableAfter = totalIncome - employeeAnnual;
  }

  const taxAfter = incomeTax(taxableAfter, region);
  const niAfter = employeeNI(niSalary);
  const employerNIAfter = employerNI(niSalary);
  const employerNISaving = employerNIBefore - employerNIAfter;
  const employeeNISaving = niBefore - niAfter;

  const takeHomeAfter =
    taxableAfter - taxAfter.total - niAfter - deductionFromNetPay + higherRateRefund;

  // What actually lands in the pot each year. With salary sacrifice we assume
  // the employer passes their NI saving into the pension (common practice).
  const totalToPot =
    employeeAnnual +
    employerAnnual +
    (contributionType === 'salary_sacrifice' ? employerNISaving : basicRelief);

  const taxSaved = taxBefore.total + niBefore - taxAfter.total - niAfter + basicRelief + higherRateRefund;

  return {
    totalIncome,
    taxBefore,
    niBefore,
    employerNIBefore,
    takeHomeBefore,
    taxAfter,
    niAfter,
    employerNIAfter,
    takeHomeAfter,
    employeeAnnual,
    employerAnnual,
    basicRelief,
    higherRateRefund,
    employeeNISaving,
    employerNISaving,
    totalToPot,
    taxSaved,
  };
}

export function retirementIncome({
  pot,
  savingsAtRetirement = 0,
  outstandingMortgage = 0,
  annualStatePension,
  retirementAge,
  statePensionAge,
}) {
  // Net wealth = pot + savings − remaining mortgage (assumed cleared at retirement).
  const netWealth = Math.max(0, pot + savingsAtRetirement - outstandingMortgage);
  const safeWithdrawal = netWealth * 0.04;
  const annuityIncome = pot * 0.05;
  return {
    netWealth,
    monthlyWithdrawal: safeWithdrawal / 12,
    monthlyAnnuity: annuityIncome / 12,
    annualStatePension,
    monthlyStatePension: annualStatePension / 12,
    totalMonthlyWithdrawal: (safeWithdrawal + annualStatePension) / 12,
    totalMonthlyAnnuity: (annuityIncome + annualStatePension) / 12,
    gapYears: Math.max(0, statePensionAge - retirementAge),
    savingsAtRetirement,
    outstandingMortgage,
  };
}

export function projectPension(form) {
  const {
    currentAge,
    retirementAge,
    currentSalary,
    currentPension = 0,
    currentSavings = 0,
    outstandingMortgage = 0,
    additionalIncome = 0,
    additionalIncomeStartAge = 0,
    employeeContribution,
    employerContribution,
    contributionType,
    includeHigherRateRelief = false,
    growthRate,
    salaryGrowth = 0,
    showInTodaysMoney = false,
    niQualifyingYears = 35,
    statePensionAge = 67,
    region,
  } = form;

  const years = retirementAge - currentAge;
  if (years <= 0) return null;

  const employeePct = employeeContribution / 100;
  const employerPct = employerContribution / 100;
  const growth = growthRate / 100;
  const salaryGrowthRate = salaryGrowth / 100;
  const inflation = showInTodaysMoney ? 0.02 : 0;

  // Current-year snapshot for summary cards.
  const now = yearFinances({
    salary: currentSalary,
    additionalIncome: additionalIncome > 0 && additionalIncomeStartAge <= currentAge ? additionalIncome : 0,
    employeePct,
    employerPct,
    contributionType,
    includeHigherRateRelief,
    region,
  });

  // Year-by-year projection.
  let pot = currentPension;
  let salary = currentSalary;
  let cumulativeContributions = currentPension;
  let cumulativeGrowth = 0;
  const yearly = [];

  for (let year = 0; year <= years; year++) {
    const age = currentAge + year;
    const deflator = Math.pow(1 + inflation, year);
    const point = {
      age,
      pot: Math.round(pot),
      potReal: Math.round(pot / deflator),
      cumulativeContributions: Math.round(cumulativeContributions),
      cumulativeGrowth: Math.round(cumulativeGrowth),
      salary: Math.round(salary),
      employeeThisYear: 0,
      employerThisYear: 0,
      growthThisYear: 0,
    };
    yearly.push(point);

    if (year < years) {
      const extra = additionalIncome > 0 && additionalIncomeStartAge <= age ? additionalIncome : 0;
      const fin = yearFinances({
        salary,
        additionalIncome: extra,
        employeePct,
        employerPct,
        contributionType,
        includeHigherRateRelief,
        region,
      });
      const growthThisYear = pot * growth;
      point.employeeThisYear = Math.round(fin.employeeAnnual);
      point.employerThisYear = Math.round(fin.employerAnnual);
      point.growthThisYear = Math.round(growthThisYear);

      cumulativeGrowth += growthThisYear;
      pot += growthThisYear + fin.totalToPot;
      cumulativeContributions += fin.totalToPot;
      salary *= 1 + salaryGrowthRate;
    }
  }

  const finalPot = Math.round(pot);
  const finalPotReal = Math.round(pot / Math.pow(1 + inflation, years));

  const annualStatePension = statePension(niQualifyingYears);
  const savingsAtRetirement = currentSavings * Math.pow(1.03, years); // conservative 3% p.a.
  const income = retirementIncome({
    pot: finalPot,
    savingsAtRetirement,
    outstandingMortgage,
    annualStatePension,
    retirementAge,
    statePensionAge,
  });

  const allowance = annualAllowanceCheck(Math.round(now.totalToPot), now.totalIncome);

  return {
    years,
    finalPot,
    finalPotReal,
    yearly,
    now,
    retirement: income,
    annualStatePension,
    savingsAtRetirement: Math.round(savingsAtRetirement),
    allowance,
    showInTodaysMoney,
  };
}

export function validateInputs(form, result) {
  const warnings = [];
  const monthly = result.now.takeHomeAfter / 12;
  if (form.employeeContribution > 50) {
    warnings.push(
      `Your contribution rate is very high (${form.employeeContribution}%). Monthly take-home falls to about £${Math.round(monthly).toLocaleString('en-GB')}.`
    );
  } else if (monthly < 1500 && form.currentSalary > 0) {
    warnings.push(
      `Monthly take-home of about £${Math.round(monthly).toLocaleString('en-GB')} is low — check this plan is sustainable.`
    );
  }
  if (form.employeeContribution + form.employerContribution > 100) {
    warnings.push('Total contributions exceed 100% of salary.');
  }
  if (form.retirementAge < form.statePensionAge) {
    const gap = form.statePensionAge - form.retirementAge;
    warnings.push(
      `You retire ${gap} year${gap > 1 ? 's' : ''} before your state pension starts — your private pension carries those years alone.`
    );
  }
  return warnings;
}

// Tax optimisation: for each band boundary below the current marginal
// position, how much extra contribution brings taxable income down to it, and
// what does that save in tax + NI?
export function optimise(form) {
  const region = TAX_CONFIG.regions[form.region];
  const { currentSalary, employeeContribution, contributionType } = form;
  const currentPct = employeeContribution / 100;
  const base = {
    salary: currentSalary,
    additionalIncome: 0,
    employerPct: form.employerContribution / 100,
    contributionType,
    includeHigherRateRelief: form.includeHigherRateRelief,
    region: form.region,
  };
  const current = yearFinances({ ...base, employeePct: currentPct });

  const scenarios = [];
  for (const band of region.bands) {
    if (band.upTo === Infinity || band.upTo >= currentSalary) continue;
    const requiredContribution = currentSalary - band.upTo;
    const requiredPct = requiredContribution / currentSalary;
    if (requiredPct <= currentPct || requiredPct > 1) continue;

    const target = yearFinances({ ...base, employeePct: requiredPct });
    const additionalContribution = requiredContribution - currentSalary * currentPct;
    const annualSaving =
      current.taxAfter.total + current.niAfter - (target.taxAfter.total + target.niAfter);
    const extraToPot = target.totalToPot - current.totalToPot;

    scenarios.push({
      targetBand: band.name,
      thresholdIncome: band.upTo,
      requiredPct: Math.round(requiredPct * 1000) / 10,
      additionalContribution: Math.round(additionalContribution),
      annualSaving: Math.round(annualSaving),
      extraToPot: Math.round(extraToPot),
      netCost: Math.round(additionalContribution - annualSaving),
      exceedsAnnualAllowance:
        target.totalToPot > annualAllowanceCheck(target.totalToPot, currentSalary).allowance,
    });
  }

  const recommendations = [];
  if (contributionType !== 'salary_sacrifice') {
    recommendations.push(
      'Ask whether your employer offers salary sacrifice — it saves both income tax and National Insurance on every pound you contribute.'
    );
  }
  if (form.employeeContribution < 5) {
    recommendations.push(
      'Check your employer matching policy — many schemes match contributions up to 5%, which is an immediate 100% return.'
    );
  }
  const marginalBand = region.bands.find((b) => currentSalary <= b.upTo) ?? region.bands.at(-1);
  if (marginalBand.rate >= 0.4 && form.employeeContribution < 10) {
    recommendations.push(
      `You pay ${Math.round(marginalBand.rate * 100)}% on your top slice of income — every extra pound into your pension avoids that rate.`
    );
  }

  return { scenarios, recommendations, current };
}
