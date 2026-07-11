// UK tax configuration — 2026-27 tax year (verified 2026-07-11).
// `taxableUpTo` is the statutory band boundary in taxable income (after the
// personal allowance); `upTo` is the published gross-income figure assuming
// the standard PA, used for display and the optimiser.

export const TAX_YEAR = '2026-27';

export const TAX_CONFIG = {
  personalAllowance: 12570,
  personalAllowanceTaperThreshold: 100000,

  annualAllowance: 60000,
  annualAllowanceTaperThreshold: 260000,
  annualAllowanceMinimum: 10000,

  regions: {
    scotland: {
      label: 'Scotland',
      bands: [
        { name: 'Starter', upTo: 16537, taxableUpTo: 3967, rate: 0.19 },
        { name: 'Basic', upTo: 29526, taxableUpTo: 16956, rate: 0.20 },
        { name: 'Intermediate', upTo: 43662, taxableUpTo: 31092, rate: 0.21 },
        { name: 'Higher', upTo: 75000, taxableUpTo: 62430, rate: 0.42 },
        { name: 'Advanced', upTo: 125140, taxableUpTo: 125140, rate: 0.45 },
        { name: 'Top', upTo: Infinity, taxableUpTo: Infinity, rate: 0.48 },
      ],
    },
    ruk: {
      label: 'England, Wales & NI',
      bands: [
        { name: 'Basic', upTo: 50270, taxableUpTo: 37700, rate: 0.20 },
        { name: 'Higher', upTo: 125140, taxableUpTo: 125140, rate: 0.40 },
        { name: 'Additional', upTo: Infinity, taxableUpTo: Infinity, rate: 0.45 },
      ],
    },
  },

  employeeNI: {
    primaryThreshold: 12570,
    upperEarningsLimit: 50270,
    mainRate: 0.08,
    upperRate: 0.02,
  },

  employerNI: {
    secondaryThreshold: 5000,
    rate: 0.15,
  },

  statePension: {
    fullAnnual: 12547.6, // £241.30/week
    fullQualifyingYears: 35,
    minQualifyingYears: 10,
  },
};

export const CONTRIBUTION_TYPES = {
  salary_sacrifice: {
    label: 'Salary sacrifice',
    explainer:
      'Your gross salary is reduced before tax and NI are calculated, so you pay less of both. ' +
      'Many employers also pass on some of their own NI saving. Usually the most tax-efficient option.',
  },
  relief_at_source: {
    label: 'Relief at source',
    explainer:
      'You contribute from after-tax pay and your provider adds 20% basic-rate relief automatically. ' +
      'Higher and additional rate relief must be claimed through self-assessment.',
  },
  net_pay: {
    label: 'Net pay arrangement',
    explainer:
      'Deducted from gross pay before income tax but after NI. Full income-tax relief is automatic, ' +
      'but you still pay NI on the contribution.',
  },
};
