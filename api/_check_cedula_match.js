import {
  allowJsonPost,
  bodyOf,
  findCommunity,
  json,
  pbRequest,
  serviceToken,
} from './_consolidated.js';

function encode(val) {
  return encodeURIComponent(val);
}

export default async function handler(req, res) {
  if (!allowJsonPost(req, res)) return;

  try {
    const input = bodyOf(req);
    const rawId = String(input.idNumber || '').replace(/\D/g, '');
    if (!rawId || rawId.length < 5) {
      return json(res, 400, { error: 'El número de cédula no es válido.' });
    }

    const nationality = String(input.nationality || 'V').toUpperCase().includes('E') ? 'E' : 'V';
    const idFormatted = `${nationality}-${rawId}`;
    const communityCode = String(input.communityCode || 'URP-001').trim().toUpperCase();

    const token = await serviceToken();
    const community = await findCommunity({ communityCode, token });

    // Look for active resident matching the cédula
    const resFilter = encode(
      `community = "${community.id}" && (idNumberNormalized = "${rawId}" || idNumber = "${idFormatted}") && status != "inactive"`
    );
    const residentSearch = await pbRequest(
      `/api/collections/residents/records?perPage=1&sort=-created&filter=${resFilter}`,
      { token }
    );

    const resident = residentSearch.items?.[0] || null;
    if (!resident || !resident.household) {
      return json(res, 200, { matched: false });
    }

    // Fetch household details
    let household = null;
    try {
      household = await pbRequest(
        `/api/collections/households/records/${encode(resident.household)}`,
        { token }
      );
    } catch (_) {}

    if (!household || household.status === 'inactive') {
      return json(res, 200, { matched: false });
    }

    // Fetch head of household for context
    let headResident = null;
    try {
      const headFilter = encode(
        `community = "${community.id}" && household = "${household.id}" && relationship ~ "Jefe" && status != "inactive"`
      );
      const headSearch = await pbRequest(
        `/api/collections/residents/records?perPage=1&sort=created&filter=${headFilter}`,
        { token }
      );
      headResident = headSearch.items?.[0] || null;
    } catch (_) {}

    return json(res, 200, {
      matched: true,
      resident: {
        id: resident.id,
        firstName: resident.firstName || '',
        lastName: resident.lastName || '',
        idNumber: resident.idNumber || idFormatted,
        idNumberNormalized: resident.idNumberNormalized || rawId,
        nationality: resident.nationality || nationality,
        relationship: resident.relationship || 'Integrante',
        isHouseholdHead: Boolean(String(resident.relationship || '').toLowerCase().includes('jef')),
        phone: resident.phone || '',
        birthDate: resident.birthDate || '',
        sex: resident.sex || 'M',
        conditionAffection: resident.conditionAffection || resident.sourceValues?.conditionAffection || 'ninguna',
        chronicDiseases: resident.chronicDiseases || resident.sourceValues?.chronicDiseases || '',
        communityTrade: resident.communityTrade || resident.sourceValues?.communityTrade || '',
        rifNumber: resident.rifNumber || resident.sourceValues?.rifNumber || '',
        votingCenterName: resident.votingCenterName || resident.sourceValues?.votingCenterName || '',
      },
      household: {
        id: household.id,
        code: household.code,
        address: household.address || '',
        reference: household.reference || '',
      },
      headOfHousehold: headResident ? {
        id: headResident.id,
        firstName: headResident.firstName || '',
        lastName: headResident.lastName || '',
        idNumber: headResident.idNumber || '',
        phone: headResident.phone || '',
      } : null,
    });
  } catch (error) {
    console.error('Error en check-cedula-match:', error);
    return json(res, error.status || 500, {
      error: error.message || 'Error al verificar coincidencia de cédula en el censo.',
    });
  }
}
