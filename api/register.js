import {
  allowJsonPost,
  authenticate,
  bodyOf,
  findCommunity,
  json,
  pbRequest,
  pbUpload,
  serviceToken,
} from './_consolidated.js';
import checkCedulaMatchHandler from './_check_cedula_match.js';
import confirmHouseholdMatchHandler from './_confirm_household_match.js';
import censusLookupHandler from './_census_lookup.js';

function encode(val) {
  return encodeURIComponent(val);
}

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim().toLowerCase();
  if (action === 'census-lookup' || action === 'lookup' || Boolean(req.query?.idNumber && !req.body)) {
    return censusLookupHandler(req, res);
  }
  if (action === 'check-match' || action === 'check-cedula-match') {
    return checkCedulaMatchHandler(req, res);
  }
  if (action === 'confirm-match' || action === 'confirm-household-match') {
    return confirmHouseholdMatchHandler(req, res);
  }

  if (!allowJsonPost(req, res)) return;

  try {
    let auth = null;
    try {
      auth = await authenticate(req);
    } catch (_) {
      // Public registration permitted without pre-existing session
    }
    const input = bodyOf(req);
    const token = await serviceToken();

    const communityCode = String(input.communityCode || 'MTT-001').trim().toUpperCase();
    const community = await findCommunity({ communityCode, token });

    const cedula = input.cedula || {};
    const rif = input.rif || {};
    const social = input.social || {};

    const rawId = String(cedula.numero_cedula || input.idNumber || '').replace(/\D/g, '');
    if (!rawId) {
      return json(res, 400, { error: 'El número de cédula es obligatorio.' });
    }

    const firstName = String(cedula.nombres || input.firstName || '').trim();
    const lastName = String(cedula.apellidos || input.lastName || '').trim();
    if (!firstName && !lastName) {
      return json(res, 400, { error: 'El nombre y apellido son obligatorios.' });
    }

    const nationality = String(cedula.tipo_documento || 'V').toUpperCase().includes('E') ? 'E' : 'V';
    const idFormatted = `${nationality}-${rawId}`;
    const zoneCode = String(social.zoneCode || 'CC-SAC').trim().toUpperCase();
    
    // House numbering and grouping
    const houseNumber = String(social.houseNumber || '').trim().replace(/[^a-zA-Z0-9-]/g, '') || rawId.slice(-4);
    const houseSuffix = String(social.houseSuffix || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const dwellingAddress = String(social.dwellingAddress || rif.domicilio_fiscal || `Casa ${houseNumber}`).trim();
    const phone = String(social.phone || '').trim().replace(/[^0-9+]/g, '');

    // Numeric sequence for door-to-door sorted delivery route (e.g. 1006 -> 1006)
    const rawSeq = parseInt(houseNumber.replace(/\D/g, ''), 10) || parseInt(rawId.slice(-4), 10) || 0;
    const numericSeq = Math.min(99999999, Math.max(0, rawSeq));

    // 1. Resolve or Create Zone
    let zoneRecord = null;
    if (social.zoneId) {
      try {
        zoneRecord = await pbRequest(`/api/collections/zones/records/${encode(social.zoneId)}`, { token });
      } catch (_) {}
    }
    if (!zoneRecord) {
      const zSearch = await pbRequest(`/api/collections/zones/records?perPage=1&filter=${encode(`community = "${community.id}" && code = "${zoneCode}"`)}`, { token });
      zoneRecord = zSearch.items?.[0] || null;
    }

    // 2. Resolve or Create Household with consistent sorting code
    const suffixPart = houseSuffix ? `-${houseSuffix}` : '';
    const prefix = communityCode.split('-')[0] || 'MTT';
    const householdCode = `${prefix}-${zoneCode}-${houseNumber}${suffixPart}`;
    let household = null;
    const existingHh = await pbRequest(`/api/collections/households/records?perPage=1&filter=${encode(`community = "${community.id}" && code = "${householdCode}"`)}`, { token });
    if (existingHh.items?.length) {
      household = existingHh.items[0];
    } else {
      try {
        household = await pbRequest('/api/collections/households/records', {
          method: 'POST',
          token,
          body: {
            community: community.id,
            code: householdCode,
            legacySequence: numericSeq,
            address: dwellingAddress,
            reference: `Zona ${zoneCode} · Casa ${houseNumber}${houseSuffix ? ` (${houseSuffix})` : ''}`,
            status: 'active',
          },
        });
      } catch (_) {
        household = await pbRequest('/api/collections/households/records', {
          method: 'POST',
          token,
          body: {
            community: community.id,
            code: householdCode,
            address: dwellingAddress,
            reference: `Zona ${zoneCode} · Casa ${houseNumber}${houseSuffix ? ` (${houseSuffix})` : ''}`,
            status: 'active',
          },
        });
      }
    }

    // 3. Resolve or Create Dwelling for consolidated map
    if (zoneRecord) {
      const existingDwelling = await pbRequest(`/api/collections/dwellings/records?perPage=1&filter=${encode(`community = "${community.id}" && code = "${householdCode}"`)}`, { token });
      if (!existingDwelling.items?.length) {
        try {
          await pbRequest('/api/collections/dwellings/records', {
            method: 'POST',
            token,
            body: {
              community: community.id,
              zone: zoneRecord.id,
              externalKey: `self_reg:${rawId || Date.now()}`,
              code: householdCode,
              status: 'verified',
            },
          });
        } catch (_) {}
      }
    }

    // 4. Create or Update Resident with complete community & social fields
    const childrenCount = parseInt(social.childrenCount || '0', 10) || 0;
    const childrenList = Array.isArray(social.children) ? social.children : [];
    const conditionAffection = String(social.conditionAffection || 'ninguna').toLowerCase();
    const affectionDetail = String(social.affectionDetail || '').trim();

    const residentData = {
      community: community.id,
      household: household.id,
      firstName,
      lastName,
      idNumber: idFormatted,
      idNumberNormalized: rawId,
      nationality,
      birthDate: cedula.fecha_nacimiento || null,
      sex: String(cedula.sexo || 'M').toUpperCase().startsWith('F') ? 'F' : 'M',
      phone: phone || null,
      email: auth?.user?.email || input.email || null,
      rifNumber: String(rif.numero_rif || '').trim().toUpperCase(),
      rifAddress: String(rif.domicilio_fiscal || '').trim(),
      rifState: String(rif.estado || '').trim(),
      rifMunicipality: String(rif.municipio || '').trim(),
      rifParish: String(rif.parroquia || '').trim(),
      rifCity: String(rif.ciudad || '').trim(),
      houseNumber,
      houseSuffix,
      dwellingAddress,
      zoneCode,
      // Rol en el hogar
      isHouseholdHead: Boolean(social.isHouseholdHead === true || social.isHouseholdHead === 'si' || String(social.relationship || '').toLowerCase().includes('jef')),
      relationship: (social.isHouseholdHead === true || social.isHouseholdHead === 'si' || String(social.relationship || '').toLowerCase().includes('jef'))
        ? 'Jefe(a) de Hogar'
        : (social.relationship || 'Integrante'),
      // Gas doméstico (Solo declarado por el Jefe de Hogar para evitar duplicaciones)
      gasCylindersCount: (social.isHouseholdHead === true || social.isHouseholdHead === 'si' || String(social.relationship || '').toLowerCase().includes('jef'))
        ? String(social.gasCylindersCount || '1')
        : '0',
      gasCylinderSize: String(social.gasCylinderSize || '10kg'),
      gasValveType: String(social.gasValveType || 'pico_rapido'),
      gasProvider: String(
        social.gasProvider === 'gas_miranda' || social.gasProvider === 'gas_caracas'
          ? 'Gas Caracas'
          : (social.gasProvider || 'Gas Caracas')
      ).trim(),
      // Salud y Casos Especiales
      conditionAffection: conditionAffection || 'ninguna',
      affectionDetail,
      chronicDiseases: String(social.chronicDiseases || '').trim(),
      regularMedications: String(social.regularMedications || '').trim(),
      isPregnantOrLactating: String(social.isPregnantOrLactating || 'no'),
      elderlyCount: String(social.elderlyCount || '0'),
      // Infraestructura y Oficios
      waterTankCapacity: String(social.waterTankCapacity || 'ninguno'),
      cookingAppliance: String(social.cookingAppliance || 'gas_exclusivo'),
      housingTenure: String(social.housingTenure || 'propia'),
      communityTrade: String(social.communityTrade || '').trim(),
      petsCount: String(social.petsCount || '0'),
      // Carga Familiar
      childrenCount,
      children: childrenList,
      sourceValues: {
        rawInput: social,
        cedulaScanned: Boolean(cedula.numero_cedula),
        rifScanned: Boolean(rif.numero_rif),
        registeredAt: new Date().toISOString(),
        cneStatus: social.cneStatus || 'registered',
        votingCenterName: String(social.votingCenterName || '').trim(),
      },
      status: 'active',
      source: 'auto_registro_scanner',
      createdBy: auth?.user?.id || null,
    };

    let resident = null;
    const existingResident = await pbRequest(`/api/collections/residents/records?perPage=1&filter=${encode(`community = "${community.id}" && (idNumberNormalized = "${rawId}" || idNumber = "${idFormatted}")`)}`, { token });

    const cedulaBase64 = cedula.imageBase64 || input.cedulaImageBase64 || null;
    const rifBase64 = rif.imageBase64 || input.rifImageBase64 || null;

    if (cedulaBase64 || rifBase64) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(residentData)) {
        if (value !== null && value !== undefined) {
          if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value));
          } else {
            formData.append(key, String(value));
          }
        }
      }

      if (cedulaBase64) {
        const cleanB64 = String(cedulaBase64).replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(cleanB64, 'base64');
        const blob = new Blob([buf], { type: 'image/jpeg' });
        const fileName = `cedula_${rawId}_${Date.now()}.jpg`;
        formData.append('cedulaFile', blob, fileName);
        formData.set('cedulaDoc', fileName);
      }

      if (rifBase64) {
        const cleanB64 = String(rifBase64).replace(/^data:image\/\w+;base64,/, '').replace(/^data:application\/pdf;base64,/, '');
        const buf = Buffer.from(cleanB64, 'base64');
        const mime = String(rifBase64).includes('application/pdf') ? 'application/pdf' : 'image/jpeg';
        const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
        const blob = new Blob([buf], { type: mime });
        const fileName = `rif_${rawId}_${Date.now()}.${ext}`;
        formData.append('rifFile', blob, fileName);
        formData.set('rifDoc', fileName);
      }

      if (existingResident.items?.length) {
        resident = await pbUpload(`/api/collections/residents/records/${existingResident.items[0].id}`, {
          method: 'PATCH',
          token,
          formData,
        });
      } else {
        resident = await pbUpload('/api/collections/residents/records', {
          method: 'POST',
          token,
          formData,
        });
      }
    } else {
      if (existingResident.items?.length) {
        resident = await pbRequest(`/api/collections/residents/records/${existingResident.items[0].id}`, {
          method: 'PATCH',
          token,
          body: residentData,
        });
      } else {
        resident = await pbRequest('/api/collections/residents/records', {
          method: 'POST',
          token,
          body: residentData,
        });
      }
    }

    // 4b. Register children in residents collection so they appear in general census
    const registeredChildren = [];
    if (childrenList.length > 0) {
      for (const child of childrenList) {
        const rawChildName = String(child.fullName || `${child.firstName || ''} ${child.lastName || ''}`).trim();
        if (!rawChildName && !child.firstName && !child.lastName) continue;

        let childFirst = String(child.firstName || '').trim();
        let childLast = String(child.lastName || '').trim();
        if (!childFirst && !childLast && rawChildName) {
          const parts = rawChildName.split(/\s+/);
          childFirst = parts[0] || '';
          childLast = parts.slice(1).join(' ') || parts[0] || '';
        }

        const childHasNoId = Boolean(child.hasNoId);
        const childRawId = childHasNoId ? '' : String(child.idNumber || '').replace(/\D/g, '');
        const childNat = String(child.nationality || 'V').toUpperCase().includes('E') ? 'E' : 'V';
        const childIdFormatted = childRawId ? `${childNat}-${childRawId}` : '';

        const childSex = String(child.sex || 'M').toUpperCase().startsWith('F') ? 'F' : 'M';
        const childRelationship = child.relationship || (childSex === 'F' ? 'Hija' : 'Hijo');

        let childBirthDate = child.birthDate || null;
        const childAge = parseInt(child.age, 10);
        if (!childBirthDate && !Number.isNaN(childAge) && childAge >= 0) {
          const birthYear = new Date().getFullYear() - childAge;
          childBirthDate = `${birthYear}-01-01`;
        }

        const childRecordData = {
          community: community.id,
          household: household.id,
          firstName: childFirst || 'Menor',
          lastName: childLast || residentData.lastName || 'Carga Familiar',
          idNumber: childIdFormatted,
          idNumberNormalized: childRawId,
          nationality: childNat,
          birthDate: childBirthDate,
          sex: childSex,
          relationship: childRelationship,
          phone: phone || null,
          gasProvider: residentData.gasProvider || 'Gas Caracas',
          dwellingAddress,
          houseNumber,
          houseSuffix,
          zoneCode,
          status: 'active',
          source: 'auto_registro_hijo',
          createdBy: auth?.user?.id || null,
          conditionAffection: child.conditionAffection || 'ninguna',
          chronicDiseases: String(child.chronicDiseases || '').trim(),
          communityTrade: String(child.schoolLevel || child.communityTrade || '').trim(),
          sourceValues: {
            parentResidentId: resident?.id || null,
            parentName: `${firstName} ${lastName}`,
            parentIdNumber: idFormatted,
            hasNoId: childHasNoId,
            inputAge: child.age || null,
            schoolLevel: child.schoolLevel || null,
            conditionAffection: child.conditionAffection || 'ninguna',
            chronicDiseases: child.chronicDiseases || '',
            votingCenterName: child.votingCenterName || '',
            registeredAt: new Date().toISOString(),
          },
        };

        try {
          let existingChild = null;
          if (childRawId) {
            const found = await pbRequest(
              `/api/collections/residents/records?perPage=1&filter=${encode(`community = "${community.id}" && (idNumberNormalized = "${childRawId}" || idNumber = "${childIdFormatted}")`)}`,
              { token }
            );
            existingChild = found.items?.[0] || null;
          } else {
            const nameFilter = encode(
              `community = "${community.id}" && household = "${household.id}" && firstName = "${childFirst.replace(/"/g, '\\"')}" && lastName = "${childLast.replace(/"/g, '\\"')}"`
            );
            const found = await pbRequest(
              `/api/collections/residents/records?perPage=1&filter=${nameFilter}`,
              { token }
            );
            existingChild = found.items?.[0] || null;
          }

          let savedChild = null;
          if (existingChild) {
            savedChild = await pbRequest(`/api/collections/residents/records/${existingChild.id}`, {
              method: 'PATCH',
              token,
              body: childRecordData,
            });
          } else {
            savedChild = await pbRequest('/api/collections/residents/records', {
              method: 'POST',
              token,
              body: childRecordData,
            });
          }
          if (savedChild) {
            registeredChildren.push(savedChild);
            if (child.votingCenterName) {
              try {
                const existingChildProfile = await pbRequest(
                  `/api/collections/electoral_profiles/records?perPage=1&filter=${encode(`community = "${community.id}" && resident = "${savedChild.id}"`)}`,
                  { token }
                );
                const nowIso = new Date().toISOString();
                const childElectoralPayload = {
                  community: community.id,
                  resident: savedChild.id,
                  status: 'registered',
                  votingCenterName: String(child.votingCenterName).trim(),
                  source: 'auto_registro_hijo',
                  checkedAt: nowIso,
                  consentAt: nowIso,
                  checkedBy: auth?.user?.id || savedChild.id,
                };
                if (existingChildProfile.items?.length) {
                  await pbRequest(`/api/collections/electoral_profiles/records/${existingChildProfile.items[0].id}`, {
                    method: 'PATCH',
                    token,
                    body: childElectoralPayload,
                  });
                } else {
                  await pbRequest('/api/collections/electoral_profiles/records', {
                    method: 'POST',
                    token,
                    body: childElectoralPayload,
                  });
                }
              } catch (childElectoralErr) {
                console.warn('Advertencia guardando electoral_profile de hijo:', childElectoralErr);
              }
            }
          }
        } catch (childErr) {
          console.warn('Advertencia registrando hijo en censo:', childErr);
        }
      }
    }

    // 4c. Register or update spouse in residents collection
    let registeredSpouse = null;
    const hasSpouse = Boolean(social.hasSpouse === true || social.hasSpouse === 'si' || social.spouse);
    const spouseInput = social.spouse || (hasSpouse ? social : null);

    if (hasSpouse && spouseInput) {
      const spouseRawId = String(spouseInput.idNumber || spouseInput.spouseIdNumber || '').replace(/\D/g, '');
      const spouseFirst = String(spouseInput.firstName || spouseInput.spouseFirstName || '').trim();
      const spouseLast = String(spouseInput.lastName || spouseInput.spouseLastName || '').trim();
      const spousePhone = String(spouseInput.phone || spouseInput.spousePhone || '').trim().replace(/[^0-9+]/g, '');
      const spouseNat = String(spouseInput.nationality || spouseInput.spouseNationality || 'V').toUpperCase().includes('E') ? 'E' : 'V';
      const spouseIdFormatted = spouseRawId ? `${spouseNat}-${spouseRawId}` : '';
      const spouseSex = String(spouseInput.sex || spouseInput.spouseSex || (residentData.sex === 'M' ? 'F' : 'M')).toUpperCase().startsWith('F') ? 'F' : 'M';
      const spouseBirthDate = spouseInput.birthDate || spouseInput.spouseBirthDate || null;

      if (spouseRawId || spouseFirst || spouseLast) {
        const spouseRecordData = {
          community: community.id,
          household: household.id,
          firstName: spouseFirst || 'Cónyuge',
          lastName: spouseLast || residentData.lastName || '',
          idNumber: spouseIdFormatted,
          idNumberNormalized: spouseRawId,
          nationality: spouseNat,
          birthDate: spouseBirthDate,
          sex: spouseSex,
          relationship: 'Cónyuge',
          phone: spousePhone || null,
          gasProvider: residentData.gasProvider || 'Gas Caracas',
          dwellingAddress,
          houseNumber,
          houseSuffix,
          zoneCode,
          status: 'active',
          source: 'auto_registro_conyuge',
          createdBy: auth?.user?.id || null,
          conditionAffection: spouseInput.conditionAffection || 'ninguna',
          chronicDiseases: String(spouseInput.chronicDiseases || '').trim(),
          communityTrade: String(spouseInput.communityTrade || '').trim(),
          rifNumber: spouseInput.rifNumber ? String(spouseInput.rifNumber).trim().toUpperCase() : null,
          sourceValues: {
            spouseOfResidentId: resident?.id || null,
            spouseOfName: `${firstName} ${lastName}`,
            spouseOfIdNumber: idFormatted,
            rifNumber: spouseInput.rifNumber || null,
            conditionAffection: spouseInput.conditionAffection || 'ninguna',
            chronicDiseases: spouseInput.chronicDiseases || '',
            communityTrade: spouseInput.communityTrade || '',
            votingCenterName: spouseInput.votingCenterName || '',
            registeredAt: new Date().toISOString(),
          },
        };

        try {
          let existingSpouse = null;
          if (spouseRawId) {
            const found = await pbRequest(
              `/api/collections/residents/records?perPage=1&filter=${encode(`community = "${community.id}" && (idNumberNormalized = "${spouseRawId}" || idNumber = "${spouseIdFormatted}")`)}`,
              { token }
            );
            existingSpouse = found.items?.[0] || null;
          } else {
            const nameFilter = encode(
              `community = "${community.id}" && household = "${household.id}" && firstName = "${spouseFirst.replace(/"/g, '\\"')}" && lastName = "${spouseLast.replace(/"/g, '\\"')}"`
            );
            const found = await pbRequest(
              `/api/collections/residents/records?perPage=1&filter=${nameFilter}`,
              { token }
            );
            existingSpouse = found.items?.[0] || null;
          }

          if (existingSpouse) {
            registeredSpouse = await pbRequest(`/api/collections/residents/records/${existingSpouse.id}`, {
              method: 'PATCH',
              token,
              body: spouseRecordData,
            });
          } else {
            registeredSpouse = await pbRequest('/api/collections/residents/records', {
              method: 'POST',
              token,
              body: spouseRecordData,
            });
          }

          if (registeredSpouse && spouseInput.votingCenterName) {
            try {
              const existingSpouseProfile = await pbRequest(
                `/api/collections/electoral_profiles/records?perPage=1&filter=${encode(`community = "${community.id}" && resident = "${registeredSpouse.id}"`)}`,
                { token }
              );
              const nowIso = new Date().toISOString();
              const spouseElectoralPayload = {
                community: community.id,
                resident: registeredSpouse.id,
                status: 'registered',
                votingCenterName: String(spouseInput.votingCenterName).trim(),
                source: 'auto_registro_conyuge',
                checkedAt: nowIso,
                consentAt: nowIso,
                checkedBy: auth?.user?.id || registeredSpouse.id,
              };
              if (existingSpouseProfile.items?.length) {
                await pbRequest(`/api/collections/electoral_profiles/records/${existingSpouseProfile.items[0].id}`, {
                  method: 'PATCH',
                  token,
                  body: spouseElectoralPayload,
                });
              } else {
                await pbRequest('/api/collections/electoral_profiles/records', {
                  method: 'POST',
                  token,
                  body: spouseElectoralPayload,
                });
              }
            } catch (spouseElectoralErr) {
              console.warn('Advertencia guardando electoral_profile de cónyuge:', spouseElectoralErr);
            }
          }
        } catch (spouseErr) {
          console.warn('Advertencia registrando cónyuge en censo:', spouseErr);
        }
      }
    }

    // 5. Activate User Community Membership if authenticated or matched by email
    let membership = null;
    let targetUserId = auth?.user?.id;
    if (!targetUserId && (input.email || residentData.email)) {
      const emailToLookup = String(input.email || residentData.email).trim().toLowerCase();
      try {
        const uSearch = await pbRequest(`/api/collections/users/records?perPage=1&filter=${encode(`email = "${emailToLookup}"`)}`, { token });
        if (uSearch.items?.length) {
          targetUserId = uSearch.items[0].id;
        }
      } catch (_) {}
    }

    if (targetUserId) {
      const memSearch = await pbRequest(`/api/collections/community_memberships/records?perPage=1&filter=${encode(`community = "${community.id}" && user = "${targetUserId}"`)}`, { token });
      const targetEmail = String(auth?.user?.email || input.email || residentData.email || '').trim().toLowerCase();
      const isAdminEmail = ['jesus.oquendo@gmail.com', 'rosa.acosta05@gmail.com', 'cesaroquendo10@gmail.com', 'kilby12lite@gmail.com'].includes(targetEmail) || targetEmail.endsWith('@uroprofin.invalid') || targetEmail.endsWith('@maotsetung.invalid');

      if (memSearch.items?.length) {
        membership = await pbRequest(`/api/collections/community_memberships/records/${memSearch.items[0].id}`, {
          method: 'PATCH',
          token,
          body: {
            household: household.id,
            resident: resident.id,
            status: 'active',
            notes: 'Registro fiduciario completado con validación de Cédula y RIF.',
            ...(isAdminEmail ? { role: 'admin' } : {}),
          },
        });
      } else {
        membership = await pbRequest('/api/collections/community_memberships/records', {
          method: 'POST',
          token,
          body: {
            community: community.id,
            user: targetUserId,
            household: household.id,
            resident: resident.id,
            role: isAdminEmail ? 'admin' : 'regular',
            status: 'active',
            notes: 'Registro fiduciario completado con validación de Cédula y RIF.',
          },
        });
      }
    }

    // 6. Register or update electoral profile for resident
    let electoralProfile = null;
    const cneStatus = social.cneStatus === 'not_registered' ? 'not_registered' : 'registered';
    const votingCenterName = String(social.votingCenterName || '').trim();
    if (votingCenterName || social.cneStatus) {
      try {
        const profileFilter = encode(`community = "${community.id}" && resident = "${resident.id}"`);
        const existingProfile = await pbRequest(
          `/api/collections/electoral_profiles/records?perPage=1&filter=${profileFilter}`,
          { token }
        );
        let checkedBy = targetUserId || auth?.user?.id || resident.createdBy;
        if (!checkedBy) {
          try {
            const adminUser = await pbRequest('/api/collections/users/records?perPage=1', { token });
            checkedBy = adminUser.items?.[0]?.id || null;
          } catch (_) {}
        }
        const nowIso = new Date().toISOString();
        const electoralPayload = {
          community: community.id,
          resident: resident.id,
          status: cneStatus,
          votingCenterName: cneStatus === 'registered' ? votingCenterName : '',
          source: 'auto_registro_vecino',
          checkedAt: nowIso,
          consentAt: nowIso,
          checkedBy: checkedBy || community.id,
        };
        if (existingProfile.items?.length) {
          electoralProfile = await pbRequest(
            `/api/collections/electoral_profiles/records/${existingProfile.items[0].id}`,
            { method: 'PATCH', token, body: electoralPayload }
          );
        } else {
          electoralProfile = await pbRequest('/api/collections/electoral_profiles/records', {
            method: 'POST',
            token,
            body: electoralPayload,
          });
        }
      } catch (electoralErr) {
        console.warn('Advertencia guardando perfil electoral en registro:', electoralErr);
      }
    }

    return json(res, 200, {
      success: true,
      resident,
      spouse: registeredSpouse,
      electoralProfile,
      children: registeredChildren,
      household,
      membership,
    });
  } catch (error) {
    console.error('Registration error:', error, error.data);
    const rawMsg = error.data?.message || error.message || '';
    const cleanMsg = (rawMsg.includes('fetch failed') || rawMsg.includes('Failed to fetch'))
      ? 'Error temporal de conexión con el servidor comunal. Por favor intenta de nuevo.'
      : rawMsg;
    const validationDetails = error.data?.data
      ? Object.entries(error.data.data)
          .map(([k, v]) => `${k}: ${v?.message || JSON.stringify(v)}`)
          .join('; ')
      : '';
    const message = validationDetails
      ? `${error.data?.message || 'Error de validación'}: ${validationDetails}`
      : (cleanMsg || 'Error completando el registro comunal.');
    return json(res, error.status || 500, { error: message });
  }
}
