export const ROLES = {
  admin: { label: 'Administrador', short: 'Admin' },
  collaborator: { label: 'Colaborador', short: 'Colab.' },
  regular: { label: 'Residente', short: 'Residente' },
};

export const AUTHORIZED_ADMIN_EMAILS = [
  'jesus.oquendo@gmail.com',
  'rosa.acosta05@gmail.com',
  'rosaacostave@gmail.com',
  'cesaroquendo10@gmail.com',
  'cesarfinve@gmail.com',
  'cesaroquendo64@gmail.com',
  'cesaroquendo108@gmail.com',
  'oquendocesar25@gmail.com',
  'kilby12lite@gmail.com',
  'david.enahp@gmail.com',
  'comunamaotsetung.caracas@gmail.com',
];

export function isAuthorizedAdmin(userOrEmail) {
  if (!userOrEmail) return false;
  const email = typeof userOrEmail === 'string'
    ? userOrEmail
    : (userOrEmail.email || userOrEmail.userEmail || userOrEmail.user?.email || '');
  const clean = String(email).trim().toLowerCase();
  return AUTHORIZED_ADMIN_EMAILS.includes(clean) || clean.endsWith('@uroprofin.invalid') || clean.endsWith('@maotsetung.invalid');
}

const GRANTS = {
  admin: new Set([
    'community.manage', 'roles.manage', 'census.view_all', 'census.create', 'census.update',
    'census.delete', 'census.export', 'census.analytics', 'payments.operate', 'deliveries.operate', 'courtesy.manage',
    'reports.triage', 'reports.private', 'audit.view', 'own.view', 'own.report',
  ]),
  collaborator: new Set([
    'census.create', 'census.update', 'payments.operate', 'deliveries.operate',
    'reports.triage', 'own.view', 'own.report',
  ]),
  regular: new Set(['own.view', 'own.report']),
};

export function can(role, action, user = null) {
  const isAuth = user ? isAuthorizedAdmin(user) : false;
  const effectiveRole = isAuth ? 'admin' : role;
  if (action === 'census.view_all' || action === 'census.export' || action === 'census.analytics') {
    if (effectiveRole !== 'admin') return false;
    if (user && !isAuth) return false;
    return true;
  }
  return GRANTS[effectiveRole]?.has(action) || false;
}

export function roleLabel(role) {
  return ROLES[role]?.label || ROLES.regular.label;
}

export const ROLE_MATRIX = [
  { capability: 'Ver su hogar y reportar novedades', admin: true, collaborator: true, regular: true },
  { capability: 'Ver el censo completo de la comunidad', admin: true, collaborator: false, regular: false },
  { capability: 'Visualizar métricas de inteligencia BI', admin: true, collaborator: false, regular: false },
  { capability: 'Agregar y corregir personas del censo', admin: true, collaborator: true, regular: false },
  { capability: 'Registrar pagos y entregas', admin: true, collaborator: true, regular: false },
  { capability: 'Eliminar personas o movimientos', admin: true, collaborator: false, regular: false },
  { capability: 'Asignar roles y bolsas de cortesía', admin: true, collaborator: false, regular: false },
];
