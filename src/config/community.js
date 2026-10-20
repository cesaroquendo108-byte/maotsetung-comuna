// Institutional Community Configuration
// Comuna Mao Tse Tung - Parroquia San Agustín, Municipio Bolivariano Libertador, Caracas
// Escuela Nacional de Administración y Hacienda Pública (ENAHP-IUT) · Ciencias Fiscales

export const COMMUNITY_CONFIG = {
  id: 'comuna-mao-tse-tung',
  code: 'MTT-001',
  shortCode: 'MTT',
  name: 'Comuna Mao Tse Tung',
  shortName: 'Mao Tse Tung',
  legalName: 'Comuna Socialista Mao Tse Tung',
  parish: 'San Agustín',
  municipality: 'Municipio Bolivariano Libertador',
  state: 'Distrito Capital',
  postalCode: '1010',
  country: 'Venezuela',
  tagline: 'Sistema de Inteligencia, Caracterización Sociodemográfica y Gestión Fiscal Comunal',
  academicPartner: {
    institution: 'Escuela Nacional de Administración y Hacienda Pública (ENAHP-IUT)',
    ministry: 'Ministerio del Poder Popular de Economía y Finanzas',
    program: 'Programa de Servicio Comunitario · Ciencias Fiscales',
    acronym: 'ENAHP-IUT',
  },
  councils: [
    { id: 'cc-1', code: 'CC-SAC', name: 'Consejo Comunal San Agustín Centro', shortName: 'San Agustín Centro', abbreviation: 'SAC' },
    { id: 'cc-2', code: 'CC-MNG', name: 'Consejo Comunal El Manguito', shortName: 'El Manguito', abbreviation: 'MNG' },
    { id: 'cc-3', code: 'CC-LCH', name: 'Consejo Comunal La Charneca', shortName: 'La Charneca', abbreviation: 'LCH' },
    { id: 'cc-4', code: 'CC-HDC', name: 'Consejo Comunal Hornos de Cal', shortName: 'Hornos de Cal', abbreviation: 'HDC' },
    { id: 'cc-5', code: 'CC-MRN', name: 'Consejo Comunal Marín', shortName: 'Marín', abbreviation: 'MRN' },
  ],
  defaultCouncilCode: 'CC-SAC',
  contactEmail: 'comunamaotsetung.caracas@gmail.com',
};
