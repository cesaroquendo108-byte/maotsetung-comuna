// Consolidated census model. The legacy households/residents collections remain
// intact for the existing CLAP workflows; this migration adds the explicit
// zone -> dwelling -> family -> person model required by the Uroprofin census.

const AUTH_ACTIVE = '@request.auth.id != "" && @request.auth.disabled = false';
const IMPORT_SERVICE = `${AUTH_ACTIVE} && @collection.users:consolidatedImport.id ?= @request.auth.id && @collection.users:consolidatedImport.serviceAccount ?= true && @collection.users:consolidatedImport.serviceScopes:each ?= "import"`;

function activeMember(alias, target = 'community') {
  return `${AUTH_ACTIVE} && @collection.community_memberships:${alias}.user ?= @request.auth.id && @collection.community_memberships:${alias}.community ?= ${target} && @collection.community_memberships:${alias}.status ?= "active"`;
}

function activeManager(alias, target = 'community') {
  return `${activeMember(alias, target)} && (@collection.community_memberships:${alias}.role ?= "admin" || @collection.community_memberships:${alias}.role ?= "collaborator")`;
}

function activeAdmin(alias, target = 'community') {
  return `${activeMember(alias, target)} && @collection.community_memberships:${alias}.role ?= "admin"`;
}

function or(...rules) {
  return rules.filter(Boolean).map((rule) => `(${rule})`).join(' || ');
}

function and(rule, suffix) {
  return `(${rule}) && ${suffix}`;
}

migrate((app) => {
  const created = [];
  const users = app.findCollectionByNameOrId('users');
  const communes = app.findCollectionByNameOrId('communes');
  const residents = app.findCollectionByNameOrId('residents');

  const text = (name, options = {}) => ({ type: 'text', name, ...options });
  const bool = (name, options = {}) => ({ type: 'bool', name, ...options });
  const number = (name, options = {}) => ({ type: 'number', name, ...options });
  const date = (name, options = {}) => ({ type: 'date', name, ...options });
  const json = (name, options = {}) => ({ type: 'json', name, ...options });
  const select = (name, values, options = {}) => ({ type: 'select', name, values, maxSelect: 1, ...options });
  const relation = (name, collection, options = {}) => ({
    type: 'relation', name, collectionId: collection.id, maxSelect: 1, cascadeDelete: false, ...options,
  });
  const createCollection = (name, fields, indexes = []) => {
    const collection = new Collection({
      type: 'base',
      name,
      fields: [...fields,
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }],
      indexes,
    });
    app.save(collection);
    created.push(collection);
    return collection;
  };
  const addResidentField = (field) => {
    if (!residents.fields.getByName(field.name)) residents.fields.add(field);
  };

  // These fields make the existing people collection carry source age and
  // provenance without replacing the older resident fields used by CLAP.
  addResidentField(new TextField({ name: 'source', max: 80 }));
  addResidentField(new NumberField({ name: 'ageSource', min: 0, max: 130, onlyInt: true }));
  addResidentField(new NumberField({ name: 'ageCurrent', min: 0, max: 130, onlyInt: true }));
  addResidentField(new SelectField({ name: 'idQuality', values: ['valid', 'empty', 'sentinel', 'invalid'], maxSelect: 1 }));
  addResidentField(new JSONField({ name: 'sourceValues', maxSize: 30000 }));
  app.save(residents);

  const existingServiceScopes = users.fields.getByName('serviceScopes');
  if (existingServiceScopes && !existingServiceScopes.values.includes('import')) {
    existingServiceScopes.values = [...existingServiceScopes.values, 'import'];
    app.save(users);
  }

  const censusImports = createCollection('census_imports', [
    relation('community', communes, { required: true }),
    text('fileName', { required: true, max: 240 }),
    text('lot', { required: true, max: 120 }),
    text('source', { required: true, max: 80 }),
    date('importedAt', { required: true }),
    select('status', ['preview', 'processing', 'complete', 'failed'], { required: true }),
    text('fingerprint', { required: true, max: 128 }),
    json('summary', { maxSize: 100000 }),
    json('errorSummary', { maxSize: 100000 }),
    relation('importedBy', users, { required: true }),
  ], [
    'CREATE UNIQUE INDEX idx_census_imports_community_fingerprint ON census_imports (community, fingerprint)',
    'CREATE INDEX idx_census_imports_community_created ON census_imports (community, created)',
  ]);

  const zones = createCollection('zones', [
    relation('community', communes, { required: true }),
    text('code', { required: true, max: 40 }),
    text('name', { required: true, max: 160, presentable: true }),
    number('sortOrder', { required: true, min: 1, max: 10000, onlyInt: true }),
    text('sourceSheet', { required: true, max: 160 }),
    text('reference', { max: 500 }),
    select('status', ['active', 'review', 'inactive'], { required: true }),
    text('notes', { max: 2000 }),
  ], [
    'CREATE UNIQUE INDEX idx_zones_community_code ON zones (community, code)',
    'CREATE INDEX idx_zones_community_status ON zones (community, status)',
  ]);

  const dwellings = createCollection('dwellings', [
    relation('community', communes, { required: true }),
    relation('zone', zones, { required: true }),
    relation('import', censusImports),
    text('externalKey', { required: true, max: 160 }),
    text('code', { required: true, max: 80, presentable: true }),
    text('street', { max: 240 }),
    text('staircase', { max: 120 }),
    text('house', { max: 120 }),
    text('reference', { max: 500 }),
    select('status', ['provisional', 'verified', 'merged', 'inactive'], { required: true }),
    relation('responsible', users),
    json('historicalCodes', { maxSize: 10000 }),
    text('sourceSheet', { max: 160 }),
    number('sourceRow', { min: 1, max: 10000000, onlyInt: true }),
  ], [
    'CREATE UNIQUE INDEX idx_dwellings_community_external ON dwellings (community, externalKey)',
    'CREATE UNIQUE INDEX idx_dwellings_community_code ON dwellings (community, code)',
    'CREATE INDEX idx_dwellings_zone_status ON dwellings (zone, status)',
  ]);
  dwellings.fields.add(new RelationField({ name: 'mergedInto', collectionId: dwellings.id, maxSelect: 1, cascadeDelete: false }));
  app.save(dwellings);

  const families = createCollection('families', [
    relation('community', communes, { required: true }),
    relation('zone', zones, { required: true }),
    relation('dwelling', dwellings, { required: true }),
    relation('import', censusImports),
    text('externalKey', { required: true, max: 160 }),
    number('legacyFamilyNumber', { required: true, min: 1, max: 1000000, onlyInt: true }),
    text('splitKey', { max: 160 }),
    number('splitSequence', { min: 0, max: 1000, onlyInt: true }),
    text('sourceSheet', { required: true, max: 160 }),
    number('sourceRow', { required: true, min: 1, max: 10000000, onlyInt: true }),
    number('totalDeclared', { min: 0, max: 10000, onlyInt: true }),
    number('totalReal', { required: true, min: 0, max: 10000, onlyInt: true }),
    select('reviewStatus', ['clear', 'review', 'resolved'], { required: true }),
    json('sourceValues', { maxSize: 30000 }),
    text('notes', { max: 2000 }),
  ], [
    'CREATE UNIQUE INDEX idx_families_community_external ON families (community, externalKey)',
    'CREATE INDEX idx_families_zone_legacy_number ON families (zone, legacyFamilyNumber)',
    'CREATE INDEX idx_families_dwelling_status ON families (dwelling, reviewStatus)',
  ]);

  const communityMemberships = app.findCollectionByNameOrId('community_memberships');
  if (!communityMemberships.fields.getByName('family')) communityMemberships.fields.add(new RelationField({ name: 'family', collectionId: families.id, maxSelect: 1, cascadeDelete: false }));
  if (!communityMemberships.fields.getByName('dwelling')) communityMemberships.fields.add(new RelationField({ name: 'dwelling', collectionId: dwellings.id, maxSelect: 1, cascadeDelete: false }));
  app.save(communityMemberships);

  const memberships = createCollection('family_memberships', [
    relation('community', communes, { required: true }),
    relation('family', families, { required: true }),
    relation('person', residents, { required: true }),
    relation('import', censusImports),
    text('relationship', { max: 120 }),
    bool('isResponsible'),
    select('status', ['active', 'review', 'moved', 'inactive'], { required: true }),
    date('joinedAt'),
    date('leftAt'),
    number('sourceRow', { min: 1, max: 10000000, onlyInt: true }),
    json('sourceValues', { maxSize: 30000 }),
  ], [
    'CREATE UNIQUE INDEX idx_family_memberships_family_person ON family_memberships (family, person)',
    'CREATE INDEX idx_family_memberships_community_status ON family_memberships (community, status)',
    'CREATE INDEX idx_family_memberships_person ON family_memberships (person, status)',
  ]);

  const verificationCases = createCollection('verification_cases', [
    relation('community', communes, { required: true }),
    text('externalKey', { required: true, max: 160 }),
    select('type', ['link_request', 'new_dwelling', 'duplicate_id', 'duplicate_phone', 'declared_mismatch', 'age_inconsistent', 'unassigned_person', 'correction'], { required: true }),
    relation('zone', zones),
    relation('dwelling', dwellings),
    relation('family', families),
    relation('person', residents),
    relation('requestedBy', users),
    select('status', ['pending', 'approved', 'rejected', 'review', 'resolved'], { required: true }),
    json('query', { maxSize: 20000 }),
    json('resolution', { maxSize: 20000 }),
    relation('reviewedBy', users),
    date('reviewedAt'),
    text('notes', { max: 3000 }),
  ], [
    'CREATE UNIQUE INDEX idx_verification_cases_community_external ON verification_cases (community, externalKey)',
    'CREATE INDEX idx_verification_cases_community_status ON verification_cases (community, status)',
    'CREATE INDEX idx_verification_cases_entity ON verification_cases (family, dwelling, person)',
  ]);

  const gasPeriods = createCollection('gas_periods', [
    relation('community', communes, { required: true }),
    text('code', { required: true, max: 80 }),
    text('name', { required: true, max: 160, presentable: true }),
    date('opensAt'),
    date('closesAt'),
    select('status', ['draft', 'open', 'review', 'closed', 'cancelled'], { required: true }),
    text('notes', { max: 2000 }),
  ], [
    'CREATE UNIQUE INDEX idx_gas_periods_community_code ON gas_periods (community, code)',
    'CREATE INDEX idx_gas_periods_community_status ON gas_periods (community, status)',
  ]);

  const gasRegistrations = createCollection('gas_registrations', [
    relation('community', communes, { required: true }),
    relation('period', gasPeriods, { required: true }),
    relation('family', families, { required: true }),
    relation('dwelling', dwellings, { required: true }),
    relation('requestedBy', users, { required: true }),
    select('status', ['pending', 'review', 'approved', 'rejected', 'cancelled'], { required: true }),
    bool('pendingLink'),
    bool('needsRefill'),
    date('registeredAt', { required: true }),
    text('observations', { max: 3000 }),
    relation('reviewedBy', users),
    date('reviewedAt'),
  ], [
    'CREATE UNIQUE INDEX idx_gas_registrations_period_family ON gas_registrations (period, family)',
    'CREATE INDEX idx_gas_registrations_community_status ON gas_registrations (community, status)',
  ]);

  const gasCylinders = createCollection('gas_cylinders', [
    relation('community', communes, { required: true }),
    relation('registration', gasRegistrations, { required: true }),
    text('type', { required: true, max: 80 }),
    text('size', { required: true, max: 40 }),
    select('provider', ['Gas Caracas', 'PDVSA', 'Gas Comunal', 'otro'], { required: true }),
    select('condition', ['own', 'borrowed', 'damaged', 'missing', 'shared'], { required: true }),
    bool('needsRefill'),
    bool('shared'),
    text('observations', { max: 2000 }),
  ], [
    'CREATE INDEX idx_gas_cylinders_registration ON gas_cylinders (registration)',
    'CREATE INDEX idx_gas_cylinders_community_provider ON gas_cylinders (community, provider)',
  ]);

  const member = activeMember('consolidatedMember');
  const manager = activeManager('consolidatedManager');
  const admin = activeAdmin('consolidatedAdmin');
  const ownerCase = `${AUTH_ACTIVE} && requestedBy = @request.auth.id`;

  const applyRules = (collection, rules) => {
    collection.listRule = rules.listRule ?? null;
    collection.viewRule = rules.viewRule ?? null;
    collection.createRule = rules.createRule ?? null;
    collection.updateRule = rules.updateRule ?? null;
    collection.deleteRule = rules.deleteRule ?? null;
    app.save(collection);
  };

  applyRules(censusImports, {
    listRule: or(IMPORT_SERVICE, activeAdmin('consolidatedImportAdmin')),
    viewRule: or(IMPORT_SERVICE, activeAdmin('consolidatedImportViewer')),
    createRule: IMPORT_SERVICE,
    updateRule: IMPORT_SERVICE,
  });
  applyRules(zones, {
    listRule: or(member, IMPORT_SERVICE),
    viewRule: or(member, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(admin, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(dwellings, {
    listRule: or(manager, IMPORT_SERVICE),
    viewRule: or(manager, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(admin, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(families, {
    listRule: or(manager, IMPORT_SERVICE),
    viewRule: or(manager, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(admin, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(memberships, {
    listRule: or(manager, IMPORT_SERVICE),
    viewRule: or(manager, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(admin, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(verificationCases, {
    listRule: or(manager, ownerCase),
    viewRule: or(manager, ownerCase),
    createRule: or(and(member, 'requestedBy = @request.auth.id'), IMPORT_SERVICE),
    updateRule: or(manager, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(gasPeriods, {
    listRule: or(member, IMPORT_SERVICE),
    viewRule: or(member, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(manager, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(gasRegistrations, {
    listRule: or(manager, ownerCase),
    viewRule: or(manager, ownerCase),
    createRule: or(and(member, 'requestedBy = @request.auth.id'), IMPORT_SERVICE),
    updateRule: or(manager, IMPORT_SERVICE),
    deleteRule: admin,
  });
  applyRules(gasCylinders, {
    listRule: or(manager, IMPORT_SERVICE),
    viewRule: or(manager, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(manager, IMPORT_SERVICE),
    deleteRule: admin,
  });

  // Add immutable source identity fields to the auth collection only when the
  // instance does not already expose them as controlled service metadata.
  if (!users.fields.getByName('serviceScopes')) users.fields.add(new SelectField({ name: 'serviceScopes', values: ['import'], maxSelect: 3 }));
  app.save(users);
}, (app) => {
  const names = ['gas_cylinders', 'gas_registrations', 'gas_periods', 'verification_cases', 'family_memberships', 'families', 'dwellings', 'zones', 'census_imports'];
  for (const name of names) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch { /* already absent */ }
  }
  const residents = app.findCollectionByNameOrId('residents');
  const communityMemberships = app.findCollectionByNameOrId('community_memberships');
  for (const name of ['family', 'dwelling']) {
    try { communityMemberships.fields.removeByName(name); } catch { /* already absent */ }
  }
  app.save(communityMemberships);
  for (const name of ['source', 'ageSource', 'ageCurrent', 'idQuality', 'sourceValues']) {
    try { residents.fields.removeByName(name); } catch { /* already absent */ }
  }
  app.save(residents);
});
