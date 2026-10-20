const escapeFilterValue = (value, max = 100) => String(value ?? '')
  .trim()
  .slice(0, max)
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"');

const endOfBirthday = (today, yearsAgo) => {
  const year = today.getFullYear() - yearsAgo;
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const lastDayOfMonth = new Date(year, today.getMonth() + 1, 0).getDate();
  const day = String(Math.min(today.getDate(), lastDayOfMonth)).padStart(2, '0');
  return `${year}-${month}-${day} 23:59:59.999Z`;
};

export const electoralSegmentOptions = new Set([
  'Votantes',
  'Con centro electoral',
  'Sin centro electoral',
  'CNE pendiente',
  'Error CNE',
  'No inscrito CNE',
  'Fuente 2024',
]);

export function isElectoralSegment(segment) {
  return electoralSegmentOptions.has(segment);
}

export function profileMatchesElectoralSegment(profile = {}, segment) {
  const status = String(profile.status || '');
  const center = String(profile.votingCenterName || '').trim();
  const source = String(profile.source || '');
  switch (segment) {
    case 'Votantes':
      return status === 'registered';
    case 'Con centro electoral':
      return Boolean(center);
    case 'Sin centro electoral':
      return !center || ['unknown', 'verification_error'].includes(status);
    case 'CNE pendiente':
      return !center || ['unknown', 'verification_error'].includes(status);
    case 'Error CNE':
      return status === 'verification_error';
    case 'No inscrito CNE':
      return status === 'not_registered';
    case 'Fuente 2024':
      return source === 'resultadosconvzla-2024';
    default:
      return false;
  }
}

export function buildResidentIdFilter(ids = []) {
  const safeIds = ids.filter((id) => /^[a-z0-9]{15}$/i.test(String(id || '')));
  if (!safeIds.length) return 'id = "__none__"';
  return `(${safeIds.map((id) => `id = "${id}"`).join(' || ')})`;
}

export function buildResidentSearchFilter(query) {
  const text = escapeFilterValue(query, 80);
  if (!text) return '';

  const clauses = [`firstName ~ "${text}"`, `lastName ~ "${text}"`];
  const idNumber = text.replace(/\D/g, '');
  if (idNumber) clauses.push(`idNumberNormalized ~ "${idNumber}"`);
  return `(${clauses.join(' || ')})`;
}

export function buildResidentSegmentFilter(segment, today = new Date()) {
  const adultCutoff = endOfBirthday(today, 18);
  const seniorCutoff = endOfBirthday(today, 60);

  switch (segment) {
    case 'Niñez':
      return `birthDate != "" && birthDate > "${adultCutoff}"`;
    case 'Adulto':
      return `birthDate != "" && birthDate <= "${adultCutoff}" && birthDate > "${seniorCutoff}"`;
    case 'Adulto mayor':
      return `birthDate != "" && birthDate <= "${seniorCutoff}"`;
    case 'Votantes':
      return 'electoral_profiles_via_resident.status ?= "registered"';
    case 'Con centro electoral':
      return 'electoral_profiles_via_resident.votingCenterName != ""';
    case 'Sin centro electoral':
      return '(electoral_profiles_via_resident.votingCenterName = "" || electoral_profiles_via_resident.status ?= "unknown" || electoral_profiles_via_resident.status ?= "verification_error")';
    case 'CNE pendiente':
      return '(electoral_profiles_via_resident.status ?= "unknown" || electoral_profiles_via_resident.status ?= "verification_error")';
    case 'Error CNE':
      return 'electoral_profiles_via_resident.status ?= "verification_error"';
    case 'No inscrito CNE':
      return 'electoral_profiles_via_resident.status ?= "not_registered"';
    case 'Fuente 2024':
      return 'electoral_profiles_via_resident.source ?= "resultadosconvzla-2024"';
    case 'Sin fecha':
      return 'birthDate = ""';
    case 'Sin teléfono':
      return 'phone = "" && phone1 = "" && phone2 = ""';
    case 'Gas sin definir':
      return 'gasProvider = ""';
    case 'Gas Caracas':
      return 'gasProvider = "Gas Caracas"';
    case 'Gas Comunal':
      return '(gasProvider ~ "Comunal" || gasProvider ~ "PDVSA")';
    default:
      return '';
  }
}

export function buildResidentCouncilFilter(council) {
  const code = escapeFilterValue(council, 20);
  if (!code || code === 'Todos') return '';
  return `(zoneCode = "${code}" || household.code ~ "${code}")`;
}

export function buildResidentsFilter(scope, { query = '', segment = 'Todos', council = 'Todos', today } = {}) {
  return [
    scope,
    'status = "active"',
    buildResidentSearchFilter(query),
    buildResidentSegmentFilter(segment, today),
    buildResidentCouncilFilter(council),
  ].filter(Boolean).join(' && ');
}
