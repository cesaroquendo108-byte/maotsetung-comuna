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
        error: 'Tu sesión no es válida o ha vencido. Inicia sesión con Google para continuar.',
        code: 'SESSION_EXPIRED',
      });
    }

    const input = bodyOf(req);

    const residentId = String(input.residentId || '').trim();
    const householdId = String(input.householdId || '').trim();
    const communityCode = String(input.communityCode || 'URP-001').trim().toUpperCase();

    if (!residentId || !householdId) {
      return json(res, 400, { error: 'Los identificadores de residente y hogar son obligatorios.' });
    }

    const token = await serviceToken();
    const community = await findCommunity({ communityCode, token });

    // Validate resident belongs to community and household
    const resident = await pbRequest(
      `/api/collections/residents/records/${encode(residentId)}`,
      { token }
    );
    if (!resident || resident.community !== community.id || resident.household !== householdId) {
      return json(res, 400, { error: 'El registro de residente no concuerda con el hogar solicitado.' });
    }

    // Validate household belongs to community
    const household = await pbRequest(
      `/api/collections/households/records/${encode(householdId)}`,
      { token }
    );
    if (!household || household.community !== community.id) {
      return json(res, 400, { error: 'El hogar solicitado no pertenece a esta comunidad.' });
    }

    // Upsert community membership for current authenticated user
    let membership = null;
    const memSearch = await pbRequest(
      `/api/collections/community_memberships/records?perPage=1&filter=${encode(`community = "${community.id}" && user = "${auth.user.id}"`)}`,
      { token }
    );

    const userEmail = String(auth.user?.email || '').trim().toLowerCase();
    const isAdminEmail = ['jesus.oquendo@gmail.com', 'rosa.acosta05@gmail.com', 'cesaroquendo10@gmail.com', 'kilby12lite@gmail.com', 'eivaxs2003@gmail.com', 'david.enahp@gmail.com', 'comunamaotsetung.caracas@gmail.com'].includes(userEmail) || userEmail.endsWith('@uroprofin.invalid') || userEmail.endsWith('@maotsetung.invalid');

    const membershipData = {
      community: community.id,
      user: auth.user.id,
      household: household.id,
      resident: resident.id,
      role: isAdminEmail ? 'admin' : 'regular',
      status: 'active',
      notes: `Vinculación comunitaria confirmada por el usuario con cédula ${resident.idNumber || residentId}.`,
    };

    if (memSearch.items?.length) {
      membership = await pbRequest(
        `/api/collections/community_memberships/records/${memSearch.items[0].id}`,
        {
          method: 'PATCH',
          token,
          body: {
            household: household.id,
            resident: resident.id,
            status: 'active',
            notes: membershipData.notes,
            ...(isAdminEmail ? { role: 'admin' } : {}),
          },
        }
      );
    } else {
      membership = await pbRequest(
        '/api/collections/community_memberships/records',
        {
          method: 'POST',
          token,
          body: membershipData,
        }
      );
    }

    // Update resident with email, phone, rif, health, trade and voting center if provided
    const updateResidentFields = {};
    if (auth.user?.email && (!resident.email || resident.email !== auth.user.email)) {
      updateResidentFields.email = auth.user.email;
    }
    if (input.phone) updateResidentFields.phone = String(input.phone).trim();
    if (input.rifNumber) updateResidentFields.rifNumber = String(input.rifNumber).trim().toUpperCase();
    if (input.conditionAffection) updateResidentFields.conditionAffection = String(input.conditionAffection).trim();
    if (input.chronicDiseases !== undefined && input.chronicDiseases !== null) {
      updateResidentFields.chronicDiseases = String(input.chronicDiseases).trim();
    }
    if (input.communityTrade) updateResidentFields.communityTrade = String(input.communityTrade).trim();
    if (input.votingCenterName) updateResidentFields.votingCenterName = String(input.votingCenterName).trim();
    if (input.housingTenure) updateResidentFields.housingTenure = String(input.housingTenure).trim();

    if (Object.keys(updateResidentFields).length > 0) {
      try {
        await pbRequest(
          `/api/collections/residents/records/${resident.id}`,
          {
            method: 'PATCH',
            token,
            body: updateResidentFields,
          }
        );
      } catch (patchErr) {
        console.warn('Advertencia actualizando datos personales en residente:', patchErr);
      }
    }

    // Upsert electoral profile if voting center is declared
    if (input.votingCenterName || input.cneStatus) {
      try {
        const existingElectoral = await pbRequest(
          `/api/collections/electoral_profiles/records?perPage=1&filter=${encode(`community = "${community.id}" && resident = "${resident.id}"`)}`,
          { token }
        );
        const nowIso = new Date().toISOString();
        const electoralPayload = {
          community: community.id,
          resident: resident.id,
          status: input.cneStatus === 'not_registered' ? 'not_registered' : 'registered',
          votingCenterName: String(input.votingCenterName || '').trim(),
          source: 'confirmacion_perfil_residente',
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
        console.warn('Advertencia actualizando perfil electoral en confirm-household-match:', electoralErr);
      }
    }

    return json(res, 200, {
      success: true,
      household: {
        id: household.id,
        code: household.code,
        address: household.address,
      },
      resident: {
        id: resident.id,
        firstName: resident.firstName,
        lastName: resident.lastName,
        idNumber: resident.idNumber,
        relationship: resident.relationship,
      },
      membership,
    });
  } catch (error) {
    console.error('Error en confirm-household-match:', error);
    return json(res, error.status || 500, {
      error: error.message || 'Error al confirmar la vinculación al hogar.',
    });
  }
}
