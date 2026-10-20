function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizedReference(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizedRequestKey(value) {
  return String(value || '').trim().slice(0, 120);
}

function isScopedService(auth, scope) {
  if (!auth || !auth.getBool('serviceAccount')) return false;
  return auth.getStringSlice('serviceScopes').indexOf(scope) !== -1;
}

function hasCommunityRole(app, auth, communityId, allowedRoles) {
  if (!auth || !communityId) return false;
  const records = app.findRecordsByFilter(
    'community_memberships',
    'user = {:user} && community = {:community} && status = "active"',
    '',
    1,
    0,
    { user: auth.id, community: communityId },
  );
  return records.length > 0 && allowedRoles.indexOf(records[0].getString('role')) !== -1;
}

const tenantRelations = {
  census_imports: [['community', 'communes'], ['importedBy', 'users']],
  zones: [['community', 'communes']],
  dwellings: [['community', 'communes'], ['zone', 'zones'], ['import', 'census_imports'], ['mergedInto', 'dwellings']],
  families: [['community', 'communes'], ['zone', 'zones'], ['dwelling', 'dwellings'], ['import', 'census_imports']],
  family_memberships: [['community', 'communes'], ['family', 'families'], ['person', 'residents'], ['import', 'census_imports']],
  verification_cases: [['community', 'communes'], ['zone', 'zones'], ['dwelling', 'dwellings'], ['family', 'families'], ['person', 'residents']],
  gas_periods: [['community', 'communes']],
  gas_registrations: [['community', 'communes'], ['period', 'gas_periods'], ['family', 'families'], ['dwelling', 'dwellings']],
  gas_cylinders: [['community', 'communes'], ['registration', 'gas_registrations']],
  sectors: [['community', 'communes']],
  households: [['community', 'communes'], ['sector', 'sectors']],
  community_memberships: [['community', 'communes'], ['household', 'households'], ['resident', 'residents'], ['family', 'families'], ['dwelling', 'dwellings']],
  membership_requests: [['matchedCommunity', 'communes'], ['matchedHousehold', 'households']],
  role_invitations: [['community', 'communes']],
  import_batches: [['community', 'communes']],
  residents: [['community', 'communes'], ['household', 'households'], ['importBatch', 'import_batches']],
  resident_change_requests: [['community', 'communes'], ['household', 'households'], ['resident', 'residents']],
  distribution_cycles: [['community', 'communes']],
  bag_allocations: [['community', 'communes'], ['cycleRecord', 'distribution_cycles'], ['household', 'households']],
  payment_reports: [['community', 'communes'], ['household', 'households'], ['cycleRecord', 'distribution_cycles']],
  payment_allocations: [['community', 'communes'], ['paymentReport', 'payment_reports'], ['bagAllocation', 'bag_allocations']],
  payment_import_staging: [['community', 'communes'], ['importBatch', 'import_batches'], ['matchedHousehold', 'households'], ['paymentReport', 'payment_reports']],
  delivery_self_reports: [['community', 'communes'], ['household', 'households'], ['cycleRecord', 'distribution_cycles']],
  delivery_confirmations: [['community', 'communes'], ['household', 'households'], ['cycleRecord', 'distribution_cycles'], ['bagAllocation', 'bag_allocations']],
  pickup_authorizations: [['community', 'communes'], ['household', 'households'], ['cycleRecord', 'distribution_cycles']],
  pickup_batches: [['community', 'communes'], ['cycleRecord', 'distribution_cycles']],
  pickup_lines: [['community', 'communes'], ['batch', 'pickup_batches'], ['household', 'households'], ['bagAllocation', 'bag_allocations'], ['authorization', 'pickup_authorizations']],
  survey_campaigns: [['community', 'communes']],
  survey_responses: [['community', 'communes'], ['household', 'households'], ['campaign', 'survey_campaigns']],
  community_reports: [['community', 'communes'], ['household', 'households']],
  community_report_events: [['community', 'communes'], ['report', 'community_reports']],
  electoral_profiles: [['community', 'communes'], ['resident', 'residents']],
  cne_query_attempts: [['community', 'communes'], ['resident', 'residents']],
  toy_campaigns: [['community', 'communes']],
  toy_allocations: [['community', 'communes'], ['campaign', 'toy_campaigns'], ['resident', 'residents']],
};

function validateTenant(app, record) {
  const relations = tenantRelations[record.collection().name] || [];
  const recordCommunity = record.getString('community') || record.getString('matchedCommunity');
  for (let index = 0; index < relations.length; index += 1) {
    const field = relations[index][0];
    const relationId = record.getString(field);
    if (!relationId) continue;
    const related = app.findRecordById(relations[index][1], relationId);
    const relatedCommunity = related.collection().name === 'communes'
      ? related.id
      : related.getString('community');
    if (relatedCommunity && recordCommunity && relatedCommunity !== recordCommunity) {
      throw new BadRequestError(`La relación ${field} no pertenece a la misma comuna.`);
    }
  }
  if (record.collection().name === 'community_memberships') {
    const residentId = record.getString('resident');
    if (residentId) {
      const householdId = record.getString('household');
      if (!householdId) throw new BadRequestError('Una identidad residente requiere un hogar vinculado.');
      const resident = app.findRecordById('residents', residentId);
      if (resident.getString('household') !== householdId || resident.getString('status') !== 'active') {
        throw new BadRequestError('La identidad residente debe pertenecer al hogar activo de la membresía.');
      }
    }
  }
}

function activePickupLineQuantity(app, field, relationId, currentLineId) {
  const lines = app.findRecordsByFilter(
    'pickup_lines',
    `${field} = {:relation} && id != {:id}`,
    '',
    200,
    0,
    { relation: relationId, id: currentLineId },
  );
  let quantity = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const relatedBatch = app.findRecordById('pickup_batches', lines[index].getString('batch'));
    if (relatedBatch.getString('status') !== 'cancelled') quantity += lines[index].getInt('quantity');
  }
  return quantity;
}

function collectorBelongsToHousehold(app, batch, householdId) {
  const collector = batch.getString('collectorIdNumberNormalized');
  if (!collector) return false;
  const residents = app.findRecordsByFilter(
    'residents',
    'household = {:household} && idNumberNormalized = {:collector} && status = "active"',
    '',
    1,
    0,
    { household: householdId, collector },
  );
  return residents.length > 0;
}

function validatePaymentAllocation(e) {
  const paymentReportId = e.record.getString('paymentReport');
  const bagAllocationId = e.record.getString('bagAllocation');
  const payment = e.app.findRecordById('payment_reports', paymentReportId);
  const allocation = e.app.findRecordById('bag_allocations', bagAllocationId);
  if (payment.getString('household') !== allocation.getString('household')) {
    throw new BadRequestError('El pago y la asignación deben pertenecer al mismo hogar.');
  }
  const paymentCycle = payment.getString('cycleRecord');
  const allocationCycle = allocation.getString('cycleRecord');
  if (!paymentCycle || paymentCycle !== allocationCycle) {
    throw new BadRequestError('El pago y la asignación deben pertenecer a la misma jornada.');
  }
  const cycle = e.app.findRecordById('distribution_cycles', allocationCycle);
  if (cycle.getString('currency') !== payment.getString('currency')) {
    throw new BadRequestError('La moneda del pago no coincide con la moneda de la jornada.');
  }
  if (e.record.getString('status') === 'applied' && payment.getString('status') !== 'verified') {
    throw new BadRequestError('Solo un pago verificado puede aplicarse a una asignación.');
  }
  const amount = Number(e.record.get('amount') || 0);
  const siblings = e.app.findRecordsByFilter(
    'payment_allocations',
    'paymentReport = {:payment} && id != {:id} && status != "reversed"',
    '',
    200,
    0,
    { payment: paymentReportId, id: e.record.id },
  );
  let allocated = e.record.getString('status') === 'reversed' ? 0 : amount;
  for (let index = 0; index < siblings.length; index += 1) allocated += Number(siblings[index].get('amount') || 0);
  if (allocated > Number(payment.get('amount') || 0)) {
    throw new BadRequestError('La suma conciliada no puede superar el monto del pago.');
  }
}

function fieldChanged(record, original, field) {
  return JSON.stringify(record.get(field) ?? null) !== JSON.stringify(original.get(field) ?? null);
}

function validateVerifiedPaymentImmutable(e) {
  const original = e.record.original();
  if (original.getString('status') !== 'verified') return;
  if (e.record.getString('status') !== 'verified') {
    throw new BadRequestError('El estado de un pago verificado es inmutable; registra una reversa contable.');
  }
  const immutable = ['community', 'household', 'cycle', 'cycleRecord', 'reportedBy', 'amount', 'currency', 'method', 'reference', 'receipt'];
  for (let index = 0; index < immutable.length; index += 1) {
    if (fieldChanged(e.record, original, immutable[index])) {
      throw new BadRequestError('Los datos financieros de un pago verificado son inmutables; registra una reversa o un nuevo reporte.');
    }
  }
}

function validatePickupLine(e) {
  const quantity = e.record.getInt('quantity');
  if (quantity < 1 || quantity > 17) throw new BadRequestError('Cada línea admite entre 1 y 17 bolsas.');
  const batchId = e.record.getString('batch');
  const siblings = e.app.findRecordsByFilter(
    'pickup_lines',
    'batch = {:batch} && id != {:id}',
    '',
    200,
    0,
    { batch: batchId, id: e.record.id },
  );
  let total = quantity;
  for (let index = 0; index < siblings.length; index += 1) total += siblings[index].getInt('quantity');
  const batch = e.app.findRecordById('pickup_batches', batchId);
  const householdId = e.record.getString('household');
  const lineType = e.record.getString('lineType');
  const batchCycleId = batch.getString('cycleRecord');
  const allocationId = e.record.getString('bagAllocation');
  const authorizationId = e.record.getString('authorization');
  if (lineType === 'authorized' && !authorizationId) {
    throw new BadRequestError('Una línea autorizada requiere la autorización del hogar.');
  }
  if (authorizationId) {
    const authorization = e.app.findRecordById('pickup_authorizations', authorizationId);
    if (authorization.getString('household') !== householdId) {
      throw new BadRequestError('La autorización no corresponde al hogar de la línea.');
    }
    if (batchCycleId && authorization.getString('cycleRecord') !== batchCycleId) {
      throw new BadRequestError('La autorización no pertenece a la misma jornada del retiro.');
    }
    if (authorization.getString('collectorIdNumberNormalized') !== batch.getString('collectorIdNumberNormalized')) {
      throw new BadRequestError('La autorización pertenece a otra persona recolectora.');
    }
    if (authorization.getString('status') !== 'active' || quantity > authorization.getInt('bags')) {
      throw new BadRequestError('La autorización no está activa o no cubre la cantidad indicada.');
    }
    const alreadyAuthorized = activePickupLineQuantity(e.app, 'authorization', authorizationId, e.record.id);
    if (alreadyAuthorized + quantity > authorization.getInt('bags')) {
      throw new BadRequestError('La autorización ya fue consumida total o parcialmente en otro retiro.');
    }
  }
  if (!allocationId) {
    throw new BadRequestError('Toda línea de retiro requiere una asignación de bolsas vigente.');
  } else {
    const allocation = e.app.findRecordById('bag_allocations', allocationId);
    if (allocation.getString('household') !== householdId) {
      throw new BadRequestError('La asignación no corresponde al hogar de la línea.');
    }
    if (batchCycleId && allocation.getString('cycleRecord') !== batchCycleId) {
      throw new BadRequestError('La asignación no pertenece a la misma jornada del retiro.');
    }
    if (quantity > allocation.getInt('quantity')) {
      throw new BadRequestError('La línea supera la cantidad asignada al hogar.');
    }
    if (['cancelled', 'delivered'].indexOf(allocation.getString('status')) !== -1) {
      throw new BadRequestError('La asignación ya no está disponible para retiro.');
    }
    const alreadyAllocated = activePickupLineQuantity(e.app, 'bagAllocation', allocationId, e.record.id);
    if (alreadyAllocated + quantity > allocation.getInt('quantity')) {
      throw new BadRequestError('La asignación ya fue consumida total o parcialmente en otro retiro.');
    }
    if (lineType === 'courtesy' && allocation.getString('allocationType') !== 'courtesy') {
      throw new BadRequestError('Una línea de cortesía requiere una asignación de cortesía.');
    }
    if (lineType !== 'courtesy' && allocation.getString('allocationType') === 'courtesy') {
      throw new BadRequestError('Una asignación de cortesía debe registrarse como retiro de cortesía.');
    }
  }
  if (lineType === 'own') {
    if (authorizationId) throw new BadRequestError('Un retiro propio no debe usar una autorización de terceros.');
    if (!collectorBelongsToHousehold(e.app, batch, householdId)) {
      throw new BadRequestError('El retiro propio requiere que la persona recolectora pertenezca al hogar.');
    }
  }
  if (lineType === 'courtesy' && !authorizationId && !collectorBelongsToHousehold(e.app, batch, householdId)) {
    throw new BadRequestError('Una cortesía retirada por un tercero requiere autorización del hogar.');
  }
  if (total > 17 || total > batch.getInt('declaredBags')) {
    throw new BadRequestError('El retiro no puede superar 17 bolsas ni la cantidad declarada.');
  }
}

function validatePickupBatch(e) {
  const cycleId = e.record.getString('cycleRecord');
  if (!cycleId) return;
  const cycle = e.app.findRecordById('distribution_cycles', cycleId);
  if (cycle.getString('code') !== e.record.getString('cycle')) {
    throw new BadRequestError('El código y la relación de jornada del retiro no coinciden.');
  }
}

function validateCourtesy(e) {
  if (!e.hasSuperuserAuth() && e.auth && !e.record.getString('createdBy')) e.record.set('createdBy', e.auth.id);
  if (e.record.getString('allocationType') !== 'courtesy') return;
  const community = e.record.getString('community');
  if (!e.hasSuperuserAuth() && !hasCommunityRole(e.app, e.auth, community, ['admin'])) {
    throw new ForbiddenError('Solo un administrador activo puede aprobar una cortesía.');
  }
  if (!e.record.getString('courtesyReason').trim()) {
    throw new BadRequestError('Toda bolsa de cortesía requiere un motivo.');
  }
  if (!e.hasSuperuserAuth() && e.auth && !e.record.getString('approvedBy')) e.record.set('approvedBy', e.auth.id);
}

function auditMetadata(record, before) {
  const metadata = {};
  const fields = ['status', 'role', 'allocationType', 'quantity', 'privacy', 'category'];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const value = record.get(field);
    if (value !== '' && value !== null && value !== undefined) metadata[field] = value;
    if (before) {
      const previous = before.get(field);
      if (previous !== value && previous !== '' && previous !== null && previous !== undefined) {
        metadata[`previous_${field}`] = previous;
      }
    }
  }
  return metadata;
}

function writeAudit(e, action, before) {
  const auditCollection = e.app.findCollectionByNameOrId('audit_events');
  const event = new Record(auditCollection);
  const collectionName = e.record.collection().name;
  const community = collectionName === 'communes' ? e.record.id : e.record.getString('community');
  if (community) event.set('community', community);
  if (e.auth && e.auth.collection().name === 'users') event.set('actor', e.auth.id);
  event.set('action', action);
  event.set('entityCollection', collectionName);
  event.set('entityId', e.record.id);
  event.set('metadata', auditMetadata(e.record, before));
  e.app.save(event);
}

module.exports = {
  digits,
  normalizedReference,
  normalizedRequestKey,
  isScopedService,
  hasCommunityRole,
  validateTenant,
  validatePickupBatch,
  validatePickupLine,
  validatePaymentAllocation,
  validateVerifiedPaymentImmutable,
  validateCourtesy,
  writeAudit,
};
