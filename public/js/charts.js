// Chart rendering — theme-aware Chart.js wrappers.
// Palette validated against both surfaces (dataviz six-checks, 2026-07-11).

const THEMES = {
  light: {
    series: ['#2a78d6', '#1baf7a', '#eda100'],
    ink: '#52514e',
    grid: '#e1e0d9',
    surface: '#fdfdfb',
    dashed: '#4a3aa7',
  },
  dark: {
    series: ['#3987e5', '#199e70', '#c98500'],
    ink: '#c3c2b7',
    grid: '#2c2c2a',
    surface: '#1a1a19',
    dashed: '#9085e9',
  },
};

let charts = { projection: null, contribution: null };
let lastResult = null;

const gbp = (v) =>
  '£' +
  (Math.abs(v) >= 1_000_000
    ? (v / 1_000_000).toFixed(1) + 'M'
    : Math.abs(v) >= 1000
      ? Math.round(v / 1000) + 'k'
      : Math.round(v));

const tooltipLabel = (ctx) =>
  `${ctx.dataset.label}: £${Math.round(ctx.parsed.y).toLocaleString('en-GB')}`;

function baseScales(t) {
  return {
    x: {
      ticks: { color: t.ink, maxTicksLimit: 12, font: { size: 11 } },
      grid: { display: false },
      border: { color: t.grid },
      title: { display: true, text: 'Age', color: t.ink, font: { size: 11 } },
    },
    y: {
      ticks: { color: t.ink, callback: gbp, maxTicksLimit: 7, font: { size: 11 } },
      grid: { color: t.grid },
      border: { display: false },
    },
  };
}

function basePlugins(t) {
  return {
    legend: {
      labels: { color: t.ink, boxWidth: 14, boxHeight: 14, font: { size: 12 } },
    },
    tooltip: {
      backgroundColor: t.surface,
      titleColor: t.ink,
      bodyColor: t.ink,
      borderColor: t.grid,
      borderWidth: 1,
      callbacks: { label: tooltipLabel },
    },
  };
}

export function buildCharts(theme) {
  destroyCharts();
  const t = THEMES[theme] ?? THEMES.light;

  charts.projection = new Chart(document.getElementById('projectionChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        line('Total pot', t.series[0]),
        line('Total paid in', t.series[1]),
        line('Investment growth', t.series[2]),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: basePlugins(t),
      scales: baseScales(t),
    },
  });

  charts.contribution = new Chart(document.getElementById('contributionChart'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        bar('Your contributions', t.series[0], t.surface),
        bar('Employer contributions', t.series[1], t.surface),
        bar('Investment growth', t.series[2], t.surface),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: basePlugins(t),
      scales: {
        x: { ...baseScales(t).x, stacked: true },
        y: { ...baseScales(t).y, stacked: true },
      },
    },
  });

  if (lastResult) updateCharts(lastResult, theme);

  function line(label, color) {
    return {
      label,
      data: [],
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.3,
    };
  }
  function bar(label, color, surface) {
    return {
      label,
      data: [],
      backgroundColor: color,
      stack: 'year',
      borderColor: surface,
      borderWidth: { top: 2, right: 0, bottom: 0, left: 0 }, // 2px surface gap between segments
      borderRadius: 2,
    };
  }
}

export function updateCharts(result, theme) {
  lastResult = result;
  if (!charts.projection) return;
  const t = THEMES[theme] ?? THEMES.light;
  const y = result.yearly;
  const labels = y.map((d) => d.age);

  const p = charts.projection;
  p.data.labels = labels;
  p.data.datasets[0].data = y.map((d) => d.pot);
  p.data.datasets[1].data = y.map((d) => d.cumulativeContributions);
  p.data.datasets[2].data = y.map((d) => d.cumulativeGrowth);

  // Optional today's-money line: same entity in real terms → dashed.
  const wantReal = result.showInTodaysMoney;
  if (wantReal && p.data.datasets.length < 4) {
    p.data.datasets.push({
      label: "Pot (today's money)",
      data: [],
      borderColor: t.dashed,
      backgroundColor: 'transparent',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 5,
      tension: 0.3,
    });
  } else if (!wantReal && p.data.datasets.length > 3) {
    p.data.datasets.splice(3, 1);
  }
  if (wantReal) p.data.datasets[3].data = y.map((d) => d.potReal);
  p.update('none');

  const c = charts.contribution;
  c.data.labels = labels;
  c.data.datasets[0].data = y.map((d) => d.employeeThisYear);
  c.data.datasets[1].data = y.map((d) => d.employerThisYear);
  c.data.datasets[2].data = y.map((d) => d.growthThisYear);
  c.update('none');
}

export function destroyCharts() {
  for (const key of Object.keys(charts)) {
    charts[key]?.destroy();
    charts[key] = null;
  }
}
