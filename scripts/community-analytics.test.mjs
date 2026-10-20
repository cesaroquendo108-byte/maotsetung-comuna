import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAge,
  calculateMedian,
  computeCommunityKPIs,
  buildAgePyramidData,
  buildGasDistributionData,
  buildHealthVulnerabilityData,
  buildCneStatusData,
  buildZoneDistributionData,
  buildWaterStorageData,
  calculateFinvePotentialScore,
  buildFinvePotentialData,
  exportFinveProspectsCSV,
  exportCommunityBiCSV,
} from '../src/lib/communityAnalytics.js';

test('calculateAge computes exact age and handles invalid values', () => {
  const currentYear = new Date().getFullYear();
  assert.equal(calculateAge(`${currentYear - 25}-01-01`), 25);
  assert.equal(calculateAge(null), null);
  assert.equal(calculateAge('invalid-date'), null);
});

test('calculateMedian computes exact median for odd and even arrays', () => {
  assert.equal(calculateMedian([10, 20, 30]), 20);
  assert.equal(calculateMedian([10, 20, 30, 40]), 25);
  assert.equal(calculateMedian([]), 0);
});

test('computeCommunityKPIs accurately aggregates totals, age cohorts and ratios', () => {
  const sampleResidents = [
    { firstName: 'Pedro', lastName: 'Pérez', sex: 'M', birthDate: '1980-05-10', gasProvider: 'Gas Caracas', status: 'active' },
    { firstName: 'Ana', lastName: 'Gómez', sex: 'F', birthDate: '2015-08-20', gasProvider: 'Gas Caracas', status: 'active' },
    { firstName: 'Rosa', lastName: 'Pérez', sex: 'F', birthDate: '1955-02-14', gasProvider: 'Comunal', status: 'active', conditionAffection: 'motora' },
  ];
  const sampleHouseholds = [{ id: 'h1', code: 'URP-PG-1' }];
  const sampleDwellings = [{ id: 'd1', code: 'URP-PG-1' }];

  const kpis = computeCommunityKPIs(sampleResidents, sampleHouseholds, sampleDwellings);
  assert.equal(kpis.totalResidents, 3);
  assert.equal(kpis.totalHouseholds, 1);
  assert.equal(kpis.totalDwellings, 1);
  assert.equal(kpis.childrenCount, 1);
  assert.equal(kpis.elderlyCount, 1);
  assert.equal(kpis.femaleRatio, 67);
  assert.equal(kpis.maleRatio, 33);
  assert.equal(kpis.healthCasesCount, 1);
});

test('buildAgePyramidData categorizes male and female counts into age brackets', () => {
  const currentYear = new Date().getFullYear();
  const sampleResidents = [
    { birthDate: `${currentYear - 4}-01-01`, sex: 'M' },
    { birthDate: `${currentYear - 12}-01-01`, sex: 'F' },
    { birthDate: `${currentYear - 25}-01-01`, sex: 'M' },
    { birthDate: `${currentYear - 72}-01-01`, sex: 'F' },
  ];
  const pyramid = buildAgePyramidData(sampleResidents);
  assert.ok(pyramid.categories.includes('0-4'));
  assert.ok(pyramid.categories.includes('10-14'));
  assert.ok(pyramid.categories.includes('20-29'));
  assert.ok(pyramid.categories.includes('70+'));
  assert.equal(pyramid.maleData[pyramid.categories.indexOf('0-4')], 1);
  assert.equal(pyramid.femaleData[pyramid.categories.indexOf('70+')], 1);
});

test('buildGasDistributionData tallies providers, cylinders and valves', () => {
  const sampleResidents = [
    { gasProvider: 'Gas Caracas', gasCylindersCount: '2', gasValveType: 'pico_rapido' },
    { gasProvider: 'Gas Caracas', gasCylindersCount: '1', gasValveType: 'rosca' },
    { gasProvider: 'Comunal', gasCylindersCount: '1', gasValveType: 'pico_rapido' },
  ];
  const gas = buildGasDistributionData(sampleResidents);
  assert.equal(gas.providers['Gas Caracas'], 2);
  assert.equal(gas.providers['Comunal'], 1);
  assert.equal(gas.valves['Pico Rápido'], 2);
  assert.equal(gas.valves['Rosca'], 1);
});

test('buildGasDistributionData deduplicates cylinders for multiple family members in the same house', () => {
  const familyInSameHouse = [
    { household: 'house-1006', isHouseholdHead: true, relationship: 'Jefe(a) de Hogar', gasProvider: 'Gas Caracas', gasCylindersCount: '3', gasValveType: 'pico_rapido' },
    { household: 'house-1006', isHouseholdHead: false, relationship: 'Cónyuge', gasProvider: 'Gas Caracas', gasCylindersCount: '3', gasValveType: 'pico_rapido' },
    { household: 'house-1006', isHouseholdHead: false, relationship: 'Hijo', gasProvider: 'Gas Caracas', gasCylindersCount: '3', gasValveType: 'pico_rapido' },
    { household: 'house-1006', isHouseholdHead: false, relationship: 'Hija', gasProvider: 'Gas Caracas', gasCylindersCount: '0', gasValveType: 'pico_rapido' },
  ];
  const gas = buildGasDistributionData(familyInSameHouse);
  // There is only 1 household with 3 cylinders, NOT 9 or 12
  assert.equal(gas.cylinders['3 o más'], 1);
  assert.equal(gas.cylinders['1 cilindro'], 0);
  assert.equal(gas.cylinders['2 cilindros'], 0);
  assert.equal(gas.providers['Gas Caracas'], 1);
});

test('buildCneStatusData separates voters, unverified and minors', () => {
  const sampleResidents = [
    { birthDate: '1985-01-01', electoralProfile: { status: 'registered', votingCenterName: 'Escuela Petare' } },
    { birthDate: '1990-01-01', electoralProfile: { status: 'not_registered' } },
    { birthDate: '2020-01-01', electoralProfile: null },
  ];
  const cne = buildCneStatusData(sampleResidents);
  assert.equal(cne.voters['Inscrito'], 1);
  assert.equal(cne.voters['No inscrito'], 1);
  assert.equal(cne.voters['No aplica (Menor)'], 1);
  assert.equal(cne.centers['Escuela Petare'], 1);
});

test('exportCommunityBiCSV outputs sanitized CSV without emojis', () => {
  const sampleResidents = [
    {
      firstName: 'María',
      lastName: 'Acosta',
      idNumber: 'V-15000111',
      relationship: 'Jefa de Hogar',
      zoneCode: 'PG',
      houseNumber: '10',
      birthDate: '1990-06-15',
      sex: 'F',
      phone: '04121234567',
      gasProvider: 'Gas Caracas',
      status: 'active',
    },
  ];
  const csv = exportCommunityBiCSV(sampleResidents);
  assert.ok(csv.includes('Nombre,Apellido,Cedula,Parentesco'));
  assert.ok(csv.includes('"María","Acosta","V-15000111","Jefa de Hogar"'));
  assert.equal(/[\uD800-\uDFFF]/.test(csv), false); // Zero emojis policy
  assert.ok(csv.includes('Score_Finve,Nivel_Finve'));
});

test('calculateFinvePotentialScore evaluates KYC, economic, digital and stability pillars accurately', () => {
  const highProspect = {
    firstName: 'César',
    lastName: 'Oquendo',
    idNumber: 'V-26543210',
    rifNumber: 'V-26543210-4',
    birthDate: '1998-03-15',
    communityTrade: 'Ingeniero de Software',
    phone: '04243334455',
    email: 'cesar@finve.net',
    housingTenure: 'propia',
    isHouseholdHead: true,
  };
  const evalHigh = calculateFinvePotentialScore(highProspect);
  assert.equal(evalHigh.tier, 'Alto');
  assert.equal(evalHigh.tierLabel, 'Calificado Finve');
  assert.equal(evalHigh.score, 100);
  assert.equal(evalHigh.flags.hasValidId, true);
  assert.equal(evalHigh.flags.hasRif, true);
  assert.equal(evalHigh.flags.isHighAffinity, true);
  assert.ok(evalHigh.strengths.includes('KYC Bursátil Completo'));

  const midProspect = {
    firstName: 'Daniel',
    lastName: 'Blanco',
    idNumber: 'V-22345678',
    birthDate: '1994-01-28',
    phone: '04241010101',
    housingTenure: 'alquilada',
    relationship: 'Cónyuge',
  };
  const evalMid = calculateFinvePotentialScore(midProspect);
  assert.equal(evalMid.tier, 'Medio');
  assert.equal(evalMid.tierLabel, 'Prospecto en Desarrollo');
  assert.ok(evalMid.score >= 50 && evalMid.score < 75);

  const lowMinor = {
    firstName: 'Mateo',
    lastName: 'Mendoza',
    idNumber: 'S/C',
    birthDate: '2023-08-10',
    housingTenure: 'alquilada',
    relationship: 'Hijo',
  };
  const evalLow = calculateFinvePotentialScore(lowMinor);
  assert.equal(evalLow.tier, 'Bajo');
  assert.equal(evalLow.tierLabel, 'En Maduración');
  assert.ok(evalLow.score < 50);
});

test('buildFinvePotentialData computes funnel, rankings and trade tallies', () => {
  const sample = [
    {
      id: '1',
      firstName: 'César',
      lastName: 'Oquendo',
      idNumber: 'V-26543210',
      rifNumber: 'V-26543210-4',
      birthDate: '1998-03-15',
      communityTrade: 'Ingeniero de Software',
      phone: '04243334455',
      email: 'cesar@finve.net',
      housingTenure: 'propia',
      isHouseholdHead: true,
      status: 'active',
    },
    {
      id: '2',
      firstName: 'Daniel',
      lastName: 'Blanco',
      idNumber: 'V-22345678',
      birthDate: '1994-01-28',
      phone: '04241010101',
      housingTenure: 'alquilada',
      relationship: 'Cónyuge',
      status: 'active',
    },
    {
      id: '3',
      firstName: 'Mateo',
      lastName: 'Mendoza',
      idNumber: 'S/C',
      birthDate: '2023-08-10',
      housingTenure: 'alquilada',
      relationship: 'Hijo',
      status: 'active',
    },
  ];

  const data = buildFinvePotentialData(sample);
  assert.equal(data.totalResidents, 3);
  assert.equal(data.totalAdults, 2);
  assert.equal(data.highCount, 1);
  assert.equal(data.mediumCount, 1);
  assert.equal(data.lowCount, 1);
  assert.equal(data.kycReadyCount, 1);
  assert.equal(data.prospects.length, 3);
  assert.equal(data.prospects[0].name, 'César Oquendo');
  assert.equal(data.prospects[0].tier, 'Alto');
});

test('exportFinveProspectsCSV outputs sanitized zero-emoji CSV with all financial columns', () => {
  const sample = [
    {
      id: '1',
      firstName: 'Rosa',
      lastName: 'Acosta',
      idNumber: 'V-12456789',
      rifNumber: 'V-12456789-0',
      email: 'rosa.acosta@gmail.com',
      communityTrade: 'Comerciante',
      phone: '04121112233',
      birthDate: '1968-04-12',
      housingTenure: 'propia',
      isHouseholdHead: true,
      status: 'active',
    },
  ];
  const csv = exportFinveProspectsCSV(sample);
  assert.ok(csv.includes('Nombre,Apellido,Cedula,RIF,Telefono,Email'));
  assert.ok(csv.includes('Score_Finve,Nivel_Finve,KYC_Bursatil,Fortalezas'));
  assert.ok(csv.includes('"Rosa","Acosta","V-12456789","V-12456789-0"'));
  assert.equal(/[\uD800-\uDFFF]/.test(csv), false); // Zero emojis policy
});

