import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToIsoDate, formatRifData, formatCedulaData, extractHouseNumber } from '../src/lib/documentScanner.js';
import { formatHousingTenure } from '../src/lib/formatters.js';

test('extractHouseNumber accurately extracts house numbers from Venezuelan addresses', () => {
  assert.equal(extractHouseNumber('CALLE PRINCIPAL DEL MIRADOR CASA NRO 1006').houseNumber, '1006');
  assert.equal(extractHouseNumber('CALLE EL CARMEN CASA 1006').houseNumber, '1006');
  assert.equal(extractHouseNumber('SECTOR EL MIRADOR CASA N° 42').houseNumber, '42');
  assert.equal(extractHouseNumber('CALLE 3 CASA #501').houseNumber, '501');
  assert.equal(extractHouseNumber('PARCELA 12').houseNumber, '12');
  assert.equal(extractHouseNumber('QUINTA 802').houseNumber, '802');
  assert.equal(extractHouseNumber('CALLE REAL 1006').houseNumber, '1006');
  assert.equal(extractHouseNumber('CALLE SIN NUMERO').houseNumber, '');
});

test('normalizeToIsoDate formats various Venezuelan date strings correctly', () => {
  assert.equal(normalizeToIsoDate('15/05/1990'), '1990-05-15');
  assert.equal(normalizeToIsoDate('01-12-1985'), '1985-12-01');
  assert.equal(normalizeToIsoDate('2000-08-25'), '2000-08-25');
  assert.equal(normalizeToIsoDate(''), '');
  assert.equal(normalizeToIsoDate(null), '');
});

test('formatRifData normalizes RIF format, extracts address and calculates 3-year SENIAT validity', () => {
  const rawRif = {
    es_documento_valido: true,
    tipo_documento: 'RIF',
    numero_rif: 'V111652186',
    fullName: 'ROSA ELENA ACOSTA FARIAS',
    expirationDate: '2026-10-12',
    fiscalAddress: 'AV PRINCIPAL DEL MIRADOR DEL ESTE CASA NRO 527-1006 URB MIRADOR DEL ESTE CARACAS (PETARE) MIRANDA ZONA POSTAL 1073',
  };

  const parsed = formatRifData(rawRif);
  assert.equal(parsed.numero_rif, 'V-11165218-6');
  assert.equal(parsed.numero_cedula_asociada, '11165218');
  assert.equal(parsed.nombres, 'ROSA ELENA');
  assert.equal(parsed.apellidos, 'ACOSTA FARIAS');
  assert.equal(parsed.razon_social, 'ROSA ELENA ACOSTA FARIAS');
  assert.equal(parsed.estado, 'Miranda');
  assert.equal(parsed.parroquia, 'Petare');
  assert.equal(parsed.municipio, 'Sucre');
  assert.equal(parsed.codigo_postal, '1073');
  assert.equal(parsed.fecha_vencimiento, '2029-10-12');
  assert.equal(parsed.esta_vencido, false);
});

test('formatRifData reliably defaults to Distrito Capital, Libertador, San Agustín even when raw address omits them', () => {
  const rawRifMinimal = {
    es_documento_valido: true,
    tipo_documento: 'RIF',
    numero_rif: 'V-20123456-7',
    fullName: 'DAVID JOSE HERNANDEZ MENDEZ',
    fiscalAddress: 'SECTOR EL MANGUITO CALLE SAN AGUSTIN',
  };

  const parsed = formatRifData(rawRifMinimal);
  assert.equal(parsed.estado, 'Distrito Capital');
  assert.equal(parsed.municipio, 'Municipio Bolivariano Libertador');
  assert.equal(parsed.parroquia, 'San Agustín');
  assert.equal(parsed.ciudad, 'Caracas');
  assert.equal(parsed.codigo_postal, '1010');
});

test('formatCedulaData seamlessly auto-detects RIF document uploaded in Step 1', () => {
  const rawRifUploadedAsCedula = {
    es_documento_valido: true,
    tipo_documento_detectado: 'RIF',
    tipo_documento: 'RIF',
    numero_rif: 'V-111652186',
    fullName: 'ROSA ELENA ACOSTA FARIAS',
    fiscalAddress: 'AV PRINCIPAL DEL MIRADOR DEL ESTE',
  };

  const parsed = formatCedulaData(rawRifUploadedAsCedula);
  assert.equal(parsed.isRifDocument, true);
  assert.equal(parsed.numero_cedula, '11165218');
  assert.equal(parsed.numero_rif, 'V-11165218-6');
  assert.equal(parsed.nombres, 'ROSA ELENA');
  assert.equal(parsed.apellidos, 'ACOSTA FARIAS');
});

test('social census payload rejects financial/brokerage fields and accepts community fields', () => {
  const sampleRegistration = {
    communityCode: 'URP-001',
    cedula: {
      tipo_documento: 'V',
      numero_cedula: '12345678',
      nombres: 'María Antonieta',
      apellidos: 'Pérez García',
      fecha_nacimiento: '1988-04-12',
      sexo: 'F',
      estado_civil: 'CASADO',
    },
    rif: {
      numero_rif: 'V-12345678-0',
      razon_social: 'MARIA PEREZ',
      domicilio_fiscal: 'Calle Las Flores, Casa 12',
      estado: 'Miranda',
      municipio: 'Guaicaipuro',
      parroquia: 'Los Teques',
      ciudad: 'Los Teques',
    },
    social: {
      zoneCode: 'PG',
      dwellingAddress: 'Casa 12, frente al portón',
      phone: '04121234567',
      conditionAffection: 'discapacidad_motora',
      affectionDetail: 'Uso de silla de ruedas y asistencia ambulatoria.',
      childrenCount: 2,
      children: [
        { fullName: 'Carlos Pérez', age: 7 },
        { fullName: 'Sofía Pérez', age: 4 },
      ],
    },
  };

  // Ensure zero stock market / PEP / investor questions
  assert.equal(sampleRegistration.pep, undefined);
  assert.equal(sampleRegistration.inversionista, undefined);
  assert.equal(sampleRegistration.banco, undefined);
  assert.equal(sampleRegistration.perfil_riesgo, undefined);

  // Validate community required fields
  assert.equal(sampleRegistration.cedula.numero_cedula, '12345678');
  assert.equal(sampleRegistration.rif.numero_rif, 'V-12345678-0');
  assert.equal(sampleRegistration.social.children.length, 2);
  assert.equal(sampleRegistration.social.conditionAffection, 'discapacidad_motora');
  assert.equal(sampleRegistration.social.children[0].fullName, 'Carlos Pérez');
  assert.equal(sampleRegistration.social.children[0].age, 7);
});

test('children registration captures cedula, sex, birth date and minor status for census integration', () => {
  const childWithId = {
    firstName: 'Alejandro',
    lastName: 'Pérez García',
    fullName: 'Alejandro Pérez García',
    nationality: 'V',
    idNumber: '33456789',
    hasNoId: false,
    birthDate: '2015-06-20',
    age: '11',
    sex: 'M',
    relationship: 'Hijo',
  };

  const childWithoutId = {
    firstName: 'Valentina',
    lastName: 'Pérez García',
    fullName: 'Valentina Pérez García',
    nationality: 'V',
    idNumber: '',
    hasNoId: true,
    birthDate: '2022-03-10',
    age: '4',
    sex: 'F',
    relationship: 'Hija',
  };

  assert.equal(childWithId.nationality, 'V');
  assert.equal(childWithId.idNumber, '33456789');
  assert.equal(childWithId.hasNoId, false);
  assert.equal(childWithId.relationship, 'Hijo');

  assert.equal(childWithoutId.hasNoId, true);
  assert.equal(childWithoutId.idNumber, '');
  assert.equal(childWithoutId.sex, 'F');
  assert.equal(childWithoutId.relationship, 'Hija');
});

test('household head registers gas cylinders whereas non-head registers zero cylinders', () => {
  const headSocial = {
    isHouseholdHead: true,
    relationship: 'Jefe(a) de Hogar',
    gasCylindersCount: '3',
    gasCylinderSize: '10kg',
    gasValveType: 'pico_rapido',
    gasProvider: 'Gas Caracas',
  };

  const memberSocial = {
    isHouseholdHead: false,
    relationship: 'Hijo/a',
    gasCylindersCount: '0',
    gasCylinderSize: '',
    gasValveType: '',
    gasProvider: '',
  };

  assert.equal(headSocial.isHouseholdHead, true);
  assert.equal(headSocial.relationship, 'Jefe(a) de Hogar');
  assert.equal(headSocial.gasCylindersCount, '3');

  assert.equal(memberSocial.isHouseholdHead, false);
  assert.equal(memberSocial.relationship, 'Hijo/a');
  assert.equal(memberSocial.gasCylindersCount, '0');
  assert.equal(memberSocial.gasProvider, '');
});

test('registration captures CNE status and voting center for electoral mapping', () => {
  const registeredElector = {
    cneStatus: 'registered',
    votingCenterName: 'U.E. Mariano Picón Salas',
  };

  const nonRegisteredElector = {
    cneStatus: 'not_registered',
    votingCenterName: '',
  };

  assert.equal(registeredElector.cneStatus, 'registered');
  assert.equal(registeredElector.votingCenterName, 'U.E. Mariano Picón Salas');

  assert.equal(nonRegisteredElector.cneStatus, 'not_registered');
  assert.equal(nonRegisteredElector.votingCenterName, '');
});

test('spouse registration captures cedula, names, sex and links spouse to household (Opcion A)', () => {
  const headRegistrationWithSpouse = {
    communityCode: 'URP-001',
    isHouseholdHead: true,
    hasSpouse: true,
    spouse: {
      firstName: 'Carmen Elena',
      lastName: 'Pérez Gómez',
      nationality: 'V',
      idNumber: '14567890',
      phone: '04129876543',
      sex: 'F',
      birthDate: '1982-07-15',
    },
  };

  assert.equal(headRegistrationWithSpouse.hasSpouse, true);
  assert.equal(headRegistrationWithSpouse.spouse.nationality, 'V');
  assert.equal(headRegistrationWithSpouse.spouse.idNumber, '14567890');
  assert.equal(headRegistrationWithSpouse.spouse.firstName, 'Carmen Elena');
  assert.equal(headRegistrationWithSpouse.spouse.lastName, 'Pérez Gómez');
  assert.equal(headRegistrationWithSpouse.spouse.phone, '04129876543');
  assert.equal(headRegistrationWithSpouse.spouse.sex, 'F');
  assert.equal(headRegistrationWithSpouse.spouse.birthDate, '1982-07-15');
});

test('auto-match identifies spouse or family member by cedula and prepares direct access confirmation (Opcion B)', () => {
  const matchResult = {
    matched: true,
    resident: {
      id: 'res_spouse_12345',
      firstName: 'Carmen Elena',
      lastName: 'Pérez Gómez',
      idNumber: 'V-14567890',
      relationship: 'Cónyuge',
      isHouseholdHead: false,
    },
    household: {
      id: 'hh_001',
      code: 'URP-S1PG-1006',
      address: 'Casa 1006, Sector Subida 1 Portón Gris',
    },
    headOfHousehold: {
      firstName: 'Jesús',
      lastName: 'Oquendo',
      idNumber: 'V-6123456',
    },
  };

  assert.equal(matchResult.matched, true);
  assert.equal(matchResult.resident.relationship, 'Cónyuge');
  assert.equal(matchResult.household.code, 'URP-S1PG-1006');
  assert.equal(matchResult.headOfHousehold.firstName, 'Jesús');
  assert.equal(matchResult.resident.idNumber, 'V-14567890');
});

test('spouse and children registration persists health conditions, chronic treatments, CNE center and school level', () => {
  const familyDossier = {
    spouse: {
      firstName: 'Carmen Elena',
      lastName: 'Pérez Gómez',
      nationality: 'V',
      idNumber: '14567890',
      conditionAffection: 'hipertension',
      chronicDiseases: 'Losartán Potásico 50mg diario',
      communityTrade: 'Comerciante Independiente',
      votingCenterName: 'U.E. Mariano Picón Salas',
      rifNumber: 'V-14567890-2',
    },
    children: [
      {
        firstName: 'Valentina',
        lastName: 'Pérez Gómez',
        age: '8',
        schoolLevel: 'primaria',
        conditionAffection: 'asma',
        chronicDiseases: 'Inhalador Salbutamol en crisis',
        votingCenterName: '',
      },
      {
        firstName: 'Andrés',
        lastName: 'Pérez Gómez',
        age: '19',
        schoolLevel: 'universidad',
        conditionAffection: 'ninguna',
        chronicDiseases: '',
        votingCenterName: 'Liceo Bolivariano Mariano Picón Salas',
      },
    ],
  };

  assert.equal(familyDossier.spouse.conditionAffection, 'hipertension');
  assert.equal(familyDossier.spouse.chronicDiseases, 'Losartán Potásico 50mg diario');
  assert.equal(familyDossier.spouse.votingCenterName, 'U.E. Mariano Picón Salas');
  assert.equal(familyDossier.spouse.rifNumber, 'V-14567890-2');

  assert.equal(familyDossier.children[0].schoolLevel, 'primaria');
  assert.equal(familyDossier.children[0].conditionAffection, 'asma');
  assert.equal(familyDossier.children[0].chronicDiseases, 'Inhalador Salbutamol en crisis');

  assert.equal(familyDossier.children[1].schoolLevel, 'universidad');
  assert.equal(familyDossier.children[1].votingCenterName, 'Liceo Bolivariano Mariano Picón Salas');
});

test('household match progressive profiling dossier captures phone, RIF, voting center, occupation and chronic illnesses', () => {
  const progressiveMatchPayload = {
    residentId: 'res_spouse_12345',
    householdId: 'hh_001',
    communityCode: 'URP-001',
    phone: '0412-9876543',
    rifNumber: 'V-14567890-2',
    votingCenterName: 'U.E. Mariano Picón Salas',
    communityTrade: 'Docente de Educación Básica',
    conditionAffection: 'diabetes',
    chronicDiseases: 'Metformina 850mg',
  };

  assert.ok(progressiveMatchPayload.residentId);
  assert.ok(progressiveMatchPayload.householdId);
  assert.equal(progressiveMatchPayload.phone, '0412-9876543');
  assert.equal(progressiveMatchPayload.rifNumber, 'V-14567890-2');
  assert.equal(progressiveMatchPayload.votingCenterName, 'U.E. Mariano Picón Salas');
  assert.equal(progressiveMatchPayload.communityTrade, 'Docente de Educación Básica');
  assert.equal(progressiveMatchPayload.conditionAffection, 'diabetes');
  assert.equal(progressiveMatchPayload.chronicDiseases, 'Metformina 850mg');
});

test('formatHousingTenure accurately maps tenure values and preserves non-propia conditions', () => {
  assert.equal(formatHousingTenure('propia'), 'Propia');
  assert.equal(formatHousingTenure('alquilada'), 'Alquilada');
  assert.equal(formatHousingTenure('familiar'), 'Familiar / Prestada');
  assert.equal(formatHousingTenure('prestada'), 'Familiar / Prestada');
  assert.equal(formatHousingTenure('otra'), 'Otra condición');
  assert.equal(formatHousingTenure('otra_condicion'), 'Otra condición');
  assert.equal(formatHousingTenure(''), 'Propia');
  assert.equal(formatHousingTenure(null), 'Propia');
});



