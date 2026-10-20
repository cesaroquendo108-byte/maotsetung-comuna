// Security and invariant hooks for the dedicated Uroprofin PocketBase instance.
// PocketBase serializes each hook handler in an isolated JS runtime. Require the
// helper module inside every handler; outer-scope functions are not available.

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validateTenant(e.app, e.record);
  e.next();
},
  'census_imports',
  'zones',
  'dwellings',
  'families',
  'family_memberships',
  'verification_cases',
  'gas_periods',
  'gas_registrations',
  'gas_cylinders',
  'sectors',
  'households',
  'community_memberships',
  'membership_requests',
  'role_invitations',
  'import_batches',
  'residents',
  'resident_change_requests',
  'distribution_cycles',
  'bag_allocations',
  'payment_reports',
  'payment_allocations',
  'payment_import_staging',
  'delivery_self_reports',
  'delivery_confirmations',
  'pickup_authorizations',
  'pickup_batches',
  'pickup_lines',
  'survey_campaigns',
  'survey_responses',
  'community_reports',
  'community_report_events',
  'electoral_profiles',
  'cne_query_attempts',
  'toy_campaigns',
  'toy_allocations',
);

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validateTenant(e.app, e.record);
  e.next();
},
  'census_imports',
  'zones',
  'dwellings',
  'families',
  'family_memberships',
  'verification_cases',
  'gas_periods',
  'gas_registrations',
  'gas_cylinders',
  'sectors',
  'households',
  'community_memberships',
  'membership_requests',
  'role_invitations',
  'import_batches',
  'residents',
  'resident_change_requests',
  'distribution_cycles',
  'bag_allocations',
  'payment_reports',
  'payment_allocations',
  'payment_import_staging',
  'delivery_self_reports',
  'delivery_confirmations',
  'pickup_authorizations',
  'pickup_batches',
  'pickup_lines',
  'survey_campaigns',
  'survey_responses',
  'community_reports',
  'community_report_events',
  'electoral_profiles',
  'cne_query_attempts',
  'toy_campaigns',
  'toy_allocations',
);

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    e.record.set('serviceAccount', false);
    e.record.set('serviceScopes', []);
    e.record.set('disabled', false);
  }
  e.next();
}, 'users');

onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const original = e.record.original();
    if (
      original.getBool('serviceAccount') !== e.record.getBool('serviceAccount')
      || String(original.getStringSlice('serviceScopes')) !== String(e.record.getStringSlice('serviceScopes'))
      || original.getBool('disabled') !== e.record.getBool('disabled')
    ) {
      throw new ForbiddenError('Los privilegios de servicio solo los administra un superusuario.');
    }
  }
  e.next();
}, 'users');

onRecordAuthRequest((e) => {
  if (e.record.getBool('disabled')) throw new ForbiddenError('Esta cuenta está deshabilitada.');
  const email = e.record.getString('email').trim().toLowerCase();
  const invitations = e.app.findRecordsByFilter(
    'role_invitations',
    'email = {:email} && status = "pending"',
    'created',
    20,
    0,
    { email },
  );
  for (let index = 0; index < invitations.length; index += 1) {
    const invitation = invitations[index];
    const existing = e.app.findRecordsByFilter(
      'community_memberships',
      'community = {:community} && user = {:user}',
      '',
      1,
      0,
      { community: invitation.getString('community'), user: e.record.id },
    );
    const membership = existing.length
      ? existing[0]
      : new Record(e.app.findCollectionByNameOrId('community_memberships'));
    membership.set('community', invitation.getString('community'));
    membership.set('user', e.record.id);
    membership.set('role', invitation.getString('role'));
    membership.set('status', 'active');
    membership.set('approvedBy', invitation.getString('invitedBy'));
    membership.set('approvedAt', new Date().toISOString());
    membership.set('notes', 'Rol activado desde una invitación administrativa por correo.');
    e.app.save(membership);

    invitation.set('status', 'accepted');
    invitation.set('acceptedBy', e.record.id);
    invitation.set('acceptedAt', new Date().toISOString());
    e.app.save(invitation);
  }
  e.next();
}, 'users');

onRecordCreateRequest((e) => {
  e.record.set('email', e.record.getString('email').trim().toLowerCase());
  if (!e.hasSuperuserAuth()) {
    e.record.set('invitedBy', e.auth.id);
    e.record.set('status', 'pending');
    e.record.set('acceptedBy', '');
    e.record.set('acceptedAt', '');
  }
  e.next();
}, 'role_invitations');

onRecordUpdateRequest((e) => {
  e.record.set('email', e.record.getString('email').trim().toLowerCase());
  e.next();
}, 'role_invitations');

onRecordUpdateRequest((e) => {
  const original = e.record.original();
  const removesAdmin = original.getString('role') === 'admin'
    && original.getString('status') === 'active'
    && (e.record.getString('role') !== 'admin' || e.record.getString('status') !== 'active');
  if (removesAdmin) {
    const others = e.app.findRecordsByFilter(
      'community_memberships',
      'community = {:community} && role = "admin" && status = "active" && id != {:id}',
      '',
      1,
      0,
      { community: original.getString('community'), id: original.id },
    );
    if (!others.length) throw new BadRequestError('La comunidad debe conservar al menos un administrador activo.');
  }
  e.next();
}, 'community_memberships');

onRecordDeleteRequest((e) => {
  if (e.record.getString('role') === 'admin' && e.record.getString('status') === 'active') {
    const others = e.app.findRecordsByFilter(
      'community_memberships',
      'community = {:community} && role = "admin" && status = "active" && id != {:id}',
      '',
      1,
      0,
      { community: e.record.getString('community'), id: e.record.id },
    );
    if (!others.length) throw new BadRequestError('La comunidad debe conservar al menos un administrador activo.');
  }
  e.next();
}, 'community_memberships');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth()) {
    e.record.set('user', e.auth.id);
    e.record.set('status', 'pending');
  }
  e.record.set('communityCode', e.record.getString('communityCode').trim().toUpperCase());
  e.record.set('idNumberNormalized', h.digits(e.record.getString('idNumber')));
  e.next();
}, 'membership_requests');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const firstName = e.record.getString('firstName').trim();
  const lastName = e.record.getString('lastName').trim();
  if (!firstName && !lastName) throw new BadRequestError('La persona debe conservar al menos un nombre o apellido del registro fuente.');
  e.record.set('firstName', firstName);
  e.record.set('lastName', lastName);
  e.record.set('idNumberNormalized', h.digits(e.record.getString('idNumber')));
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('createdBy', e.auth.id);
  e.next();
}, 'residents');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const firstName = e.record.getString('firstName').trim();
  const lastName = e.record.getString('lastName').trim();
  if (!firstName && !lastName) throw new BadRequestError('La persona debe conservar al menos un nombre o apellido del registro fuente.');
  e.record.set('firstName', firstName);
  e.record.set('lastName', lastName);
  e.record.set('idNumberNormalized', h.digits(e.record.getString('idNumber')));
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('updatedBy', e.auth.id);
  e.next();
}, 'residents');

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('createdBy', e.auth.id);
  e.next();
}, 'resident_change_requests');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth() && e.auth && !h.isScopedService(e.auth, 'payments')) {
    e.record.set('reportedBy', e.auth.id);
    e.record.set('status', 'pending_review');
  }
  e.record.set('referenceNormalized', h.normalizedReference(e.record.getString('reference')));
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  e.next();
}, 'payment_reports');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validateVerifiedPaymentImmutable(e);
  e.record.set('referenceNormalized', h.normalizedReference(e.record.getString('reference')));
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  const originalStatus = e.record.original().getString('status');
  const nextStatus = e.record.getString('status');
  if (originalStatus !== nextStatus && (nextStatus === 'verified' || nextStatus === 'rejected')) {
    const trustedService = h.isScopedService(e.auth, 'payments');
    const isAdmin = h.hasCommunityRole(e.app, e.auth, e.record.getString('community'), ['admin']);
    if (!e.hasSuperuserAuth() && !trustedService && !isAdmin) {
      throw new ForbiddenError('Solo administración o el validador puede cerrar una verificación de pago.');
    }
    if (e.auth) e.record.set('reviewedBy', e.auth.id);
    e.record.set('reviewedAt', new Date().toISOString());
  }
  e.next();
}, 'payment_reports');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('createdBy', e.auth.id);
  h.validatePaymentAllocation(e);
  e.next();
}, 'payment_allocations');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validatePaymentAllocation(e);
  e.next();
}, 'payment_allocations');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth() && e.auth) {
    e.record.set('reportedBy', e.auth.id);
    e.record.set('status', 'pending_review');
  }
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  e.next();
}, 'delivery_self_reports');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('createdBy', e.auth.id);
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  e.record.set('collectorIdNumberNormalized', h.digits(e.record.getString('collectorIdNumber')));
  h.validatePickupBatch(e);
  const bags = e.record.getInt('bags');
  if (bags < 1 || bags > 17) throw new BadRequestError('Una autorización admite entre 1 y 17 bolsas.');
  e.next();
}, 'pickup_authorizations');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  e.record.set('collectorIdNumberNormalized', h.digits(e.record.getString('collectorIdNumber')));
  h.validatePickupBatch(e);
  const bags = e.record.getInt('bags');
  if (bags < 1 || bags > 17) throw new BadRequestError('Una autorización admite entre 1 y 17 bolsas.');
  e.next();
}, 'pickup_authorizations');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth() && e.auth) {
    e.record.set('createdBy', e.auth.id);
    e.record.set('status', 'draft');
  }
  e.record.set('collectorIdNumberNormalized', h.digits(e.record.getString('collectorIdNumber')));
  h.validatePickupBatch(e);
  const declared = e.record.getInt('declaredBags');
  if (declared < 1 || declared > 17) throw new BadRequestError('Un retiro físico admite entre 1 y 17 bolsas.');
  e.next();
}, 'pickup_batches');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  e.record.set('collectorIdNumberNormalized', h.digits(e.record.getString('collectorIdNumber')));
  h.validatePickupBatch(e);
  const declared = e.record.getInt('declaredBags');
  if (declared < 1 || declared > 17) throw new BadRequestError('Un retiro físico admite entre 1 y 17 bolsas.');
  const lines = e.app.findRecordsByFilter('pickup_lines', 'batch = {:batch}', '', 200, 0, { batch: e.record.id });
  let total = 0;
  for (let index = 0; index < lines.length; index += 1) total += lines[index].getInt('quantity');
  if (total > declared) throw new BadRequestError('La cantidad declarada no puede ser menor que las líneas del retiro.');
  const status = e.record.getString('status');
  if ((status === 'verified' || status === 'delivered') && total !== declared) {
    throw new BadRequestError('Antes de cerrar el retiro, las líneas deben sumar exactamente la cantidad declarada.');
  }
  if (status === 'verified' && e.auth) e.record.set('verifiedBy', e.auth.id);
  e.next();
}, 'pickup_batches');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validatePickupLine(e);
  e.next();
}, 'pickup_lines');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validatePickupLine(e);
  e.next();
}, 'pickup_lines');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validateCourtesy(e);
  e.next();
}, 'bag_allocations');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  h.validateCourtesy(e);
  e.next();
}, 'bag_allocations');

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('createdBy', e.auth.id);
  e.record.set('identityReserved', true);
  if (['Violencia intrafamiliar', 'Seguridad'].indexOf(e.record.getString('category')) !== -1) {
    e.record.set('privacy', 'restricted');
    e.record.set('urgent', true);
  }
  e.record.set('status', 'new');
  e.next();
}, 'community_reports');

onRecordUpdateRequest((e) => {
  e.record.set('identityReserved', true);
  if (['Violencia intrafamiliar', 'Seguridad'].indexOf(e.record.getString('category')) !== -1) {
    e.record.set('privacy', 'restricted');
    e.record.set('urgent', true);
  }
  e.next();
}, 'community_reports');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.hasSuperuserAuth() && e.auth) e.record.set('createdBy', e.auth.id);
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  e.next();
}, 'survey_responses');

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  e.next();
}, 'survey_responses');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const trustedService = h.isScopedService(e.auth, 'cne');
  e.record.set('requestKey', h.normalizedRequestKey(e.record.getString('requestKey')));
  if (!e.hasSuperuserAuth() && !trustedService) {
    if (!e.auth) throw new ForbiddenError('Debes iniciar sesión para consultar el CNE.');
    e.record.set('actor', e.auth.id);
    e.record.set('status', 'started');
    const attempts = e.app.findRecordsByFilter(
      'cne_query_attempts',
      'actor = {:actor} && resident = {:resident}',
      '-created',
      25,
      0,
      { actor: e.auth.id, resident: e.record.getString('resident') },
    );
    const now = Date.now();
    let minuteCount = 0;
    let rollingDayCount = 0;
    for (let index = 0; index < attempts.length; index += 1) {
      const createdAt = Date.parse(attempts[index].getString('created'));
      if (isNaN(createdAt)) continue;
      if (now - createdAt < 60 * 1000) minuteCount += 1;
      if (now - createdAt < 24 * 60 * 60 * 1000) rollingDayCount += 1;
    }
    if (minuteCount >= 5) {
      throw e.tooManyRequestsError('Alcanzaste el máximo de 5 consultas por minuto para esta persona.', {});
    }
    if (rollingDayCount >= 25) {
      throw e.tooManyRequestsError('Alcanzaste el máximo diario de 25 consultas para esta persona.', {});
    }
  }
  e.next();
}, 'cne_query_attempts');

onRecordEnrich((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const auth = (typeof e.requestInfo === 'function' ? e.requestInfo() : e.requestInfo)?.auth;
  if (!auth || !h.hasCommunityRole(e.app, auth, e.record.getString('community'), ['admin'])) return e.next();
  const userId = e.record.getString('user');
  if (userId) {
    const user = e.app.findRecordById('users', userId);
    e.record.withCustomData(true);
    e.record.set('accountEmail', user.getString('email'));
    e.record.set('accountName', user.getString('name'));
  }
  e.next();
}, 'community_memberships');

onRecordEnrich((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const auth = (typeof e.requestInfo === 'function' ? e.requestInfo() : e.requestInfo)?.auth;
  const communes = e.app.findRecordsByFilter('communes', 'code = {:code}', '', 1, 0, { code: e.record.getString('communityCode') });
  if (!auth || !communes.length || !h.hasCommunityRole(e.app, auth, communes[0].id, ['admin'])) return e.next();
  const userId = e.record.getString('user');
  if (userId) {
    const user = e.app.findRecordById('users', userId);
    e.record.withCustomData(true);
    e.record.set('accountEmail', user.getString('email'));
    e.record.set('accountName', user.getString('name'));
  }
  e.next();
}, 'membership_requests');

onRecordEnrich((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  if (!e.record.getBool('identityReserved')) return e.next();
  const auth = (typeof e.requestInfo === 'function' ? e.requestInfo() : e.requestInfo)?.auth;
  const isCreator = auth && auth.id === e.record.getString('createdBy');
  const isManager = auth && h.hasCommunityRole(e.app, auth, e.record.getString('community'), ['admin', 'collaborator']);
  if (!isCreator && !isManager) e.record.hide('createdBy', 'household');
  e.next();
}, 'community_reports');

onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  e.next();
  h.writeAudit(e, 'create', null);
},
  'census_imports',
  'zones',
  'dwellings',
  'families',
  'family_memberships',
  'verification_cases',
  'gas_periods',
  'gas_registrations',
  'gas_cylinders',
  'communes',
  'sectors',
  'households',
  'community_memberships',
  'role_invitations',
  'residents',
  'resident_change_requests',
  'distribution_cycles',
  'bag_allocations',
  'payment_reports',
  'payment_allocations',
  'delivery_self_reports',
  'delivery_confirmations',
  'pickup_authorizations',
  'pickup_batches',
  'pickup_lines',
  'community_reports',
  'community_report_events',
  'electoral_profiles',
  'toy_campaigns',
  'toy_allocations',
);

onRecordUpdateRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const before = e.record.original();
  e.next();
  h.writeAudit(e, 'update', before);
},
  'zones',
  'dwellings',
  'families',
  'family_memberships',
  'verification_cases',
  'gas_periods',
  'gas_registrations',
  'gas_cylinders',
  'communes',
  'sectors',
  'households',
  'community_memberships',
  'role_invitations',
  'residents',
  'resident_change_requests',
  'distribution_cycles',
  'bag_allocations',
  'payment_reports',
  'payment_allocations',
  'delivery_self_reports',
  'delivery_confirmations',
  'pickup_authorizations',
  'pickup_batches',
  'pickup_lines',
  'community_reports',
  'community_report_events',
  'electoral_profiles',
  'toy_campaigns',
  'toy_allocations',
);

onRecordDeleteRequest((e) => {
  const h = require(`${__hooks}/lib/maotsetung.js`);
  const before = e.record.original();
  e.next();
  h.writeAudit(e, 'delete', before);
},
  'zones',
  'dwellings',
  'families',
  'family_memberships',
  'verification_cases',
  'gas_periods',
  'gas_registrations',
  'gas_cylinders',
  'communes',
  'sectors',
  'households',
  'community_memberships',
  'role_invitations',
  'residents',
  'resident_change_requests',
  'distribution_cycles',
  'bag_allocations',
  'payment_reports',
  'payment_allocations',
  'delivery_self_reports',
  'delivery_confirmations',
  'pickup_authorizations',
  'pickup_batches',
  'pickup_lines',
  'community_reports',
  'community_report_events',
  'electoral_profiles',
  'toy_campaigns',
  'toy_allocations',
);
