const IMPORT_SERVICE = '@request.auth.id != "" && @request.auth.disabled = false && @collection.users:importService.id ?= @request.auth.id && @collection.users:importService.disabled ?= false && @collection.users:importService.serviceAccount ?= true && @collection.users:importService.serviceScopes:each ?= "import"';
const PAYMENT_SERVICE = '@request.auth.id != "" && @request.auth.disabled = false && @collection.users:paymentService.id ?= @request.auth.id && @collection.users:paymentService.disabled ?= false && @collection.users:paymentService.serviceAccount ?= true && @collection.users:paymentService.serviceScopes:each ?= "payments"';
const CNE_SERVICE = '@request.auth.id != "" && @request.auth.disabled = false && @collection.users:cneService.id ?= @request.auth.id && @collection.users:cneService.disabled ?= false && @collection.users:cneService.serviceAccount ?= true && @collection.users:cneService.serviceScopes:each ?= "cne"';

function activeMember(alias, target) {
  return `@request.auth.id != "" && @request.auth.disabled = false && @collection.community_memberships:${alias}.user ?= @request.auth.id && @collection.community_memberships:${alias}.community ?= ${target} && @collection.community_memberships:${alias}.status ?= "active"`;
}

function activeManager(alias, target) {
  return `${activeMember(alias, target)} && (@collection.community_memberships:${alias}.role ?= "admin" || @collection.community_memberships:${alias}.role ?= "collaborator")`;
}

function activeAdmin(alias, target) {
  return `${activeMember(alias, target)} && @collection.community_memberships:${alias}.role ?= "admin"`;
}

function ownHousehold(alias, communityTarget = 'community', householdTarget = 'household') {
  return `${activeMember(alias, communityTarget)} && @collection.community_memberships:${alias}.household ?= ${householdTarget}`;
}

function or(...expressions) {
  return expressions.map((expression) => `(${expression})`).join(' || ');
}

function and(expression, suffix) {
  return `(${expression}) && ${suffix}`;
}

const COLLECTIONS = [
  'communes',
  'sectors',
  'import_batches',
  'households',
  'community_memberships',
  'membership_requests',
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
  'audit_events',
];

migrate((app) => {
  const created = {};
  const text = (name, options = {}) => ({ type: 'text', name, ...options });
  const bool = (name, options = {}) => ({ type: 'bool', name, ...options });
  const number = (name, options = {}) => ({ type: 'number', name, ...options });
  const date = (name, options = {}) => ({ type: 'date', name, ...options });
  const email = (name, options = {}) => ({ type: 'email', name, ...options });
  const json = (name, options = {}) => ({ type: 'json', name, ...options });
  const select = (name, values, options = {}) => ({ type: 'select', name, values, maxSelect: 1, ...options });
  const file = (name, options = {}) => ({
    type: 'file',
    name,
    maxSelect: 1,
    maxSize: 8 * 1024 * 1024,
    protected: true,
    ...options,
  });
  const relation = (name, collection, options = {}) => ({
    type: 'relation',
    name,
    collectionId: collection.id,
    maxSelect: 1,
    cascadeDelete: false,
    ...options,
  });
  const create = (name, fields, indexes = [], type = 'base', options = {}) => {
    const timestampedFields = type === 'base'
      ? [...fields,
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }]
      : fields;
    const collection = new Collection({ type, name, fields: timestampedFields, indexes, ...options });
    app.save(collection);
    created[name] = collection;
    return collection;
  };

  // PocketBase 0.39+ creates a default users auth collection during bootstrap.
  // Older clean instances may not have it, so support both paths without
  // deleting an existing auth collection during rollback.
  let users;
  try {
    users = app.findCollectionByNameOrId('users');
    const nameField = users.fields.getByName('name');
    if (nameField) {
      nameField.max = 120;
      nameField.presentable = true;
    } else {
      users.fields.add(new TextField({ name: 'name', max: 120, presentable: true }));
    }
    const avatarField = users.fields.getByName('avatar');
    if (avatarField) {
      avatarField.maxSelect = 1;
      avatarField.maxSize = 2 * 1024 * 1024;
      avatarField.mimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      avatarField.thumbs = ['96x96'];
      avatarField.protected = true;
    } else {
      users.fields.add(new FileField({ name: 'avatar', maxSelect: 1, maxSize: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: ['96x96'], protected: true }));
    }
    if (!users.fields.getByName('serviceAccount')) users.fields.add(new BoolField({ name: 'serviceAccount' }));
    else users.fields.getByName('serviceAccount').hidden = false;
    if (!users.fields.getByName('serviceScopes')) users.fields.add(new SelectField({ name: 'serviceScopes', values: ['import', 'payments', 'cne'], maxSelect: 3 }));
    else users.fields.getByName('serviceScopes').hidden = false;
    if (!users.fields.getByName('disabled')) users.fields.add(new BoolField({ name: 'disabled', hidden: true }));
    users.passwordAuth.enabled = true;
    users.passwordAuth.identityFields = ['email'];
    users.otp.enabled = false;
    app.save(users);
    created.users = users;
  } catch {
    users = create('users', [
      text('name', { max: 120, presentable: true }),
      file('avatar', { maxSize: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: ['96x96'] }),
      bool('serviceAccount'),
      select('serviceScopes', ['import', 'payments', 'cne'], { maxSelect: 3 }),
      bool('disabled', { hidden: true }),
    ], [], 'auth', {
      passwordAuth: { enabled: true, identityFields: ['email'] },
      otp: { enabled: false },
    });
  }

  const communes = create('communes', [
    text('code', { required: true, max: 30, pattern: '^[A-Z0-9][A-Z0-9-]*$' }),
    text('name', { required: true, max: 160, presentable: true }),
    text('legalName', { max: 200 }),
    select('status', ['active', 'review', 'inactive'], { required: true }),
    json('settings', { maxSize: 20000 }),
  ], [
    'CREATE UNIQUE INDEX idx_communes_code ON communes (code)',
    'CREATE INDEX idx_communes_status ON communes (status)',
  ]);

  const sectors = create('sectors', [
    relation('community', communes, { required: true }),
    text('code', { required: true, max: 40 }),
    text('name', { required: true, max: 160, presentable: true }),
    text('description', { max: 1000 }),
    select('status', ['active', 'review', 'inactive'], { required: true }),
  ], [
    'CREATE UNIQUE INDEX idx_sectors_community_code ON sectors (community, code)',
    'CREATE INDEX idx_sectors_community_status ON sectors (community, status)',
  ]);

  const importBatches = create('import_batches', [
    relation('community', communes, { required: true }),
    select('type', ['census', 'payments', 'census_and_payments'], { required: true }),
    json('sourceFiles', { required: true, maxSize: 20000 }),
    select('status', ['pending', 'processing', 'complete', 'failed'], { required: true }),
    json('summary', { maxSize: 100000 }),
    relation('importedBy', users, { required: true }),
    date('completedAt'),
    text('errorCode', { max: 100 }),
  ], [
    'CREATE INDEX idx_import_batches_community_created ON import_batches (community, created)',
    'CREATE INDEX idx_import_batches_status ON import_batches (status)',
  ]);

  const households = create('households', [
    relation('community', communes, { required: true }),
    relation('sector', sectors),
    relation('importBatch', importBatches),
    text('externalKey', { max: 160 }),
    text('code', { required: true, max: 60, presentable: true }),
    number('legacySequence', { min: 0, max: 1000000, onlyInt: true }),
    number('legacyBlock', { min: 0, max: 1000000, onlyInt: true }),
    text('address', { max: 500 }),
    text('reference', { max: 500 }),
    select('status', ['active', 'review', 'inactive', 'moved'], { required: true }),
    number('sourceRow', { min: 0, max: 10000000, onlyInt: true }),
  ], [
    'CREATE UNIQUE INDEX idx_households_community_code ON households (community, code)',
    "CREATE UNIQUE INDEX idx_households_external ON households (community, externalKey) WHERE externalKey != ''",
    'CREATE INDEX idx_households_sector_status ON households (sector, status)',
  ]);

  const memberships = create('community_memberships', [
    relation('user', users, { required: true }),
    relation('community', communes, { required: true }),
    relation('household', households),
    select('role', ['admin', 'collaborator', 'regular'], { required: true }),
    select('status', ['pending', 'active', 'suspended', 'revoked'], { required: true }),
    relation('approvedBy', users),
    date('approvedAt'),
    text('notes', { max: 1000 }),
  ], [
    'CREATE UNIQUE INDEX idx_memberships_community_user ON community_memberships (community, user)',
    'CREATE INDEX idx_memberships_user_status ON community_memberships (user, status)',
    'CREATE INDEX idx_memberships_community_role_status ON community_memberships (community, role, status)',
  ]);

  const membershipRequests = create('membership_requests', [
    relation('user', users, { required: true }),
    text('communityCode', { required: true, max: 30 }),
    text('idNumber', { required: true, max: 24 }),
    text('idNumberNormalized', { max: 24, hidden: true }),
    text('phone', { max: 24 }),
    select('status', ['pending', 'approved', 'rejected', 'cancelled'], { required: true }),
    relation('matchedCommunity', communes),
    relation('matchedHousehold', households),
    relation('reviewedBy', users),
    date('reviewedAt'),
    text('reviewNotes', { max: 1000 }),
  ], [
    'CREATE INDEX idx_membership_requests_user_status ON membership_requests (user, status)',
    'CREATE INDEX idx_membership_requests_code_status ON membership_requests (communityCode, status)',
    "CREATE UNIQUE INDEX idx_membership_requests_one_pending ON membership_requests (user, communityCode) WHERE status = 'pending'",
  ]);

  const residents = create('residents', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    relation('importBatch', importBatches),
    text('externalKey', { max: 200 }),
    text('firstName', { required: true, max: 120, presentable: true }),
    text('lastName', { required: true, max: 120, presentable: true }),
    text('idNumber', { max: 24 }),
    text('idNumberNormalized', { max: 24, hidden: true }),
    select('nationality', ['V', 'E', 'OTHER']),
    date('birthDate'),
    select('sex', ['F', 'M', 'X']),
    text('relationship', { max: 120 }),
    text('phone', { max: 24 }),
    text('phone1', { max: 24 }),
    text('phone2', { max: 24 }),
    email('email'),
    text('educationLevel', { max: 160 }),
    text('occupation', { max: 200 }),
    text('gasProvider', { max: 80 }),
    text('notes', { max: 2000 }),
    bool('isLegacyBeneficiary'),
    text('sourceSheet', { max: 120 }),
    number('sourceRow', { min: 0, max: 10000000, onlyInt: true }),
    select('status', ['active', 'review', 'inactive', 'moved', 'deceased'], { required: true }),
    relation('createdBy', users),
    relation('updatedBy', users),
    json('changeRequest', { maxSize: 20000 }),
  ], [
    "CREATE UNIQUE INDEX idx_residents_external ON residents (community, externalKey) WHERE externalKey != ''",
    "CREATE INDEX idx_residents_id_number ON residents (community, idNumberNormalized) WHERE idNumberNormalized != ''",
    'CREATE INDEX idx_residents_household_status ON residents (household, status)',
    'CREATE INDEX idx_residents_birth_date ON residents (community, birthDate)',
  ]);

  const residentChangeRequests = create('resident_change_requests', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    relation('resident', residents, { required: true }),
    relation('createdBy', users, { required: true }),
    json('changes', { required: true, maxSize: 20000 }),
    text('reason', { max: 1000 }),
    select('status', ['pending', 'approved', 'rejected', 'cancelled'], { required: true }),
    relation('reviewedBy', users),
    date('reviewedAt'),
    text('reviewNotes', { max: 1000 }),
  ], [
    'CREATE INDEX idx_resident_changes_community_status ON resident_change_requests (community, status)',
    'CREATE INDEX idx_resident_changes_resident_created ON resident_change_requests (resident, created)',
  ]);

  const cycles = create('distribution_cycles', [
    relation('community', communes, { required: true }),
    text('code', { required: true, max: 60 }),
    text('name', { required: true, max: 180, presentable: true }),
    date('paymentOpensAt'),
    date('paymentClosesAt'),
    date('distributionStartsAt'),
    date('distributionEndsAt'),
    number('unitPrice', { min: 0, max: 100000000 }),
    select('currency', ['VES', 'USD'], { required: true }),
    select('status', ['draft', 'payments_open', 'payments_closed', 'distribution', 'closed', 'cancelled'], { required: true }),
    text('notes', { max: 2000 }),
  ], [
    'CREATE UNIQUE INDEX idx_cycles_community_code ON distribution_cycles (community, code)',
    'CREATE INDEX idx_cycles_community_status ON distribution_cycles (community, status)',
  ]);

  const bagAllocations = create('bag_allocations', [
    relation('community', communes, { required: true }),
    relation('cycleRecord', cycles, { required: true }),
    relation('household', households, { required: true }),
    select('allocationType', ['standard', 'courtesy', 'adjustment'], { required: true }),
    number('quantity', { required: true, min: 1, max: 17, onlyInt: true }),
    select('status', ['allocated', 'paid', 'ready', 'delivered', 'cancelled'], { required: true }),
    relation('approvedBy', users),
    text('courtesyReason', { max: 500 }),
    text('notes', { max: 2000 }),
    relation('createdBy', users, { required: true }),
  ], [
    "CREATE UNIQUE INDEX idx_bag_alloc_standard ON bag_allocations (cycleRecord, household) WHERE allocationType = 'standard'",
    'CREATE INDEX idx_bag_alloc_community_status ON bag_allocations (community, status)',
  ]);

  const paymentReports = create('payment_reports', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    text('cycle', { required: true, max: 60 }),
    relation('cycleRecord', cycles),
    relation('reportedBy', users, { required: true }),
    number('amount', { required: true, min: 0.01, max: 100000000000 }),
    select('currency', ['VES', 'USD'], { required: true }),
    text('method', { required: true, max: 40 }),
    text('reference', { required: true, max: 80 }),
    text('referenceNormalized', { max: 80, hidden: true }),
    text('requestKey', { max: 120 }),
    file('receipt', { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }),
    select('status', ['pending_review', 'needs_info', 'verified', 'rejected', 'cancelled'], { required: true }),
    relation('reviewedBy', users),
    date('reviewedAt'),
    text('reviewNotes', { max: 1000 }),
    text('validatorExternalId', { max: 160, hidden: true }),
  ], [
    'CREATE INDEX idx_payment_reports_household_cycle ON payment_reports (household, cycle)',
    'CREATE INDEX idx_payment_reports_community_status ON payment_reports (community, status)',
    "CREATE INDEX idx_payment_reports_reference ON payment_reports (community, referenceNormalized) WHERE referenceNormalized != ''",
    "CREATE UNIQUE INDEX idx_payment_reports_request_key ON payment_reports (reportedBy, household, cycle, requestKey) WHERE requestKey != ''",
  ]);

  const paymentAllocations = create('payment_allocations', [
    relation('community', communes, { required: true }),
    relation('paymentReport', paymentReports, { required: true }),
    relation('bagAllocation', bagAllocations, { required: true }),
    number('amount', { required: true, min: 0.01, max: 100000000000 }),
    select('status', ['pending', 'applied', 'reversed'], { required: true }),
    relation('createdBy', users, { required: true }),
    text('notes', { max: 1000 }),
  ], [
    'CREATE UNIQUE INDEX idx_payment_alloc_pair ON payment_allocations (paymentReport, bagAllocation)',
    'CREATE INDEX idx_payment_alloc_community_status ON payment_allocations (community, status)',
  ]);

  const paymentImportStaging = create('payment_import_staging', [
    relation('community', communes, { required: true }),
    relation('importBatch', importBatches, { required: true }),
    text('externalKey', { required: true, max: 200 }),
    number('sourceRow', { required: true, min: 1, max: 10000000, onlyInt: true }),
    text('rawReference', { required: true, max: 160 }),
    number('amount', { required: true, min: 0.01, max: 100000000000 }),
    text('payerName', { max: 240 }),
    select('currency', ['VES', 'USD'], { required: true }),
    select('status', ['unmatched', 'matched', 'imported', 'ignored'], { required: true }),
    relation('matchedHousehold', households),
    relation('paymentReport', paymentReports),
    text('reviewNotes', { max: 1000 }),
  ], [
    'CREATE UNIQUE INDEX idx_payment_staging_external ON payment_import_staging (community, externalKey)',
    'CREATE INDEX idx_payment_staging_community_status ON payment_import_staging (community, status)',
  ]);

  const deliverySelfReports = create('delivery_self_reports', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    text('cycle', { required: true, max: 60 }),
    relation('cycleRecord', cycles),
    relation('reportedBy', users, { required: true }),
    text('requestKey', { max: 120 }),
    bool('delivered', { required: true }),
    text('notes', { max: 500 }),
    select('status', ['pending_review', 'confirmed', 'disputed', 'closed'], { required: true }),
    relation('reviewedBy', users),
    date('reviewedAt'),
  ], [
    'CREATE INDEX idx_delivery_self_household_cycle ON delivery_self_reports (household, cycle)',
    'CREATE INDEX idx_delivery_self_community_status ON delivery_self_reports (community, status)',
    "CREATE UNIQUE INDEX idx_delivery_self_request_key ON delivery_self_reports (reportedBy, household, cycle, requestKey) WHERE requestKey != ''",
  ]);

  const deliveryConfirmations = create('delivery_confirmations', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    text('cycle', { required: true, max: 60 }),
    relation('cycleRecord', cycles),
    relation('bagAllocation', bagAllocations),
    number('quantity', { required: true, min: 1, max: 17, onlyInt: true }),
    text('collectorIdNumber', { max: 24 }),
    text('collectorIdNumberNormalized', { max: 24, hidden: true }),
    select('deliveryType', ['direct', 'authorized_pickup', 'courtesy'], { required: true }),
    relation('confirmedBy', users, { required: true }),
    date('deliveredAt', { required: true }),
    file('evidence', { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }),
    text('notes', { max: 1000 }),
  ], [
    'CREATE INDEX idx_delivery_confirmations_household_cycle ON delivery_confirmations (household, cycle)',
    'CREATE INDEX idx_delivery_confirmations_community_created ON delivery_confirmations (community, created)',
  ]);

  const pickupAuthorizations = create('pickup_authorizations', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    text('cycle', { required: true, max: 60 }),
    relation('cycleRecord', cycles),
    relation('createdBy', users, { required: true }),
    text('requestKey', { max: 120 }),
    text('collectorIdNumber', { required: true, max: 24 }),
    text('collectorIdNumberNormalized', { max: 24, hidden: true }),
    number('bags', { required: true, min: 1, max: 17, onlyInt: true }),
    text('note', { max: 300 }),
    select('status', ['active', 'used', 'cancelled', 'expired'], { required: true }),
    relation('reviewedBy', users),
    date('usedAt'),
  ], [
    'CREATE INDEX idx_pickup_authorizations_collector_cycle ON pickup_authorizations (community, cycle, collectorIdNumberNormalized)',
    'CREATE INDEX idx_pickup_authorizations_household_status ON pickup_authorizations (household, status)',
    "CREATE UNIQUE INDEX idx_pickup_authorizations_request_key ON pickup_authorizations (createdBy, household, cycle, requestKey) WHERE requestKey != ''",
  ]);

  const pickupBatches = create('pickup_batches', [
    relation('community', communes, { required: true }),
    text('cycle', { required: true, max: 60 }),
    relation('cycleRecord', cycles),
    text('collectorIdNumber', { required: true, max: 24 }),
    text('collectorIdNumberNormalized', { max: 24, hidden: true }),
    number('declaredBags', { required: true, min: 1, max: 17, onlyInt: true }),
    select('status', ['draft', 'verified', 'delivered', 'cancelled'], { required: true }),
    relation('createdBy', users, { required: true }),
    relation('verifiedBy', users),
    date('deliveredAt'),
    file('evidence', { mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }),
    text('notes', { max: 1000 }),
  ], [
    "CREATE UNIQUE INDEX idx_pickup_batches_collector_cycle ON pickup_batches (community, cycle, collectorIdNumberNormalized) WHERE collectorIdNumberNormalized != '' AND status != 'cancelled'",
    'CREATE INDEX idx_pickup_batches_community_status ON pickup_batches (community, status)',
  ]);

  const pickupLines = create('pickup_lines', [
    relation('community', communes, { required: true }),
    relation('batch', pickupBatches, { required: true }),
    relation('household', households, { required: true }),
    relation('bagAllocation', bagAllocations),
    relation('authorization', pickupAuthorizations),
    number('quantity', { required: true, min: 1, max: 17, onlyInt: true }),
    select('lineType', ['own', 'authorized', 'courtesy'], { required: true }),
    text('notes', { max: 500 }),
  ], [
    'CREATE UNIQUE INDEX idx_pickup_lines_batch_household ON pickup_lines (batch, household)',
    'CREATE INDEX idx_pickup_lines_community_batch ON pickup_lines (community, batch)',
  ]);

  const surveyCampaigns = create('survey_campaigns', [
    relation('community', communes, { required: true }),
    text('key', { required: true, max: 80 }),
    text('name', { required: true, max: 180, presentable: true }),
    select('type', ['gas_demand', 'community', 'other'], { required: true }),
    json('schema', { maxSize: 50000 }),
    date('opensAt'),
    date('closesAt'),
    select('status', ['draft', 'open', 'closed', 'archived'], { required: true }),
    relation('createdBy', users, { required: true }),
  ], [
    'CREATE UNIQUE INDEX idx_survey_campaigns_community_key ON survey_campaigns (community, key)',
    'CREATE INDEX idx_survey_campaigns_community_status ON survey_campaigns (community, status)',
  ]);

  const surveyResponses = create('survey_responses', [
    relation('community', communes, { required: true }),
    relation('household', households, { required: true }),
    relation('campaign', surveyCampaigns),
    text('surveyKey', { required: true, max: 80 }),
    relation('createdBy', users, { required: true }),
    text('requestKey', { max: 120 }),
    json('data', { required: true, maxSize: 30000 }),
  ], [
    'CREATE INDEX idx_survey_responses_community_key ON survey_responses (community, surveyKey)',
    'CREATE INDEX idx_survey_responses_household_created ON survey_responses (household, created)',
    'CREATE UNIQUE INDEX idx_survey_responses_household_campaign ON survey_responses (community, household, surveyKey, campaign)',
    "CREATE UNIQUE INDEX idx_survey_responses_request_key ON survey_responses (createdBy, household, surveyKey, requestKey) WHERE requestKey != ''",
  ]);

  const communityReports = create('community_reports', [
    relation('community', communes, { required: true }),
    relation('household', households),
    relation('createdBy', users, { required: true }),
    select('category', ['Agua', 'Luz', 'Gas', 'Seguridad', 'Convivencia', 'Violencia intrafamiliar', 'Otro'], { required: true }),
    text('title', { required: true, max: 120, presentable: true }),
    text('description', { required: true, max: 1500 }),
    text('zone', { max: 120 }),
    select('privacy', ['community', 'private', 'restricted'], { required: true }),
    bool('identityReserved'),
    bool('urgent'),
    select('status', ['new', 'triage', 'in_progress', 'resolved', 'closed', 'rejected'], { required: true }),
    relation('assignedTo', users),
    file('attachments', { maxSelect: 3, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }),
    date('resolvedAt'),
  ], [
    'CREATE INDEX idx_community_reports_queue ON community_reports (community, privacy, status, urgent)',
    'CREATE INDEX idx_community_reports_creator ON community_reports (createdBy, created)',
  ]);

  const reportEvents = create('community_report_events', [
    relation('community', communes, { required: true }),
    relation('report', communityReports, { required: true }),
    relation('createdBy', users, { required: true }),
    select('type', ['comment', 'status_change', 'assignment', 'resolution'], { required: true }),
    text('message', { max: 2000 }),
    select('status', ['new', 'triage', 'in_progress', 'resolved', 'closed', 'rejected']),
    file('attachments', { maxSelect: 3, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }),
  ], [
    'CREATE INDEX idx_report_events_report_created ON community_report_events (report, created)',
    'CREATE INDEX idx_report_events_community_created ON community_report_events (community, created)',
  ]);

  const electoralProfiles = create('electoral_profiles', [
    relation('community', communes, { required: true }),
    relation('resident', residents, { required: true }),
    select('status', ['unknown', 'registered', 'not_registered', 'verification_error'], { required: true }),
    text('votingCenterName', { max: 300 }),
    text('votingCenterAddress', { max: 500 }),
    text('source', { max: 160 }),
    date('checkedAt'),
    date('consentAt', { required: true }),
    relation('checkedBy', users, { required: true }),
    text('providerReference', { max: 200, hidden: true }),
    text('errorCode', { max: 120, hidden: true }),
  ], [
    'CREATE UNIQUE INDEX idx_electoral_profiles_resident ON electoral_profiles (community, resident)',
    'CREATE INDEX idx_electoral_profiles_status ON electoral_profiles (community, status)',
  ]);

  const cneQueryAttempts = create('cne_query_attempts', [
    relation('community', communes, { required: true }),
    relation('resident', residents, { required: true }),
    relation('actor', users, { required: true }),
    date('consentAt', { required: true }),
    select('status', ['started', 'succeeded', 'failed', 'rate_limited'], { required: true }),
    text('provider', { max: 120 }),
    text('requestKey', { max: 120 }),
    text('errorCode', { max: 120, hidden: true }),
    date('completedAt'),
  ], [
    'CREATE INDEX idx_cne_attempts_actor_resident_created ON cne_query_attempts (actor, resident, created)',
    'CREATE INDEX idx_cne_attempts_community_created ON cne_query_attempts (community, created)',
    "CREATE UNIQUE INDEX idx_cne_attempts_request_key ON cne_query_attempts (actor, requestKey) WHERE requestKey != ''",
  ]);

  const toyCampaigns = create('toy_campaigns', [
    relation('community', communes, { required: true }),
    text('code', { required: true, max: 60 }),
    text('name', { required: true, max: 180, presentable: true }),
    number('minAge', { min: 0, max: 17, onlyInt: true }),
    number('maxAge', { min: 0, max: 17, onlyInt: true }),
    date('cutoffDate', { required: true }),
    select('status', ['draft', 'planning', 'distribution', 'closed', 'cancelled'], { required: true }),
    relation('createdBy', users, { required: true }),
    text('notes', { max: 2000 }),
  ], [
    'CREATE UNIQUE INDEX idx_toy_campaigns_community_code ON toy_campaigns (community, code)',
    'CREATE INDEX idx_toy_campaigns_community_status ON toy_campaigns (community, status)',
  ]);

  const toyAllocations = create('toy_allocations', [
    relation('community', communes, { required: true }),
    relation('campaign', toyCampaigns, { required: true }),
    relation('resident', residents, { required: true }),
    select('status', ['eligible', 'reserved', 'delivered', 'not_eligible', 'cancelled'], { required: true }),
    text('toyDescription', { max: 300 }),
    relation('deliveredBy', users),
    date('deliveredAt'),
    text('notes', { max: 1000 }),
  ], [
    'CREATE UNIQUE INDEX idx_toy_allocations_campaign_resident ON toy_allocations (campaign, resident)',
    'CREATE INDEX idx_toy_allocations_community_status ON toy_allocations (community, status)',
  ]);

  const auditEvents = create('audit_events', [
    relation('community', communes),
    relation('actor', users),
    text('action', { required: true, max: 80 }),
    text('entityCollection', { required: true, max: 120 }),
    text('entityId', { required: true, max: 40 }),
    json('metadata', { maxSize: 30000 }),
  ], [
    'CREATE INDEX idx_audit_events_community_created ON audit_events (community, created)',
    'CREATE INDEX idx_audit_events_entity ON audit_events (entityCollection, entityId, created)',
    'CREATE INDEX idx_audit_events_actor ON audit_events (actor, created)',
  ]);

  const applyRules = (collection, rules) => {
    collection.listRule = rules.listRule ?? null;
    collection.viewRule = rules.viewRule ?? null;
    collection.createRule = rules.createRule ?? null;
    collection.updateRule = rules.updateRule ?? null;
    collection.deleteRule = rules.deleteRule ?? null;
    try {
      app.save(collection);
    } catch (error) {
      throw new Error(`Reglas inválidas en ${collection.name}: ${error}`);
    }
  };

  users.authRule = 'disabled = false';
  users.manageRule = null;
  applyRules(users, {
    listRule: '@request.auth.id != "" && id = @request.auth.id',
    viewRule: '@request.auth.id != "" && id = @request.auth.id',
    createRule: '@request.context = "oauth2"',
    updateRule: '@request.auth.id != "" && id = @request.auth.id && @request.body.serviceAccount:changed = false && @request.body.serviceScopes:changed = false && @request.body.disabled:changed = false && @request.body.verified:changed = false',
  });

  const memberCommune = activeMember('communeMember', 'id');
  const adminCommune = activeAdmin('communeAdmin', 'id');
  applyRules(communes, {
    listRule: or(memberCommune, IMPORT_SERVICE),
    viewRule: or(memberCommune, IMPORT_SERVICE),
    createRule: IMPORT_SERVICE,
    updateRule: or(adminCommune, IMPORT_SERVICE),
  });

  const member = activeMember('member', 'community');
  const manager = activeManager('manager', 'community');
  const admin = activeAdmin('admin', 'community');
  const collaborator = `${activeMember('collaborator', 'community')} && @collection.community_memberships:collaborator.role ?= "collaborator"`;
  const own = ownHousehold('owner');
  const tenantImmutable = '@request.body.community:changed = false';

  applyRules(sectors, {
    listRule: or(member, IMPORT_SERVICE),
    viewRule: or(member, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(and(manager, tenantImmutable), and(IMPORT_SERVICE, tenantImmutable)),
    deleteRule: admin,
  });

  applyRules(importBatches, {
    listRule: or(IMPORT_SERVICE, activeAdmin('importAdmin', 'community')),
    viewRule: or(IMPORT_SERVICE, activeAdmin('importAdmin', 'community')),
    createRule: IMPORT_SERVICE,
    updateRule: and(IMPORT_SERVICE, tenantImmutable),
  });

  applyRules(households, {
    listRule: or(manager, ownHousehold('householdOwner', 'community', 'id'), IMPORT_SERVICE),
    viewRule: or(manager, ownHousehold('householdOwner', 'community', 'id'), IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(and(manager, tenantImmutable), and(IMPORT_SERVICE, tenantImmutable)),
    deleteRule: admin,
  });

  const membershipSelf = '@request.auth.id != "" && user = @request.auth.id';
  applyRules(memberships, {
    listRule: or(membershipSelf, admin),
    viewRule: or(membershipSelf, admin),
    createRule: admin,
    updateRule: and(admin, `${tenantImmutable} && @request.body.user:changed = false`),
    deleteRule: admin,
  });

  const requestAdmin = '@request.auth.id != "" && @collection.community_memberships:requestAdmin.user ?= @request.auth.id && @collection.community_memberships:requestAdmin.status ?= "active" && @collection.community_memberships:requestAdmin.role ?= "admin" && @collection.community_memberships:requestAdmin.community.code ?= communityCode';
  applyRules(membershipRequests, {
    listRule: or('@request.auth.id != "" && user = @request.auth.id', requestAdmin),
    viewRule: or('@request.auth.id != "" && user = @request.auth.id', requestAdmin),
    createRule: '@request.auth.id != "" && user = @request.auth.id && status = "pending"',
    updateRule: and(requestAdmin, '@request.body.user:changed = false && @request.body.communityCode:changed = false'),
    deleteRule: '@request.auth.id != "" && user = @request.auth.id && status = "pending"',
  });

  const regularResidentChangeOnly = and(own, [
    'status = "active"',
    '@request.body.changeRequest:changed = true',
    '@request.body.updatedBy = @request.auth.id',
    '@request.body.community:changed = false',
    '@request.body.household:changed = false',
    '@request.body.importBatch:changed = false',
    '@request.body.externalKey:changed = false',
    '@request.body.firstName:changed = false',
    '@request.body.lastName:changed = false',
    '@request.body.idNumber:changed = false',
    '@request.body.idNumberNormalized:changed = false',
    '@request.body.nationality:changed = false',
    '@request.body.birthDate:changed = false',
    '@request.body.sex:changed = false',
    '@request.body.relationship:changed = false',
    '@request.body.phone:changed = false',
    '@request.body.phone1:changed = false',
    '@request.body.phone2:changed = false',
    '@request.body.email:changed = false',
    '@request.body.educationLevel:changed = false',
    '@request.body.occupation:changed = false',
    '@request.body.gasProvider:changed = false',
    '@request.body.notes:changed = false',
    '@request.body.isLegacyBeneficiary:changed = false',
    '@request.body.sourceSheet:changed = false',
    '@request.body.sourceRow:changed = false',
    '@request.body.status:changed = false',
    '@request.body.createdBy:changed = false',
  ].join(' && '));
  applyRules(residents, {
    listRule: or(manager, own, IMPORT_SERVICE),
    viewRule: or(manager, own, IMPORT_SERVICE),
    createRule: or(manager, IMPORT_SERVICE),
    updateRule: or(
      and(admin, tenantImmutable),
      and(collaborator, `${tenantImmutable} && @request.body.household:changed = false && @request.body.importBatch:changed = false && @request.body.status:changed = false`),
      and(IMPORT_SERVICE, tenantImmutable),
      regularResidentChangeOnly,
    ),
    deleteRule: admin,
  });

  applyRules(residentChangeRequests, {
    listRule: or(manager, own),
    viewRule: or(manager, own),
    createRule: or(and(own, 'createdBy = @request.auth.id && status = "pending"'), and(manager, 'createdBy = @request.auth.id')),
    updateRule: and(manager, tenantImmutable),
    deleteRule: admin,
  });

  applyRules(cycles, {
    listRule: member,
    viewRule: member,
    createRule: manager,
    updateRule: and(manager, tenantImmutable),
    deleteRule: admin,
  });

  const bagView = or(manager, own, PAYMENT_SERVICE);
  const standardBagCreate = and(manager, 'allocationType != "courtesy" && createdBy = @request.auth.id');
  const courtesyBagCreate = and(admin, 'allocationType = "courtesy" && approvedBy = @request.auth.id && courtesyReason != "" && createdBy = @request.auth.id');
  const collaboratorBagUpdate = and(manager, 'allocationType != "courtesy" && @request.body.allocationType:changed = false && @request.body.approvedBy:changed = false && @request.body.courtesyReason:changed = false && @request.body.community:changed = false');
  applyRules(bagAllocations, {
    listRule: bagView,
    viewRule: bagView,
    createRule: or(standardBagCreate, courtesyBagCreate),
    updateRule: or(and(admin, tenantImmutable), collaboratorBagUpdate),
    deleteRule: admin,
  });

  const ownPaymentCreate = and(own, 'reportedBy = @request.auth.id && status = "pending_review"');
  const managerPaymentCreate = and(manager, 'reportedBy = @request.auth.id && status = "pending_review"');
  applyRules(paymentReports, {
    listRule: or(manager, own, PAYMENT_SERVICE),
    viewRule: or(manager, own, PAYMENT_SERVICE),
    createRule: or(ownPaymentCreate, managerPaymentCreate, PAYMENT_SERVICE),
    updateRule: or(
      and(manager, `${tenantImmutable} && @request.body.household:changed = false && @request.body.reportedBy:changed = false`),
      and(PAYMENT_SERVICE, `${tenantImmutable} && @request.body.household:changed = false && @request.body.reportedBy:changed = false`),
    ),
    deleteRule: admin,
  });

  applyRules(paymentAllocations, {
    listRule: or(manager, ownHousehold('paymentAllocationOwner', 'community', 'paymentReport.household'), PAYMENT_SERVICE),
    viewRule: or(manager, ownHousehold('paymentAllocationOwner', 'community', 'paymentReport.household'), PAYMENT_SERVICE),
    createRule: or(and(admin, 'createdBy = @request.auth.id'), and(PAYMENT_SERVICE, 'createdBy = @request.auth.id')),
    updateRule: or(
      and(admin, `${tenantImmutable} && @request.body.paymentReport:changed = false && @request.body.bagAllocation:changed = false && @request.body.createdBy:changed = false`),
      and(PAYMENT_SERVICE, `${tenantImmutable} && @request.body.paymentReport:changed = false && @request.body.bagAllocation:changed = false && @request.body.createdBy:changed = false`),
    ),
    deleteRule: or(admin, PAYMENT_SERVICE),
  });

  applyRules(paymentImportStaging, {
    listRule: or(admin, IMPORT_SERVICE),
    viewRule: or(admin, IMPORT_SERVICE),
    createRule: IMPORT_SERVICE,
    updateRule: or(and(admin, tenantImmutable), and(IMPORT_SERVICE, tenantImmutable)),
    deleteRule: or(admin, IMPORT_SERVICE),
  });

  applyRules(deliverySelfReports, {
    listRule: or(manager, own),
    viewRule: or(manager, own),
    createRule: and(own, 'reportedBy = @request.auth.id && status = "pending_review"'),
    updateRule: and(manager, `${tenantImmutable} && @request.body.household:changed = false && @request.body.reportedBy:changed = false`),
    deleteRule: admin,
  });

  applyRules(deliveryConfirmations, {
    listRule: or(manager, own),
    viewRule: or(manager, own),
    createRule: and(manager, 'confirmedBy = @request.auth.id'),
    updateRule: and(manager, `${tenantImmutable} && @request.body.household:changed = false`),
    deleteRule: admin,
  });

  applyRules(pickupAuthorizations, {
    listRule: or(manager, own),
    viewRule: or(manager, own),
    createRule: and(own, 'createdBy = @request.auth.id && status = "active" && bags >= 1 && bags <= 17'),
    updateRule: and(manager, `${tenantImmutable} && @request.body.household:changed = false && @request.body.createdBy:changed = false`),
    deleteRule: admin,
  });

  applyRules(pickupBatches, {
    listRule: manager,
    viewRule: manager,
    createRule: and(manager, 'createdBy = @request.auth.id && declaredBags >= 1 && declaredBags <= 17'),
    updateRule: and(manager, tenantImmutable),
    deleteRule: admin,
  });

  applyRules(pickupLines, {
    listRule: manager,
    viewRule: manager,
    createRule: and(manager, 'quantity >= 1 && quantity <= 17'),
    updateRule: and(manager, tenantImmutable),
    deleteRule: admin,
  });

  applyRules(surveyCampaigns, {
    listRule: member,
    viewRule: member,
    createRule: and(manager, 'createdBy = @request.auth.id'),
    updateRule: and(manager, tenantImmutable),
    deleteRule: admin,
  });

  applyRules(surveyResponses, {
    listRule: or(manager, own),
    viewRule: or(manager, own),
    createRule: and(own, 'createdBy = @request.auth.id'),
    updateRule: or(
      and(manager, `${tenantImmutable} && @request.body.household:changed = false && @request.body.createdBy:changed = false && @request.body.surveyKey:changed = false && @request.body.campaign:changed = false`),
      and(own, `${tenantImmutable} && @request.body.household:changed = false && @request.body.createdBy:changed = false && @request.body.surveyKey:changed = false && @request.body.campaign:changed = false`),
    ),
    deleteRule: admin,
  });

  const reportMember = activeMember('reportMember', 'community');
  const reportManager = activeManager('reportManager', 'community');
  const reportAdmin = activeAdmin('reportAdmin', 'community');
  const reportOwn = '@request.auth.id != "" && createdBy = @request.auth.id';
  const reportVisible = and(reportMember, or(
    'privacy = "community"',
    reportOwn,
    and(reportManager, 'privacy = "private"'),
    and(reportAdmin, 'privacy = "restricted"'),
  ));
  const reportCreate = or(
    and(ownHousehold('reportOwner'), 'createdBy = @request.auth.id'),
    and(reportManager, 'createdBy = @request.auth.id'),
  );
  const reportUpdate = or(
    and(reportAdmin, tenantImmutable),
    and(reportManager, 'privacy != "restricted" && @request.body.community:changed = false && @request.body.createdBy:changed = false'),
  );
  applyRules(communityReports, {
    listRule: reportVisible,
    viewRule: reportVisible,
    createRule: reportCreate,
    updateRule: reportUpdate,
    deleteRule: reportAdmin,
  });

  const eventMember = activeMember('eventMember', 'community');
  const eventManager = activeManager('eventManager', 'community');
  const eventAdmin = activeAdmin('eventAdmin', 'community');
  const eventVisible = and(eventMember, or(
    'report.privacy = "community"',
    'report.createdBy = @request.auth.id',
    and(eventManager, 'report.privacy = "private"'),
    and(eventAdmin, 'report.privacy = "restricted"'),
  ));
  const eventCreate = and(eventVisible, 'createdBy = @request.auth.id');
  applyRules(reportEvents, {
    listRule: eventVisible,
    viewRule: eventVisible,
    createRule: eventCreate,
    updateRule: and(eventManager, 'report.privacy != "restricted" && @request.body.community:changed = false && @request.body.report:changed = false && @request.body.createdBy:changed = false'),
    deleteRule: eventAdmin,
  });

  const ownElectoralProfile = ownHousehold('electoralOwner', 'community', 'resident.household');
  applyRules(electoralProfiles, {
    listRule: or(manager, ownElectoralProfile, CNE_SERVICE),
    viewRule: or(manager, ownElectoralProfile, CNE_SERVICE),
    createRule: CNE_SERVICE,
    updateRule: and(CNE_SERVICE, `${tenantImmutable} && @request.body.resident:changed = false`),
    deleteRule: admin,
  });

  const ownCneAttempt = ownHousehold('cneAttemptOwner', 'community', 'resident.household');
  applyRules(cneQueryAttempts, {
    listRule: or(admin, CNE_SERVICE),
    viewRule: or(admin, CNE_SERVICE),
    createRule: and(ownCneAttempt, 'actor = @request.auth.id && status = "started" && consentAt != ""'),
    updateRule: or(and(admin, `${tenantImmutable} && @request.body.resident:changed = false && @request.body.actor:changed = false`), and(CNE_SERVICE, `${tenantImmutable} && @request.body.resident:changed = false && @request.body.actor:changed = false`)),
  });

  applyRules(toyCampaigns, {
    listRule: member,
    viewRule: member,
    createRule: and(manager, 'createdBy = @request.auth.id'),
    updateRule: and(manager, tenantImmutable),
    deleteRule: admin,
  });

  applyRules(toyAllocations, {
    listRule: or(manager, ownHousehold('toyOwner', 'community', 'resident.household')),
    viewRule: or(manager, ownHousehold('toyOwner', 'community', 'resident.household')),
    createRule: manager,
    updateRule: and(manager, `${tenantImmutable} && @request.body.campaign:changed = false && @request.body.resident:changed = false`),
    deleteRule: admin,
  });

  applyRules(auditEvents, {
    listRule: activeAdmin('auditAdmin', 'community'),
    viewRule: activeAdmin('auditAdmin', 'community'),
  });
}, (app) => {
  for (const name of [...COLLECTIONS].reverse()) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch {
      // Allows a partial local rollback without masking the remaining collections.
    }
  }
  try {
    const users = app.findCollectionByNameOrId('users');
    for (const fieldName of ['serviceAccount', 'serviceScopes', 'disabled']) {
      const field = users.fields.getByName(fieldName);
      if (field) users.fields.removeById(field.id);
    }
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.authRule = '';
    app.save(users);
  } catch {
    // The auth collection may have been removed manually in a local sandbox.
  }
});
