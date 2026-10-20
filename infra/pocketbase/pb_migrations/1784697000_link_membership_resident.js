migrate((app) => {
  const IMPORT_SERVICE = '@request.auth.id != "" && @request.auth.disabled = false && @collection.users:importService.id ?= @request.auth.id && @collection.users:importService.disabled ?= false && @collection.users:importService.serviceAccount ?= true && @collection.users:importService.serviceScopes:each ?= "import"';
  const PAYMENT_SERVICE = '@request.auth.id != "" && @request.auth.disabled = false && @collection.users:paymentService.id ?= @request.auth.id && @collection.users:paymentService.disabled ?= false && @collection.users:paymentService.serviceAccount ?= true && @collection.users:paymentService.serviceScopes:each ?= "payments"';
  const activeMember = (alias, target) => `@request.auth.id != "" && @request.auth.disabled = false && @collection.community_memberships:${alias}.user ?= @request.auth.id && @collection.community_memberships:${alias}.community ?= ${target} && @collection.community_memberships:${alias}.status ?= "active"`;
  const activeManager = (alias, target) => `${activeMember(alias, target)} && (@collection.community_memberships:${alias}.role ?= "admin" || @collection.community_memberships:${alias}.role ?= "collaborator")`;
  const activeAdmin = (alias, target) => `${activeMember(alias, target)} && @collection.community_memberships:${alias}.role ?= "admin"`;
  const ownHousehold = (alias, communityTarget = 'community', householdTarget = 'household') => `${activeMember(alias, communityTarget)} && @collection.community_memberships:${alias}.household ?= ${householdTarget}`;
  const ownResident = (alias, communityTarget = 'community', residentTarget = 'resident') => `${activeMember(alias, communityTarget)} && @collection.community_memberships:${alias}.resident ?= ${residentTarget}`;
  const or = (...expressions) => expressions.map((expression) => `(${expression})`).join(' || ');
  const and = (expression, suffix) => `(${expression}) && ${suffix}`;

  const memberships = app.findCollectionByNameOrId('community_memberships');
  const residents = app.findCollectionByNameOrId('residents');

  memberships.fields.add(new RelationField({
    name: 'resident',
    collectionId: residents.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  memberships.indexes = [
    ...memberships.indexes,
    "CREATE UNIQUE INDEX idx_memberships_community_resident ON community_memberships (community, resident) WHERE resident != ''",
  ];
  app.save(memberships);

  // Tokens emitidos antes de deshabilitar una cuenta no deben conservar acceso
  // a ningún dato operacional, aunque el token criptográfico siga vigente.
  const protectedCollections = [
    'communes', 'sectors', 'import_batches', 'households', 'community_memberships',
    'membership_requests', 'residents', 'resident_change_requests', 'distribution_cycles',
    'bag_allocations', 'payment_reports', 'payment_allocations', 'payment_import_staging',
    'delivery_self_reports', 'delivery_confirmations', 'pickup_authorizations',
    'pickup_batches', 'pickup_lines', 'survey_campaigns', 'survey_responses',
    'community_reports', 'community_report_events', 'electoral_profiles',
    'cne_query_attempts', 'toy_campaigns', 'toy_allocations', 'audit_events',
  ];
  const ruleFields = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];
  for (let index = 0; index < protectedCollections.length; index += 1) {
    const collection = app.findCollectionByNameOrId(protectedCollections[index]);
    for (let ruleIndex = 0; ruleIndex < ruleFields.length; ruleIndex += 1) {
      const field = ruleFields[ruleIndex];
      const rule = collection[field];
      if (typeof rule === 'string' && rule && rule.indexOf('@request.auth.disabled') === -1) {
        collection[field] = `@request.auth.id != "" && @request.auth.disabled = false && (${rule})`;
      }
    }
    app.save(collection);
  }

  const manager = activeManager('manager', 'community');
  const admin = activeAdmin('admin', 'community');
  const own = ownHousehold('owner');
  residents.listRule = or(manager, own, IMPORT_SERVICE);
  residents.viewRule = or(manager, own, IMPORT_SERVICE);
  app.save(residents);

  const paymentAllocations = app.findCollectionByNameOrId('payment_allocations');
  paymentAllocations.createRule = or(
    and(admin, 'createdBy = @request.auth.id'),
    and(PAYMENT_SERVICE, 'createdBy = @request.auth.id'),
  );
  const immutablePaymentAllocation = '@request.body.community:changed = false && @request.body.paymentReport:changed = false && @request.body.bagAllocation:changed = false && @request.body.createdBy:changed = false';
  paymentAllocations.updateRule = or(
    and(admin, immutablePaymentAllocation),
    and(PAYMENT_SERVICE, immutablePaymentAllocation),
  );
  app.save(paymentAllocations);

  const cneAttempts = app.findCollectionByNameOrId('cne_query_attempts');
  const ownCneAttempt = ownResident('cneAttemptOwner');
  cneAttempts.createRule = and(ownCneAttempt, 'actor = @request.auth.id && status = "started" && consentAt != ""');
  app.save(cneAttempts);

  const electoralProfiles = app.findCollectionByNameOrId('electoral_profiles');
  const cneService = '@request.auth.id != "" && @request.auth.disabled = false && @collection.users:cneService.id ?= @request.auth.id && @collection.users:cneService.disabled ?= false && @collection.users:cneService.serviceAccount ?= true && @collection.users:cneService.serviceScopes:each ?= "cne"';
  electoralProfiles.listRule = or(manager, ownResident('electoralOwner'), cneService);
  electoralProfiles.viewRule = or(manager, ownResident('electoralOwner'), cneService);
  app.save(electoralProfiles);
}, (app) => {
  const memberships = app.findCollectionByNameOrId('community_memberships');
  memberships.indexes = memberships.indexes.filter((index) => !index.includes('idx_memberships_community_resident'));
  memberships.fields.removeByName('resident');
  app.save(memberships);
});
