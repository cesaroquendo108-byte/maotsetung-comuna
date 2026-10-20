export function familyResidentStatus(hasMatchedHousehold) {
  return hasMatchedHousehold ? 'active' : 'review';
}

export function importedResidentStatus({ hasMatchedHousehold = true, firstName = '', lastName = '' } = {}) {
  if (!hasMatchedHousehold) return 'review';
  return String(firstName).trim() && String(lastName).trim() ? 'active' : 'review';
}

export function importBatchPayload({ communityId, sourceFiles, summary, importedBy }) {
  if (!communityId) throw new Error('communityId es obligatorio para crear un lote de importación.');
  return {
    community: communityId,
    type: 'census_and_payments',
    sourceFiles,
    status: 'processing',
    summary,
    importedBy,
  };
}
