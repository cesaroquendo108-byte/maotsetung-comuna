// Community BI Analytics Calculation Engine
// Institutional & Fiduciary Community Statistics for Comuna Mao Tse Tung (San Agustín, Caracas)

export function calculateAge(birthDate) {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  if (
    now.getMonth() < date.getMonth() ||
    (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())
  ) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

export function calculateMedian(numbers = []) {
  const valid = numbers.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 !== 0 ? valid[mid] : Math.round((valid[mid - 1] + valid[mid]) / 2);
}

export function computeCommunityKPIs(residents = [], households = [], dwellings = []) {
  const activeResidents = residents.filter((r) => r.status !== 'inactive' && r.status !== 'deceased');
  const total = activeResidents.length;
  const totalHouseholds = households.length;
  const totalDwellings = dwellings.length;

  let childrenCount = 0;
  let youthCount = 0;
  let adultCount = 0;
  let elderlyCount = 0;
  let femaleCount = 0;
  let maleCount = 0;
  let healthCasesCount = 0;
  let cneRegisteredCount = 0;
  const ages = [];

  activeResidents.forEach((res) => {
    const age = calculateAge(res.birthDate);
    if (age !== null) {
      ages.push(age);
      if (age < 18) childrenCount += 1;
      else if (age <= 35) youthCount += 1;
      else if (age < 60) adultCount += 1;
      else elderlyCount += 1;
    }

    const sex = String(res.sex || '').toUpperCase();
    if (sex.startsWith('F')) femaleCount += 1;
    else if (sex.startsWith('M')) maleCount += 1;

    const condition = String(res.conditionAffection || '').toLowerCase();
    const hasChronic = Boolean(res.chronicDiseases && String(res.chronicDiseases).trim());
    const isPregnant = String(res.isPregnantOrLactating || '').toLowerCase() === 'si';
    if ((condition && condition !== 'ninguna') || hasChronic || isPregnant) {
      healthCasesCount += 1;
    }

    const voter = res.electoralProfile?.status;
    if (voter === 'registered' || voter === 'Inscrito' || voter === 'Inscrita') {
      cneRegisteredCount += 1;
    }
  });

  const medianAge = calculateMedian(ages);
  const femaleRatio = total > 0 ? Math.round((femaleCount / total) * 100) : 0;
  const maleRatio = total > 0 ? Math.round((maleCount / total) * 100) : 0;
  const avgHouseholdSize = totalHouseholds > 0 ? (total / totalHouseholds).toFixed(1) : '0.0';
  const cneEligible = total - childrenCount;
  const cneRegisteredRatio = cneEligible > 0 ? Math.round((cneRegisteredCount / cneEligible) * 100) : 0;

  return {
    totalResidents: total,
    totalHouseholds,
    totalDwellings,
    avgHouseholdSize,
    medianAge,
    childrenCount,
    youthCount,
    adultCount,
    elderlyCount,
    femaleCount,
    maleCount,
    femaleRatio,
    maleRatio,
    healthCasesCount,
    cneRegisteredCount,
    cneRegisteredRatio,
  };
}

export function buildAgePyramidData(residents = []) {
  const categories = ['0-4', '5-9', '10-14', '15-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70+'];
  const maleData = Array(categories.length).fill(0);
  const femaleData = Array(categories.length).fill(0);

  residents.forEach((r) => {
    const age = calculateAge(r.birthDate);
    if (age === null) return;
    const isFemale = String(r.sex || '').toUpperCase().startsWith('F');

    let idx = 0;
    if (age <= 4) idx = 0;
    else if (age <= 9) idx = 1;
    else if (age <= 14) idx = 2;
    else if (age <= 19) idx = 3;
    else if (age <= 29) idx = 4;
    else if (age <= 39) idx = 5;
    else if (age <= 49) idx = 6;
    else if (age <= 59) idx = 7;
    else if (age <= 69) idx = 8;
    else idx = 9;

    if (isFemale) {
      femaleData[idx] += 1;
    } else {
      maleData[idx] += 1;
    }
  });

  return { categories, maleData, femaleData };
}

export function buildGasDistributionData(residents = []) {
  const providers = { 'Gas Caracas': 0, 'Gas Miranda': 0, 'Comunal': 0, 'Sin definir': 0 };
  const cylinders = { '1 cilindro': 0, '2 cilindros': 0, '3 o más': 0 };
  const valves = { 'Pico Rápido': 0, 'Rosca': 0 };
  const sizes = { '10kg': 0, '18kg': 0, '43kg': 0 };

  const processedHouseholds = new Set();

  residents.forEach((r) => {
    const isHead = r.isHouseholdHead === true || r.isHouseholdHead === 'si' || String(r.relationship || '').toLowerCase().includes('jef');
    const rawCount = r.gasCylindersCount !== undefined && r.gasCylindersCount !== null && r.gasCylindersCount !== ''
      ? parseInt(r.gasCylindersCount, 10)
      : (isHead ? 1 : 0);

    // If explicit count is 0 or if non-head has 0/unspecified cylinders, do not count
    if (rawCount <= 0) return;

    // Deduplicate by household / dwelling to avoid multiplying cylinders across family members
    const houseKey = r.household || (r.zoneCode && r.houseNumber ? `${r.zoneCode}-${r.houseNumber}` : null);
    if (houseKey) {
      if (processedHouseholds.has(houseKey)) return;
      processedHouseholds.add(houseKey);
    }

    const p = String(r.gasProvider || '').trim();
    if (p.includes('Caracas')) providers['Gas Caracas'] += 1;
    else if (p.includes('Miranda')) providers['Gas Miranda'] += 1;
    else if (p.includes('Comunal')) providers['Comunal'] += 1;
    else providers['Sin definir'] += 1;

    if (rawCount === 1) cylinders['1 cilindro'] += 1;
    else if (rawCount === 2) cylinders['2 cilindros'] += 1;
    else if (rawCount >= 3) cylinders['3 o más'] += 1;

    const valve = String(r.gasValveType || '').toLowerCase();
    if (valve.includes('rosca')) valves['Rosca'] += 1;
    else valves['Pico Rápido'] += 1;

    const size = String(r.gasCylinderSize || '10kg').toLowerCase();
    if (size.includes('18')) sizes['18kg'] += 1;
    else if (size.includes('43')) sizes['43kg'] += 1;
    else sizes['10kg'] += 1;
  });

  return { providers, cylinders, valves, sizes };
}

export function buildHealthVulnerabilityData(residents = []) {
  const affections = {};
  const chronicConditions = {};
  let pregnantCount = 0;
  let elderlyCount = 0;
  let petsTotal = 0;

  residents.forEach((r) => {
    const aff = String(r.conditionAffection || '').trim();
    if (aff && aff.toLowerCase() !== 'ninguna') {
      const clean = aff.charAt(0).toUpperCase() + aff.slice(1);
      affections[clean] = (affections[clean] || 0) + 1;
    }

    const chronic = String(r.chronicDiseases || '').trim();
    if (chronic) {
      const parts = chronic.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      parts.forEach((item) => {
        const key = item.charAt(0).toUpperCase() + item.slice(1);
        chronicConditions[key] = (chronicConditions[key] || 0) + 1;
      });
    }

    if (String(r.isPregnantOrLactating || '').toLowerCase() === 'si') {
      pregnantCount += 1;
    }

    const age = calculateAge(r.birthDate);
    if (age !== null && age >= 60) {
      elderlyCount += 1;
    }

    const pets = parseInt(r.petsCount || '0', 10);
    if (!Number.isNaN(pets) && pets > 0) {
      petsTotal += pets;
    }
  });

  return { affections, chronicConditions, pregnantCount, elderlyCount, petsTotal };
}

export function buildCneStatusData(residents = []) {
  const voters = {
    'Inscrito': 0,
    'No inscrito': 0,
    'Sin verificar': 0,
    'No aplica (Menor)': 0,
  };
  const centers = {};
  const idCards = {
    'Cédula Válida': 0,
    'Menor sin Cédula': 0,
    'Sin documento': 0,
  };

  residents.forEach((r) => {
    const age = calculateAge(r.birthDate);
    const isMinor = age !== null && age < 18;

    if (isMinor) {
      voters['No aplica (Menor)'] += 1;
    } else {
      const st = r.electoralProfile?.status;
      if (st === 'registered' || st === 'Inscrito' || st === 'Inscrita') {
        voters['Inscrito'] += 1;
        const center = r.electoralProfile?.votingCenterName || 'Centro sin especificar';
        centers[center] = (centers[center] || 0) + 1;
      } else if (st === 'not_registered' || st === 'No inscrito') {
        voters['No inscrito'] += 1;
      } else {
        voters['Sin verificar'] += 1;
      }
    }

    const idNum = String(r.idNumber || '').trim();
    if (idNum && !idNum.toLowerCase().includes('sin') && !idNum.toLowerCase().includes('s/c')) {
      idCards['Cédula Válida'] += 1;
    } else if (isMinor) {
      idCards['Menor sin Cédula'] += 1;
    } else {
      idCards['Sin documento'] += 1;
    }
  });

  return { voters, centers, idCards };
}

export function buildZoneDistributionData(residents = [], zones = []) {
  const counts = {};
  residents.forEach((r) => {
    const zCode = String(r.zoneCode || r.expand?.household?.zoneCode || 'URP').toUpperCase();
    counts[zCode] = (counts[zCode] || 0) + 1;
  });

  return counts;
}

export function buildWaterStorageData(residents = []) {
  const storage = {
    'Sin tanque': 0,
    '500L': 0,
    '1000L': 0,
    '1500L': 0,
    '2000L o más': 0,
  };

  residents.forEach((r) => {
    const val = String(r.waterTankCapacity || 'ninguno').toLowerCase();
    if (val.includes('500')) storage['500L'] += 1;
    else if (val.includes('1000')) storage['1000L'] += 1;
    else if (val.includes('1500')) storage['1500L'] += 1;
    else if (val.includes('2000')) storage['2000L o más'] += 1;
    else storage['Sin tanque'] += 1;
  });

  return storage;
}

export function calculateFinvePotentialScore(resident = {}) {
  const rawInput = resident.sourceValues?.rawInput || resident.rawRecord?.sourceValues?.rawInput || {};

  // 1. Identificación y KYC Bursátil (Máximo 30 puntos)
  let kycScore = 0;
  const idNumber = String(resident.idNumber || rawInput.idNumber || '').trim();
  const hasValidId = Boolean(idNumber && !idNumber.toLowerCase().includes('sin') && !idNumber.toLowerCase().includes('s/c') && /\d{5,9}/.test(idNumber));
  if (hasValidId) kycScore += 15;

  const rifNumber = String(resident.rifNumber || resident.sourceValues?.rifNumber || rawInput.rifNumber || '').trim();
  const hasRif = Boolean(rifNumber && /^[VJEPG]-?\d{5,9}-?\d?$/i.test(rifNumber));
  if (hasRif) kycScore += 15;

  // 2. Capacidad Económica & Rango Demográfico Productivo (Máximo 30 puntos)
  let economicScore = 0;
  const age = calculateAge(resident.birthDate);
  if (age !== null) {
    if (age >= 21 && age <= 50) {
      economicScore += 20;
    } else if ((age >= 18 && age <= 20) || (age >= 51 && age <= 65)) {
      economicScore += 12;
    } else if (age > 65) {
      economicScore += 5;
    }
  }

  const trade = String(
    resident.communityTrade || resident.trade || rawInput.communityTrade || resident.occupation || ''
  ).trim();

  const highAffinityKeywords = [
    'contab', 'admin', 'finan', 'comerc', 'negoc', 'ingeni', 'sistemas',
    'tecnol', 'abogad', 'derech', 'medic', 'salud', 'docent', 'profesor',
    'tecnic', 'emprend', 'consult', 'geren', 'ventas', 'segur', 'banco',
    'transporte', 'chofer', 'mecanic', 'arquitect'
  ];
  const isHighAffinity = highAffinityKeywords.some((k) => trade.toLowerCase().includes(k));
  if (isHighAffinity) {
    economicScore += 10;
  } else if (trade.length > 2) {
    economicScore += 6;
  }

  // 3. Conectividad Digital & Canales de Contacto (Máximo 20 puntos)
  let digitalScore = 0;
  const phone = String(resident.phone || resident.phone1 || rawInput.phone || '').replace(/[^0-9+]/g, '');
  const hasPhone = Boolean(phone.length >= 10);
  if (hasPhone) digitalScore += 10;

  const email = String(resident.email || rawInput.email || '').trim();
  const hasEmail = Boolean(email && email.includes('@') && !email.endsWith('.invalid'));
  if (hasEmail) digitalScore += 10;

  // 4. Arraigo Patrimonial & Liderazgo en el Hogar (Máximo 20 puntos)
  let stabilityScore = 0;
  const tenure = String(resident.housingTenure || rawInput.housingTenure || 'propia').toLowerCase().trim();
  if (tenure === 'propia') {
    stabilityScore += 10;
  } else if (tenure === 'alquilada') {
    stabilityScore += 7;
  } else {
    stabilityScore += 5;
  }

  const isHead = resident.isHouseholdHead === true || resident.isHouseholdHead === 'si' || String(resident.relationship || '').toLowerCase().includes('jef');
  const isIndependentAdult = String(resident.relationship || '').toLowerCase().includes('cóny') || (age !== null && age >= 21);
  if (isHead) {
    stabilityScore += 10;
  } else if (isIndependentAdult) {
    stabilityScore += 8;
  } else {
    stabilityScore += 4;
  }

  const totalScore = Math.min(100, Math.max(0, kycScore + economicScore + digitalScore + stabilityScore));

  let tier = 'Bajo';
  let tierLabel = 'En Maduración';
  let tierColor = '#94A3B8';
  if (totalScore >= 75) {
    tier = 'Alto';
    tierLabel = 'Calificado Finve';
    tierColor = '#059669';
  } else if (totalScore >= 50) {
    tier = 'Medio';
    tierLabel = 'Prospecto en Desarrollo';
    tierColor = '#D97706';
  }

  const strengths = [];
  if (hasValidId && hasRif) strengths.push('KYC Bursátil Completo');
  else if (hasValidId) strengths.push('Cédula Verificada');
  if (age !== null && age >= 21 && age <= 50) strengths.push(`PEA Activa (${age} años)`);
  if (isHighAffinity && trade) strengths.push(`Oficio: ${trade}`);
  else if (trade) strengths.push(`Actividad: ${trade}`);
  if (hasPhone && hasEmail) strengths.push('Canal Dual (Móvil + Email)');
  else if (hasPhone) strengths.push('Contacto Móvil');
  if (isHead) strengths.push('Jefe de Hogar');

  return {
    score: totalScore,
    tier,
    tierLabel,
    tierColor,
    breakdown: {
      kyc: kycScore,
      economic: economicScore,
      digital: digitalScore,
      stability: stabilityScore,
    },
    flags: {
      hasValidId,
      hasRif,
      hasPhone,
      hasEmail,
      isHighAffinity,
      age,
      trade,
    },
    strengths,
  };
}

export function buildFinvePotentialData(residents = []) {
  const activeResidents = residents.filter((r) => r.status !== 'inactive' && r.status !== 'deceased');

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  let totalAdults = 0;
  let totalScoreSum = 0;
  let kycReadyCount = 0;
  let phoneCount = 0;
  let tradeDeclaredCount = 0;

  const tradeTally = {};
  const prospectList = [];

  activeResidents.forEach((r) => {
    const age = calculateAge(r.birthDate);
    const isAdult = age === null || age >= 18;
    if (isAdult) totalAdults += 1;

    const evaluation = calculateFinvePotentialScore(r);
    totalScoreSum += evaluation.score;

    if (evaluation.tier === 'Alto') highCount += 1;
    else if (evaluation.tier === 'Medio') mediumCount += 1;
    else lowCount += 1;

    if (evaluation.flags.hasValidId && evaluation.flags.hasRif) kycReadyCount += 1;
    if (evaluation.flags.hasPhone) phoneCount += 1;
    if (evaluation.flags.trade) {
      tradeDeclaredCount += 1;
      const tKey = evaluation.flags.trade.charAt(0).toUpperCase() + evaluation.flags.trade.slice(1);
      tradeTally[tKey] = (tradeTally[tKey] || 0) + 1;
    }

    prospectList.push({
      id: r.id,
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Residente',
      idNumber: r.idNumber || 'S/C',
      phone: r.phone || '',
      email: r.email || '',
      trade: evaluation.flags.trade || 'Sin declarar',
      zoneCode: r.zoneCode || '',
      houseNumber: r.houseNumber || '',
      housingTenure: r.housingTenure || 'Propia',
      age: age !== null ? age : null,
      score: evaluation.score,
      tier: evaluation.tier,
      tierLabel: evaluation.tierLabel,
      tierColor: evaluation.tierColor,
      strengths: evaluation.strengths,
      hasRif: evaluation.flags.hasRif,
      rifNumber: r.rifNumber || '',
      breakdown: evaluation.breakdown,
    });
  });

  prospectList.sort((a, b) => b.score - a.score);

  const total = activeResidents.length;
  const avgScore = total > 0 ? (totalScoreSum / total).toFixed(1) : '0.0';
  const kycReadyRatio = totalAdults > 0 ? Math.round((kycReadyCount / totalAdults) * 100) : 0;
  const highTierRatio = totalAdults > 0 ? Math.round((highCount / totalAdults) * 100) : 0;

  return {
    totalResidents: total,
    totalAdults,
    avgScore,
    highCount,
    mediumCount,
    lowCount,
    highTierRatio,
    kycReadyCount,
    kycReadyRatio,
    phoneCount,
    tradeDeclaredCount,
    tradeTally,
    prospects: prospectList,
  };
}

export function exportFinveProspectsCSV(residents = []) {
  const headers = [
    'Nombre',
    'Apellido',
    'Cedula',
    'RIF',
    'Telefono',
    'Email',
    'Sector_Zona',
    'NumeroCasa',
    'Oficio_Profesion',
    'TenenciaVivienda',
    'Edad',
    'Score_Finve',
    'Nivel_Finve',
    'KYC_Bursatil',
    'Fortalezas',
  ];

  const { prospects } = buildFinvePotentialData(residents);

  const rows = prospects.map((p) => {
    const parts = p.name.split(' ');
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || '';
    return [
      escapeCsvValue(first),
      escapeCsvValue(last),
      escapeCsvValue(p.idNumber),
      escapeCsvValue(p.rifNumber || 'Pendiente'),
      escapeCsvValue(p.phone || ''),
      escapeCsvValue(p.email || ''),
      escapeCsvValue(p.zoneCode || ''),
      escapeCsvValue(p.houseNumber || ''),
      escapeCsvValue(p.trade),
      escapeCsvValue(p.housingTenure),
      escapeCsvValue(p.age !== null ? p.age : ''),
      escapeCsvValue(p.score),
      escapeCsvValue(p.tier),
      escapeCsvValue(p.hasRif ? 'Completo' : 'Solo Cedula'),
      escapeCsvValue(p.strengths.join(' | ')),
    ].join(',');
  });

  return `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}`;
}

function escapeCsvValue(val) {
  if (val === undefined || val === null) return '""';
  let str = String(val).trim();
  // Strip emojis to enforce strict zero emojis policy
  str = str.replace(/[\uD800-\uDFFF]./g, '');
  // Prevent CSV formula injection in spreadsheet applications
  if (/^[=+@-]$/.test(str.charAt(0))) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export function exportCommunityBiCSV(residents = []) {
  const headers = [
    'Nombre',
    'Apellido',
    'Cedula',
    'Parentesco',
    'Sexo',
    'FechaNacimiento',
    'Edad',
    'Sector_Zona',
    'NumeroCasa',
    'Telefono',
    'ProveedorGas',
    'CilindrosGas',
    'ValvulaGas',
    'TanqueAgua',
    'TenenciaVivienda',
    'AfectacionSalud',
    'EnfermedadCronica',
    'EstatusCNE',
    'CentroVotacion',
    'Score_Finve',
    'Nivel_Finve',
    'EstatusRegistro',
  ];

  const rows = residents.map((r) => {
    const age = calculateAge(r.birthDate);
    const finve = calculateFinvePotentialScore(r);
    return [
      escapeCsvValue(r.firstName || ''),
      escapeCsvValue(r.lastName || ''),
      escapeCsvValue(r.idNumber || 'S/C'),
      escapeCsvValue(r.relationship || 'Integrante'),
      escapeCsvValue(r.sex || 'M'),
      escapeCsvValue(r.birthDate || ''),
      escapeCsvValue(age !== null ? age : ''),
      escapeCsvValue(r.zoneCode || ''),
      escapeCsvValue(r.houseNumber || ''),
      escapeCsvValue(r.phone || ''),
      escapeCsvValue(r.gasProvider || ''),
      escapeCsvValue(r.gasCylindersCount !== undefined && r.gasCylindersCount !== null ? r.gasCylindersCount : ''),
      escapeCsvValue(r.gasValveType || ''),
      escapeCsvValue(r.waterTankCapacity || 'Ninguno'),
      escapeCsvValue(r.housingTenure || 'Propia'),
      escapeCsvValue(r.conditionAffection || 'Ninguna'),
      escapeCsvValue(r.chronicDiseases || ''),
      escapeCsvValue(r.electoralProfile?.status || 'Sin verificar'),
      escapeCsvValue(r.electoralProfile?.votingCenterName || ''),
      escapeCsvValue(finve.score),
      escapeCsvValue(finve.tier),
      escapeCsvValue(r.status || 'active'),
    ].join(',');
  });

  return `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}`;
}

export function getDemoAnalyticsData() {
  const residents = [
    { id: 'r1', firstName: 'Rosa', lastName: 'Acosta', idNumber: 'V-12456789', rifNumber: 'V-12456789-0', email: 'rosa.acosta@gmail.com', communityTrade: 'Comerciante', sex: 'F', birthDate: '1968-04-12', relationship: 'Jefa de Hogar', zoneCode: 'SAC', houseNumber: '10', phone: '04121112233', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'cronica', chronicDiseases: 'Hipertensión', regularMedications: 'Losartán 50mg', isPregnantOrLactating: 'no', petsCount: '1', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'E.B.N. Bicentenario Republicano' } },
    { id: 'r2', firstName: 'Jesús', lastName: 'Oquendo', idNumber: 'V-11987654', rifNumber: 'V-11987654-2', email: 'jesus.oquendo@gmail.com', communityTrade: 'Técnico Especialista', sex: 'M', birthDate: '1965-09-25', relationship: 'Cónyuge', zoneCode: 'SAC', houseNumber: '10', phone: '04142223344', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'cronica', chronicDiseases: 'Diabetes', regularMedications: 'Metformina 850mg', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'E.B.N. Bicentenario Republicano' } },
    { id: 'r3', firstName: 'César', lastName: 'Oquendo', idNumber: 'V-26543210', rifNumber: 'V-26543210-4', email: 'cesar@finve.net', communityTrade: 'Ingeniero de Software', sex: 'M', birthDate: '1998-03-15', relationship: 'Hijo/a', zoneCode: 'SAC', houseNumber: '10', phone: '04243334455', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'E.B.N. Bicentenario Republicano' } },
    { id: 'r4', firstName: 'Valeria', lastName: 'Mendoza', idNumber: 'V-28123456', rifNumber: 'V-28123456-1', email: 'valeria.m@gmail.com', communityTrade: 'Administradora', sex: 'F', birthDate: '2001-11-20', relationship: 'Jefa de Hogar', zoneCode: 'MNG', houseNumber: '04', phone: '04164445566', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '500L', cookingAppliance: 'cocina_mixta', housingTenure: 'Alquilada', conditionAffection: 'ninguna', chronicDiseases: 'Asma', regularMedications: 'Salbutamol', isPregnantOrLactating: 'si', petsCount: '2', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'Liceo Bolivariano San Agustín' } },
    { id: 'r5', firstName: 'Mateo', lastName: 'Mendoza', idNumber: 'S/C', sex: 'M', birthDate: '2023-08-10', relationship: 'Hijo/a', zoneCode: 'MNG', houseNumber: '04', phone: '', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '500L', cookingAppliance: 'cocina_mixta', housingTenure: 'Alquilada', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: null },
    { id: 'r6', firstName: 'Carmen', lastName: 'Rodríguez', idNumber: 'V-6543210', rifNumber: 'V-6543210-0', communityTrade: 'Pensionada', sex: 'F', birthDate: '1947-06-18', relationship: 'Jefa de Hogar', zoneCode: 'LCH', houseNumber: '15', phone: '04125556677', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Rosca', waterTankCapacity: '1500L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'motora', chronicDiseases: 'Artritis', regularMedications: 'Analgesicos', isPregnantOrLactating: 'no', petsCount: '1', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'Escuela Experimental Venezuela' } },
    { id: 'r7', firstName: 'Pedro', lastName: 'Gómez', idNumber: 'V-15876543', rifNumber: 'V-15876543-2', email: 'pedro.gomez@transporte.com', communityTrade: 'Transportista', sex: 'M', birthDate: '1982-12-05', relationship: 'Jefe de Hogar', zoneCode: 'LCH', houseNumber: '22', phone: '04146667788', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '2000L o más', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '3', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'Escuela Experimental Venezuela' } },
    { id: 'r8', firstName: 'Yelitza', lastName: 'Paredes', idNumber: 'V-17345678', rifNumber: 'V-17345678-5', email: 'yelitza.paredes@educacion.ve', communityTrade: 'Docente', sex: 'F', birthDate: '1985-02-14', relationship: 'Cónyuge', zoneCode: 'LCH', houseNumber: '22', phone: '04247778899', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '2000L o más', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'Escuela Experimental Venezuela' } },
    { id: 'r9', firstName: 'Sofía', lastName: 'Gómez', idNumber: 'V-32456789', sex: 'F', birthDate: '2012-05-30', relationship: 'Hijo/a', zoneCode: 'LCH', houseNumber: '22', phone: '', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '2000L o más', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: null },
    { id: 'r10', firstName: 'Santiago', lastName: 'Gómez', idNumber: 'V-33987654', sex: 'M', birthDate: '2016-10-12', relationship: 'Hijo/a', zoneCode: 'LCH', houseNumber: '22', phone: '', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '2', gasValveType: 'Pico Rápido', waterTankCapacity: '2000L o más', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: null },
    { id: 'r11', firstName: 'Rafael', lastName: 'Castillo', idNumber: 'V-8945612', rifNumber: 'V-8945612-0', communityTrade: 'Jubilado', sex: 'M', birthDate: '1953-08-04', relationship: 'Jefe de Hogar', zoneCode: 'HDC', houseNumber: '08', phone: '04128889900', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Rosca', waterTankCapacity: 'Sin tanque', cookingAppliance: 'cocina_electrica', housingTenure: 'Propia', conditionAffection: 'visual', chronicDiseases: 'Hipertensión', regularMedications: 'Enalapril', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'Colegio Madre Cecilia Cros' } },
    { id: 'r12', firstName: 'Beatriz', lastName: 'Soto', idNumber: 'V-20123987', rifNumber: 'V-20123987-1', email: 'beatriz.soto.cpa@gmail.com', communityTrade: 'Contadora Pública', sex: 'F', birthDate: '1992-07-19', relationship: 'Jefa de Hogar', zoneCode: 'HDC', houseNumber: '11', phone: '04149990011', gasProvider: 'Gas Caracas', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '1', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'Colegio Madre Cecilia Cros' } },
    { id: 'r13', firstName: 'Daniel', lastName: 'Blanco', idNumber: 'V-22345678', rifNumber: 'V-22345678-3', email: 'daniel.blanco@ventas.ve', communityTrade: 'Asesor de Ventas', sex: 'M', birthDate: '1994-01-28', relationship: 'Cónyuge', zoneCode: 'HDC', houseNumber: '11', phone: '04241010101', gasProvider: 'Gas Caracas', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'not_registered' } },
    { id: 'r14', firstName: 'Camila', lastName: 'Blanco', idNumber: 'S/C', sex: 'F', birthDate: '2021-04-03', relationship: 'Hijo/a', zoneCode: 'HDC', houseNumber: '11', phone: '', gasProvider: 'Gas Caracas', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: null },
    { id: 'r15', firstName: 'Elena', lastName: 'Morales', idNumber: 'V-14567890', rifNumber: 'V-14567890-8', email: 'elena.morales@salud.ve', communityTrade: 'Enfermera / Salud', sex: 'F', birthDate: '1979-11-11', relationship: 'Jefa de Hogar', zoneCode: 'MRN', houseNumber: '18', phone: '04162020202', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '3', gasValveType: 'Pico Rápido', waterTankCapacity: '1500L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'cronica', chronicDiseases: 'Diabetes', regularMedications: 'Glibenclamida', isPregnantOrLactating: 'no', petsCount: '2', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'U.E.N. Juan Landaeta' } },
    { id: 'r16', firstName: 'Andrés', lastName: 'Morales', idNumber: 'V-27890123', rifNumber: 'V-27890123-9', email: 'andres.morales@ucv.ve', communityTrade: 'Estudiante Universitario', sex: 'M', birthDate: '1999-12-08', relationship: 'Hijo/a', zoneCode: 'MRN', houseNumber: '18', phone: '04123030303', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '3', gasValveType: 'Pico Rápido', waterTankCapacity: '1500L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'Sin verificar' } },
    { id: 'r17', firstName: 'Francisca', lastName: 'Flores', idNumber: 'V-5432198', rifNumber: 'V-5432198-0', communityTrade: 'Pensionada', sex: 'F', birthDate: '1945-03-30', relationship: 'Madre/Padre', zoneCode: 'MRN', houseNumber: '18', phone: '', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '3', gasValveType: 'Pico Rápido', waterTankCapacity: '1500L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'auditiva', chronicDiseases: 'Hipertensión', regularMedications: 'Amlodipina', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'U.E.N. Juan Landaeta' } },
    { id: 'r18', firstName: 'Manuel', lastName: 'Hernández', idNumber: 'V-16789012', rifNumber: 'V-16789012-3', email: 'manuel.h@consultoria.com', communityTrade: 'Consultor Gerencial', sex: 'M', birthDate: '1984-05-17', relationship: 'Jefe de Hogar', zoneCode: 'SAC', houseNumber: '02', phone: '04144040404', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '1', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'E.B.N. Bicentenario Republicano' } },
    { id: 'r19', firstName: 'Patricia', lastName: 'Guzmán', idNumber: 'V-18456123', rifNumber: 'V-18456123-4', email: 'abg.patricia.guzman@gmail.com', communityTrade: 'Abogada', sex: 'F', birthDate: '1987-10-23', relationship: 'Cónyuge', zoneCode: 'SAC', houseNumber: '02', phone: '04245050505', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: { status: 'registered', votingCenterName: 'E.B.N. Bicentenario Republicano' } },
    { id: 'r20', firstName: 'Lucas', lastName: 'Hernández', idNumber: 'S/C', sex: 'M', birthDate: '2019-09-14', relationship: 'Hijo/a', zoneCode: 'SAC', houseNumber: '02', phone: '', gasProvider: 'PDVSA Gas Comunal', gasCylindersCount: '1', gasValveType: 'Pico Rápido', waterTankCapacity: '1000L', cookingAppliance: 'gas_exclusivo', housingTenure: 'Propia', conditionAffection: 'ninguna', chronicDiseases: '', regularMedications: '', isPregnantOrLactating: 'no', petsCount: '0', status: 'active', electoralProfile: null },
  ];

  const zones = [
    { id: 'z1', code: 'SAC', name: 'CC San Agustín Centro' },
    { id: 'z2', code: 'MNG', name: 'CC El Manguito' },
    { id: 'z3', code: 'LCH', name: 'CC La Charneca' },
    { id: 'z4', code: 'HDC', name: 'CC Hornos de Cal' },
    { id: 'z5', code: 'MRN', name: 'CC Marín' },
  ];

  const households = [
    { id: 'h1', code: 'MTT-SAC-10', zoneCode: 'SAC', houseNumber: '10' },
    { id: 'h2', code: 'MTT-MNG-04', zoneCode: 'MNG', houseNumber: '04' },
    { id: 'h3', code: 'MTT-LCH-15', zoneCode: 'LCH', houseNumber: '15' },
    { id: 'h4', code: 'MTT-LCH-22', zoneCode: 'LCH', houseNumber: '22' },
    { id: 'h5', code: 'MTT-HDC-08', zoneCode: 'HDC', houseNumber: '08' },
    { id: 'h6', code: 'MTT-HDC-11', zoneCode: 'HDC', houseNumber: '11' },
    { id: 'h7', code: 'MTT-MRN-18', zoneCode: 'MRN', houseNumber: '18' },
    { id: 'h8', code: 'MTT-SAC-02', zoneCode: 'SAC', houseNumber: '02' },
  ];

  const dwellings = [
    { id: 'd1', code: 'MTT-SAC-10', zone: 'z1' },
    { id: 'd2', code: 'MTT-MNG-04', zone: 'z2' },
    { id: 'd3', code: 'MTT-LCH-15', zone: 'z3' },
    { id: 'd4', code: 'MTT-LCH-22', zone: 'z3' },
    { id: 'd5', code: 'MTT-HDC-08', zone: 'z4' },
    { id: 'd6', code: 'MTT-HDC-11', zone: 'z4' },
    { id: 'd7', code: 'MTT-MRN-18', zone: 'z5' },
    { id: 'd8', code: 'MTT-SAC-02', zone: 'z1' },
  ];

  return { residents, zones, households, dwellings };
}
