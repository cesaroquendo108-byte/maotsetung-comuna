import { COMMUNITY_CONFIG } from '../config/community.js';

export const demoCommunity = {
  id: COMMUNITY_CONFIG.id,
  name: COMMUNITY_CONFIG.name,
  sector: 'Parroquia San Agustín',
  code: COMMUNITY_CONFIG.code,
  municipality: COMMUNITY_CONFIG.municipality,
  academicPartner: COMMUNITY_CONFIG.academicPartner,
  councils: COMMUNITY_CONFIG.councils,
};

export const demoCycle = {
  id: 'cycle-oct-2026',
  name: 'Jornada CLAP · octubre 2026',
  startsAt: '2026-10-15T08:00:00-04:00',
  closesAt: '2026-10-25T23:59:00-04:00',
  deliveryDate: 'Por confirmar',
  price: 250,
  currency: 'VES',
  status: 'collecting',
  paymentStatus: 'pending_review',
  deliveryStatus: 'pending',
  entitlementCount: 1,
};

export const demoHousehold = {
  id: 'house-mtt-demo',
  code: 'MTT-SAC-024',
  address: 'San Agustín Centro, Calle Real, Casa 24',
  gasProvider: 'PDVSA Gas Comunal',
  members: [],
};

export const demoStats = {
  households: 0,
  residents: 0,
  children: 0,
  olderAdults: 0,
  voters: 0,
  eligibleBags: 0,
  paymentsReported: 0,
  paymentsValidated: 0,
  gasCaracas: 0,
  gasComunal: 0,
};

export const demoResidents = [];

export const demoIncidents = [];

export const demoPickupAuthorizations = [];

export const segmentOptions = [
  'Todos',
  'CC San Agustín Centro',
  'CC El Manguito',
  'CC La Charneca',
  'CC Hornos de Cal',
  'CC Marín',
  'Sin centro electoral',
  'Con centro electoral',
  'CNE pendiente',
  'Error CNE',
  'No inscrito CNE',
  'Fuente 2024',
  'Niñez',
  'Adulto',
  'Adulto mayor',
  'Sin fecha',
  'Sin teléfono',
  'Gas Caracas',
  'Gas Comunal',
  'Gas sin definir',
];
