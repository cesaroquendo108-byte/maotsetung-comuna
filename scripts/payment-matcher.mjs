const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const IGNORED_TOKENS = new Set(['Y', 'LA', 'EL', 'LOS', 'LAS', 'SRA', 'SR', 'SENORA', 'SENOR', 'MAMA', 'NUEVA']);

export function paymentNameTokens(value) {
  return normalize(value).split(' ').filter((token) => token.length >= 3 && !IGNORED_TOKENS.has(token));
}

export function matchPaymentToHousehold(payment, residents, householdByExternalKey) {
  const payerTokens = paymentNameTokens(payment.payerName);
  if (!payerTokens.length) return { matched: false, reason: 'missing_payer_name', householdCode: '' };

  const candidateHouseholds = new Set();
  for (const resident of residents) {
    const residentTokens = new Set(paymentNameTokens(`${resident.firstName} ${resident.lastName}`));
    const matches = payerTokens.length === 1
      ? residentTokens.has(payerTokens[0])
      : payerTokens.every((token) => residentTokens.has(token));
    if (!matches) continue;
    const household = householdByExternalKey.get(resident.householdExternalKey);
    if (household?.code) candidateHouseholds.add(household.code);
  }

  if (candidateHouseholds.size !== 1) {
    return {
      matched: false,
      reason: candidateHouseholds.size ? 'ambiguous_household' : 'no_census_match',
      householdCode: '',
      candidateCount: candidateHouseholds.size,
    };
  }
  return {
    matched: true,
    reason: payerTokens.length === 1 ? 'unique_name_or_surname_household' : 'full_token_match',
    householdCode: [...candidateHouseholds][0],
    candidateCount: 1,
  };
}

export function reconcilePaymentNames(payments, residents, households) {
  const householdByExternalKey = new Map(households.map((household) => [household.externalKey, household]));
  return payments.map((payment) => ({
    ...payment,
    match: matchPaymentToHousehold(payment, residents, householdByExternalKey),
  }));
}
