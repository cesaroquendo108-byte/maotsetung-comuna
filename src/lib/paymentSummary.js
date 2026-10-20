export function summarizePaymentRecords(records = []) {
  const active = records.filter((record) => !['rejected', 'cancelled'].includes(record.status));
  const totals = active.reduce((result, record) => {
    const currency = record.currency === 'USD' ? 'USD' : 'VES';
    result[currency] += Number(record.amount || 0);
    return result;
  }, { VES: 0, USD: 0 });
  const statusCounts = records.reduce((result, record) => {
    result[record.status] = (result[record.status] || 0) + 1;
    return result;
  }, {});
  return { active, totals, statusCounts };
}
