import {
  allowJsonPost,
  authenticate,
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
    let auth = null;
    try {
      auth = await authenticate(req);
    } catch (authErr) {
      return json(res, 401, {
        error: 'Tu sesión no es válida o ha vencido. Inicia sesión para continuar.',
        code: 'SESSION_EXPIRED',
      });
    }

    const input = bodyOf(req);
    const token = await serviceToken();

    const communityCode = String(input.communityCode || 'MTT-001').trim().toUpperCase();
    const community = await findCommunity({ communityCode, token });

    // Validate active membership of the caller
    const memSearch = await pbRequest(
      `/api/collections/community_memberships/records?perPage=1&filter=${encode(`community = "${community.id}" && user = "${auth.user.id}" && status = "active"`)}`,
      { token }
    );
    const callerMembership = memSearch.items?.[0];
    if (!callerMembership) {
      return json(res, 403, { error: 'No tienes una membresía activa en este consejo comunal.' });
    }

    const isManager = callerMembership.role === 'admin' || callerMembership.role === 'collaborator';

    // Target household identification
    let targetHouseholdId = String(input.householdId || input.household || '').trim();
    const householdCodeInput = String(input.householdCode || '').trim().toUpperCase();

    if (!targetHouseholdId && householdCodeInput) {
      const hhSearch = await pbRequest(
        `/api/collections/households/records?perPage=1&filter=${encode(`community = "${community.id}" && code = "${householdCodeInput}" && status = "active"`)}`,
        { token }
      );
      targetHouseholdId = hhSearch.items?.[0]?.id || '';
    }

    if (!targetHouseholdId && callerMembership.household) {
      targetHouseholdId = callerMembership.household;
    }

    if (!targetHouseholdId) {
      return json(res, 400, { error: 'Tu cuenta no tiene un hogar vinculado para asociar al integrante.' });
    }

    if (!isManager && callerMembership.household !== targetHouseholdId) {
      return json(res, 403, { error: 'Solo puedes agregar integrantes a tu propio hogar.' });
    }

    // Name validations
    const firstName = String(input.firstName || '').trim();
    const lastName = String(input.lastName || '').trim();
    if (!firstName || !lastName) {
      return json(res, 400, { error: 'El nombre y apellido del integrante son obligatorios.' });
    }

    // Cédula & nationality formatting
    const rawId = String(input.idNumber || '').replace(/\D/g, '');
    const nat = ['V', 'E', 'OTHER'].includes(String(input.nationality || '').toUpperCase())
      ? String(input.nationality).toUpperCase()
      : 'V';
    const idFormatted = rawId ? `${nat === 'OTHER' ? 'E' : nat}-${rawId}` : '';
    const idQuality = rawId ? 'valid' : 'empty';

    // Date of birth & sex formatting
    let birthDate = null;
    if (input.birthDate) {
      const cleanBirth = String(input.birthDate).split('T')[0].split(' ')[0].trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(cleanBirth)) {
        birthDate = cleanBirth;
      }
    }

    const sex = ['F', 'M', 'X'].includes(String(input.sex || '').toUpperCase())
      ? String(input.sex).toUpperCase()
      : '';

    // Check if resident already exists in the community
    let existingResident = null;
    if (rawId) {
      const searchRes = await pbRequest(
        `/api/collections/residents/records?perPage=1&filter=${encode(`community = "${community.id}" && (idNumberNormalized = "${rawId}" || idNumber = "${idFormatted}")`)}`,
        { token }
      );
      existingResident = searchRes.items?.[0] || null;
    }

    const residentPayload = {
      community: community.id,
      household: targetHouseholdId,
      firstName,
      lastName,
      idNumber: idFormatted,
      idNumberNormalized: rawId,
      idQuality,
      nationality: rawId ? (nat === 'OTHER' ? 'E' : nat) : (input.nationality || 'V'),
      birthDate,
      sex,
      relationship: String(input.relationship || '').trim() || 'Integrante',
      phone: String(input.phone || '').trim(),
      gasProvider: String(input.gasProvider || '').trim(),
      housingTenure: String(input.housingTenure || 'propia').trim(),
      votingCenterName: String(input.votingCenterName || '').trim(),
      communityTrade: String(input.communityTrade || '').trim(),
      rifNumber: String(input.rifNumber || '').trim().toUpperCase(),
      conditionAffection: String(input.conditionAffection || 'ninguna').trim(),
      chronicDiseases: String(input.chronicDiseases || '').trim(),
      notes: String(input.notes || '').trim(),
      status: 'active',
      createdBy: auth.user.id,
    };

    let resident = null;
    if (existingResident) {
      resident = await pbRequest(
        `/api/collections/residents/records/${existingResident.id}`,
        {
          method: 'PATCH',
          token,
          body: residentPayload,
        }
      );
    } else {
      resident = await pbRequest(
        '/api/collections/residents/records',
        {
          method: 'POST',
          token,
          body: residentPayload,
        }
      );
    }

    // Upsert electoral profile if voting center is supplied
    if (resident && input.votingCenterName) {
      try {
        const existingElectoral = await pbRequest(
          `/api/collections/electoral_profiles/records?perPage=1&filter=${encode(`community = "${community.id}" && resident = "${resident.id}"`)}`,
          { token }
        );
        const nowIso = new Date().toISOString();
        const electoralPayload = {
          community: community.id,
          resident: resident.id,
          status: 'registered',
          votingCenterName: String(input.votingCenterName).trim(),
          source: 'registro_manual_censo',
          checkedAt: nowIso,
          consentAt: nowIso,
          checkedBy: auth.user.id,
        };
        if (existingElectoral.items?.length) {
          await pbRequest(
            `/api/collections/electoral_profiles/records/${existingElectoral.items[0].id}`,
            {
              method: 'PATCH',
              token,
              body: electoralPayload,
            }
          );
        } else {
          await pbRequest(
            '/api/collections/electoral_profiles/records',
            {
              method: 'POST',
              token,
              body: electoralPayload,
            }
          );
        }
      } catch (electoralErr) {
        console.warn('Advertencia actualizando perfil electoral al agregar integrante:', electoralErr);
      }
    }

    return json(res, 200, {
      success: true,
      resident,
    });
  } catch (error) {
    console.error('Error en add-family-member:', error);
    return json(res, error.status || 500, {
      error: error.message || 'Error al agregar integrante al hogar.',
    });
  }
}
