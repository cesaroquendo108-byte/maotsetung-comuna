// Client helper to get Finve rates and calculations for the Comuna Mao Tse Tung Community Fund

export async function fetchFinveFundRates() {
  try {
    const res = await fetch('/api/fund-rate');
    if (res.ok) {
      return await res.json();
    }
  } catch (_) {}

  // Fallback to direct DolarAPI if serverless api is not reached
  try {
    const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
    if (res.ok) {
      const data = await res.json();
      const rate = data?.promedio || 875.65;
      return {
        date: new Date().toISOString().split('T')[0],
        bcvRate: rate,
        usdtRate: Number((rate * 1.15).toFixed(2)),
        quotaBs: 1000,
        quotaUsd: Number((1000 / rate).toFixed(2)),
        families: 300,
        monthlyTotalBs: 300000,
        monthlyTotalUsd: Number((300000 / rate).toFixed(2)),
        annualTotalUsd: Number(((300000 / rate) * 12).toFixed(2)),
        source: 'DolarAPI Fallback',
      };
    }
  } catch (_) {}

  // Offline default
  return {
    date: '2026-10-12',
    bcvRate: 875.65,
    usdtRate: 1009.28,
    quotaBs: 1000,
    quotaUsd: 1.14,
    families: 300,
    monthlyTotalBs: 300000,
    monthlyTotalUsd: 342.60,
    annualTotalUsd: 4111.20,
    source: 'Tasa Fiduciaria Precalculada',
  };
}

export function formatBs(amount) {
  const num = Number(amount || 0);
  return `Bs. ${num.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUsd(amount) {
  const num = Number(amount || 0);
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

