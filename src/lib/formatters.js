export function formatCurrencyTotals(totals = {}, locale = 'es-VE') {
  const parts = [];
  if (Number(totals.VES || 0) > 0 || Number(totals.USD || 0) === 0) {
    parts.push(new Intl.NumberFormat(locale, { style: 'currency', currency: 'VES', maximumFractionDigits: 2 }).format(Number(totals.VES || 0)));
  }
  if (Number(totals.USD || 0) > 0) {
    parts.push(new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(totals.USD || 0)));
  }
  return parts.join(' · ');
}

export function formatPersonName(value) {
  if (!value) return '';
  const str = String(value);
  const hasLetters = /[a-záéíóúñüA-ZÁÉÍÓÚÑÜ]/.test(str);
  if (!hasLetters) return str;

  if (str.length > 1 && str.toUpperCase() === str) {
    return str.toLowerCase().replace(/(^|[\s\-'’])([a-záéíóúñü])/gi, (_, lead, char) => lead + char.toUpperCase());
  }

  return str.replace(/(^|[\s\-'’])([a-záéíóúñü])/gi, (_, lead, char) => lead + char.toUpperCase());
}

export function formatHousingTenure(tenure) {
  const clean = String(tenure || '').toLowerCase().trim();
  if (clean === 'alquilada') return 'Alquilada';
  if (clean === 'familiar' || clean.includes('prestada')) return 'Familiar / Prestada';
  if (clean === 'otra' || clean.includes('otra')) return 'Otra condición';
  if (clean === 'propia') return 'Propia';
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Propia';
}
