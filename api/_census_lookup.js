import fs from 'node:fs';
import {
  json,
  pbRequest,
  serviceToken,
} from './_consolidated.js';

let cachedHistoricalCensus = null;

function getHistoricalCensus() {
  if (!cachedHistoricalCensus) {
    try {
      const content = fs.readFileSync(
        new URL('./_historical_census_data.json', import.meta.url),
        'utf-8'
      );
      cachedHistoricalCensus = JSON.parse(content);
    } catch (_) {
      cachedHistoricalCensus = {};
    }
  }
  return cachedHistoricalCensus;
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    let body = {};
    if (req.body) {
      if (typeof req.body === 'object') {
        body = req.body;
      } else {
        try { body = JSON.parse(String(req.body)); } catch (_) {}
      }
    }

    const rawIdInput = q.idNumber || body.idNumber || '';
    const rawId = String(rawIdInput).replace(/\D/g, '');

    if (!rawId || rawId.length < 4) {
      return json(res, 400, {
        found: false,
        error: 'Indica un número de cédula válido.',
      });
    }

    const nationalityReq = String(q.nationality || body.nationality || 'V')
      .toUpperCase()
      .includes('E')
      ? 'E'
      : 'V';

    // 1. Search in historical census backup (fast memory lookup)
    const historical = getHistoricalCensus();
    const historicalMatch = historical[rawId];

    if (historicalMatch) {
      return json(res, 200, {
        found: true,
        source: 'historical_census',
        data: {
          idNumber: historicalMatch.idNumber || `${nationalityReq}-${rawId}`,
          idNumberNormalized: rawId,
          nationality: historicalMatch.nationality || nationalityReq,
          firstName: historicalMatch.firstName || '',
          lastName: historicalMatch.lastName || '',
          birthDate: historicalMatch.birthDate || '',
          phone: historicalMatch.phone || '',
          sex: historicalMatch.sex || '',
          relationship: historicalMatch.relationship || '',
          dwellingAddress: historicalMatch.dwellingAddress || '',
          householdCode: historicalMatch.householdCode || '',
          sourceSheet: historicalMatch.sourceSheet || '',
        },
      });
    }

    // 2. Fallback: Search in PocketBase active/registered residents
    try {
      const token = await serviceToken();
      const filter = encodeURIComponent(
        `(idNumberNormalized = "${rawId}" || idNumber ~ "${rawId}") && status != "inactive"`
      );
      const pbSearch = await pbRequest(
        `/api/collections/residents/records?perPage=1&sort=-created&filter=${filter}`,
        { token }
      );

      const resident = pbSearch.items?.[0];
      if (resident) {
        return json(res, 200, {
          found: true,
          source: 'registered_resident',
          data: {
            idNumber: resident.idNumber || `${nationalityReq}-${rawId}`,
            idNumberNormalized: resident.idNumberNormalized || rawId,
            nationality: resident.nationality || nationalityReq,
            firstName: resident.firstName || '',
            lastName: resident.lastName || '',
            birthDate: resident.birthDate ? String(resident.birthDate).slice(0, 10) : '',
            phone: resident.phone || '',
            sex: resident.sex || '',
            relationship: resident.relationship || '',
            dwellingAddress: resident.dwellingAddress || '',
            householdCode: resident.household || '',
            houseNumber: resident.houseNumber || '',
            zoneCode: resident.zoneCode || '',
          },
        });
      }
    } catch (_) {}

    return json(res, 200, {
      found: false,
      message: 'Cédula no encontrada en el histórico del censo comunal.',
    });
  } catch (error) {
    return json(res, 500, {
      found: false,
      error: error.message || 'Error al consultar el censo histórico.',
    });
  }
}
