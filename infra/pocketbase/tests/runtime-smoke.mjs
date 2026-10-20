import PocketBase from 'pocketbase';

const url = process.env.PB_QA_URL;
const superuserEmail = process.env.PB_QA_SUPERUSER;
const superuserPassword = process.env.PB_QA_SUPERPASS;
const userPassword = process.env.PB_QA_USERPASS;

if (!url || !superuserEmail || !superuserPassword || !userPassword) {
  throw new Error('Faltan variables PB_QA_URL, PB_QA_SUPERUSER, PB_QA_SUPERPASS o PB_QA_USERPASS.');
}

const superPb = new PocketBase(url);
superPb.autoCancellation(false);
await superPb.collection('_superusers').authWithPassword(superuserEmail, superuserPassword);

const commune = await superPb.collection('communes').create({ code: 'QA-001', name: 'Comuna QA', status: 'active' });
const sector = await superPb.collection('sectors').create({ community: commune.id, code: 'BASE', name: 'Base', status: 'active' });
const household1 = await superPb.collection('households').create({ community: commune.id, sector: sector.id, code: 'QA-H-001', status: 'active' });
const household2 = await superPb.collection('households').create({ community: commune.id, sector: sector.id, code: 'QA-H-002', status: 'active' });

const makeUser = (email, name) => superPb.collection('users').create({
  email,
  password: userPassword,
  passwordConfirm: userPassword,
  verified: true,
  name,
});
const adminUser = await makeUser('admin@uroprofin.invalid', 'Admin QA');
const collaboratorUser = await makeUser('collaborator@uroprofin.invalid', 'Colaborador QA');
const regularUser = await makeUser('regular@uroprofin.invalid', 'Regular QA');
const cneServiceUser = await superPb.collection('users').create({
  email: 'cne-service@uroprofin.invalid',
  password: userPassword,
  passwordConfirm: userPassword,
  verified: true,
  name: 'Servicio CNE QA',
  serviceAccount: true,
  serviceScopes: ['cne'],
});
await superPb.collection('community_memberships').create({ user: adminUser.id, community: commune.id, household: household1.id, role: 'admin', status: 'active' });
await superPb.collection('community_memberships').create({ user: collaboratorUser.id, community: commune.id, household: household1.id, role: 'collaborator', status: 'active' });
const regularMembership = await superPb.collection('community_memberships').create({ user: regularUser.id, community: commune.id, household: household1.id, role: 'regular', status: 'active' });

const residentOwn = await superPb.collection('residents').create({ community: commune.id, household: household1.id, firstName: 'Persona', lastName: 'Propia', idNumber: 'V-123', nationality: 'V', status: 'active' });
const residentFamily = await superPb.collection('residents').create({ community: commune.id, household: household1.id, firstName: 'Persona', lastName: 'Familiar', idNumber: 'V-124', nationality: 'V', status: 'active' });
const residentOther = await superPb.collection('residents').create({ community: commune.id, household: household2.id, firstName: 'Persona', lastName: 'Ajena', idNumber: 'V-456', nationality: 'V', status: 'active' });
const residentRoleTest = await superPb.collection('residents').create({ community: commune.id, household: household2.id, firstName: 'Prueba', lastName: 'Roles', idNumber: 'V-789', nationality: 'V', status: 'active' });
await superPb.collection('community_memberships').update(regularMembership.id, { resident: residentOwn.id });

const collaboratorPb = new PocketBase(url);
collaboratorPb.autoCancellation(false);
await collaboratorPb.collection('users').authWithPassword('collaborator@uroprofin.invalid', userPassword);
let emptyResidentNameBlocked = false;
try {
  await collaboratorPb.collection('residents').create({
    community: commune.id,
    household: household1.id,
    firstName: ' ',
    lastName: ' ',
    status: 'review',
  });
} catch (error) {
  emptyResidentNameBlocked = error.status === 400;
}
const collaboratorEdit = await collaboratorPb.collection('residents').update(residentRoleTest.id, { phone: '04120000000' });
let collaboratorStatusBlocked = false;
try {
  await collaboratorPb.collection('residents').update(residentRoleTest.id, { status: 'inactive' });
} catch (error) {
  collaboratorStatusBlocked = error.status >= 400;
}
let collaboratorDeleteBlocked = false;
try {
  await collaboratorPb.collection('residents').delete(residentRoleTest.id);
} catch (error) {
  collaboratorDeleteBlocked = error.status >= 400;
}

const regularPb = new PocketBase(url);
regularPb.autoCancellation(false);
await regularPb.collection('users').authWithPassword('regular@uroprofin.invalid', userPassword);

const paymentBody = {
  community: commune.id,
  household: household1.id,
  cycle: 'active',
  reportedBy: regularUser.id,
  amount: 800,
  currency: 'VES',
  method: 'Pago movil',
  reference: '00123',
  requestKey: 'qa-payment-1',
  status: 'pending_review',
};
const payment = await regularPb.collection('payment_reports').create(paymentBody);
let duplicatePaymentBlocked = false;
try {
  await regularPb.collection('payment_reports').create(paymentBody);
} catch (error) {
  duplicatePaymentBlocked = error.status === 400;
}

const restrictedReport = await regularPb.collection('community_reports').create({
  community: commune.id,
  household: household1.id,
  createdBy: regularUser.id,
  category: 'Violencia intrafamiliar',
  title: 'QA sensible',
  description: 'Prueba temporal',
  zone: 'QA',
  privacy: 'community',
  urgent: false,
  status: 'new',
});
const securityReport = await regularPb.collection('community_reports').create({
  community: commune.id,
  household: household1.id,
  createdBy: regularUser.id,
  category: 'Seguridad',
  title: 'QA seguridad',
  description: 'Prueba temporal',
  zone: 'QA',
  privacy: 'community',
  urgent: false,
  status: 'new',
});

const gasResponse = await regularPb.collection('survey_responses').create({
  community: commune.id,
  household: household1.id,
  surveyKey: 'gas-demand',
  createdBy: regularUser.id,
  requestKey: 'qa-gas-1',
  data: { provider: 'Gas Caracas', wantsRefill: true, cylinders: 1 },
});
const gasResponseUpdated = await regularPb.collection('survey_responses').update(gasResponse.id, {
  requestKey: 'qa-gas-2',
  data: { provider: 'Gas Caracas', wantsRefill: true, cylinders: 2 },
});
let duplicateGasSurveyBlocked = false;
try {
  await regularPb.collection('survey_responses').create({
    community: commune.id,
    household: household1.id,
    surveyKey: 'gas-demand',
    createdBy: regularUser.id,
    requestKey: 'qa-gas-3',
    data: { provider: 'Gas Comunal / PDVSA', wantsRefill: false, cylinders: 0 },
  });
} catch (error) {
  duplicateGasSurveyBlocked = error.status >= 400;
}

let pickup18Blocked = false;
try {
  await regularPb.collection('pickup_authorizations').create({ community: commune.id, household: household1.id, cycle: 'active', createdBy: regularUser.id, requestKey: 'qa-pickup-18', collectorIdNumber: 'V-123', bags: 18, status: 'active' });
} catch (error) {
  pickup18Blocked = error.status === 400;
}

const consentAt = new Date().toISOString();
let regularProfileWriteBlocked = false;
try {
  await regularPb.collection('electoral_profiles').create({ community: commune.id, resident: residentOwn.id, status: 'registered', votingCenterName: 'Centro falso', source: 'cliente', checkedAt: consentAt, consentAt, checkedBy: regularUser.id });
} catch (error) {
  regularProfileWriteBlocked = error.status >= 400;
}
const cneServicePb = new PocketBase(url);
cneServicePb.autoCancellation(false);
await cneServicePb.collection('users').authWithPassword('cne-service@uroprofin.invalid', userPassword);
let cneServiceResidentListBlocked = false;
try {
  const serviceResidents = await cneServicePb.collection('residents').getList(1, 1);
  if (serviceResidents.totalItems !== 0) throw new Error('La cuenta CNE pudo enumerar residentes.');
  await cneServicePb.collection('residents').getOne(residentOwn.id);
} catch (error) {
  cneServiceResidentListBlocked = error.status >= 400;
}
const trustedProfile = await cneServicePb.collection('electoral_profiles').create({ community: commune.id, resident: residentOwn.id, status: 'registered', votingCenterName: 'Centro QA', votingCenterAddress: 'QA', source: 'qa-service', checkedAt: consentAt, consentAt, checkedBy: regularUser.id });
let otherHouseholdCneBlocked = false;
try {
  await regularPb.collection('cne_query_attempts').create({ community: commune.id, resident: residentOther.id, actor: regularUser.id, consentAt, status: 'started', requestKey: 'qa-cne-other-household' });
} catch (error) {
  otherHouseholdCneBlocked = error.status >= 400;
}
let sameHouseholdCneBlocked = false;
try {
  await regularPb.collection('cne_query_attempts').create({ community: commune.id, resident: residentFamily.id, actor: regularUser.id, consentAt, status: 'started', requestKey: 'qa-cne-family-member' });
} catch (error) {
  sameHouseholdCneBlocked = error.status >= 400;
}

let cneRateLimited = false;
for (let index = 0; index < 6; index += 1) {
  try {
    await regularPb.collection('cne_query_attempts').create({ community: commune.id, resident: residentOwn.id, actor: regularUser.id, consentAt, status: 'started', requestKey: `qa-cne-${index}` });
  } catch (error) {
    if (error.status === 429) cneRateLimited = true;
  }
}
await superPb.collection('users').update(cneServiceUser.id, { disabled: true });
let disabledServiceBlocked = false;
try {
  await cneServicePb.collection('electoral_profiles').getOne(trustedProfile.id);
} catch (error) {
  disabledServiceBlocked = error.status >= 400;
}

const adminPb = new PocketBase(url);
adminPb.autoCancellation(false);
await adminPb.collection('users').authWithPassword('admin@uroprofin.invalid', userPassword);
const adminStatusEdit = await adminPb.collection('residents').update(residentRoleTest.id, { status: 'inactive' });
await adminPb.collection('residents').delete(residentRoleTest.id);
const cycle = await adminPb.collection('distribution_cycles').create({ community: commune.id, code: 'QA-CYCLE', name: 'Ciclo QA', currency: 'VES', status: 'draft' });
const standardAllocation1 = await adminPb.collection('bag_allocations').create({ community: commune.id, cycleRecord: cycle.id, household: household1.id, allocationType: 'standard', quantity: 17, status: 'allocated', createdBy: adminUser.id });
const standardAllocation2 = await adminPb.collection('bag_allocations').create({ community: commune.id, cycleRecord: cycle.id, household: household2.id, allocationType: 'standard', quantity: 17, status: 'allocated', createdBy: adminUser.id });
const adjustmentAllocation1 = await adminPb.collection('bag_allocations').create({ community: commune.id, cycleRecord: cycle.id, household: household1.id, allocationType: 'adjustment', quantity: 1, status: 'allocated', createdBy: adminUser.id });
const reconciliationPayment = await adminPb.collection('payment_reports').create({ community: commune.id, household: household1.id, cycle: 'QA-CYCLE', cycleRecord: cycle.id, reportedBy: adminUser.id, amount: 800, currency: 'VES', method: 'QA', reference: 'QA-VERIFIED', requestKey: 'qa-verified-payment', status: 'pending_review' });
await adminPb.collection('payment_reports').update(reconciliationPayment.id, { status: 'verified' });
let verifiedPaymentMutationBlocked = false;
try {
  await adminPb.collection('payment_reports').update(reconciliationPayment.id, { amount: 801 });
} catch (error) {
  verifiedPaymentMutationBlocked = error.status >= 400;
}
let collaboratorAllocationBlocked = false;
try {
  await collaboratorPb.collection('payment_allocations').create({ community: commune.id, paymentReport: reconciliationPayment.id, bagAllocation: standardAllocation1.id, amount: 100, status: 'applied', createdBy: collaboratorUser.id });
} catch (error) {
  collaboratorAllocationBlocked = error.status >= 400;
}
await adminPb.collection('payment_allocations').create({ community: commune.id, paymentReport: reconciliationPayment.id, bagAllocation: standardAllocation1.id, amount: 500, status: 'applied', createdBy: adminUser.id });
let overAllocationBlocked = false;
try {
  await adminPb.collection('payment_allocations').create({ community: commune.id, paymentReport: reconciliationPayment.id, bagAllocation: adjustmentAllocation1.id, amount: 400, status: 'applied', createdBy: adminUser.id });
} catch (error) {
  overAllocationBlocked = error.status >= 400;
}
let crossHouseholdAllocationBlocked = false;
try {
  await adminPb.collection('payment_allocations').create({ community: commune.id, paymentReport: reconciliationPayment.id, bagAllocation: standardAllocation2.id, amount: 100, status: 'applied', createdBy: adminUser.id });
} catch (error) {
  crossHouseholdAllocationBlocked = error.status >= 400;
}
const courtesy = await adminPb.collection('bag_allocations').create({ community: commune.id, cycleRecord: cycle.id, household: household2.id, allocationType: 'courtesy', quantity: 1, status: 'allocated', approvedBy: adminUser.id, courtesyReason: 'QA', createdBy: adminUser.id });
const batch = await adminPb.collection('pickup_batches').create({ community: commune.id, cycle: 'QA-CYCLE', cycleRecord: cycle.id, collectorIdNumber: 'V-123', declaredBags: 17, status: 'draft', createdBy: adminUser.id });
await adminPb.collection('pickup_lines').create({ community: commune.id, batch: batch.id, household: household1.id, bagAllocation: standardAllocation1.id, quantity: 10, lineType: 'own' });
const authorization = await superPb.collection('pickup_authorizations').create({ community: commune.id, household: household2.id, cycle: 'QA-CYCLE', cycleRecord: cycle.id, createdBy: regularUser.id, collectorIdNumber: 'V-123', bags: 8, status: 'active' });
let aggregate18Blocked = false;
try {
  await adminPb.collection('pickup_lines').create({ community: commune.id, batch: batch.id, household: household2.id, bagAllocation: standardAllocation2.id, authorization: authorization.id, quantity: 8, lineType: 'authorized' });
} catch (error) {
  aggregate18Blocked = error.status === 400;
}
const identityBatch = await adminPb.collection('pickup_batches').create({ community: commune.id, cycle: 'QA-CYCLE', cycleRecord: cycle.id, collectorIdNumber: 'V-124', declaredBags: 8, status: 'draft', createdBy: adminUser.id });
let ownWithoutAllocationBlocked = false;
try {
  await adminPb.collection('pickup_lines').create({ community: commune.id, batch: identityBatch.id, household: household1.id, quantity: 1, lineType: 'own' });
} catch (error) {
  ownWithoutAllocationBlocked = error.status >= 400;
}
const mismatchedCollectorAuthorization = await superPb.collection('pickup_authorizations').create({ community: commune.id, household: household2.id, cycle: 'QA-CYCLE', cycleRecord: cycle.id, createdBy: regularUser.id, collectorIdNumber: 'V-456', bags: 1, status: 'active' });
let collectorMismatchBlocked = false;
try {
  await adminPb.collection('pickup_lines').create({ community: commune.id, batch: identityBatch.id, household: household2.id, bagAllocation: standardAllocation2.id, authorization: mismatchedCollectorAuthorization.id, quantity: 1, lineType: 'authorized' });
} catch (error) {
  collectorMismatchBlocked = error.status >= 400;
}
let reusedAllocationBlocked = false;
try {
  await adminPb.collection('pickup_lines').create({ community: commune.id, batch: identityBatch.id, household: household1.id, bagAllocation: standardAllocation1.id, quantity: 8, lineType: 'own' });
} catch (error) {
  reusedAllocationBlocked = error.status >= 400;
}
const mismatchBatch = await adminPb.collection('pickup_batches').create({ community: commune.id, cycle: 'QA-CYCLE', cycleRecord: cycle.id, collectorIdNumber: 'V-998', declaredBags: 1, status: 'draft', createdBy: adminUser.id });
let mismatchedAllocationBlocked = false;
try {
  await adminPb.collection('pickup_lines').create({ community: commune.id, batch: mismatchBatch.id, household: household1.id, bagAllocation: courtesy.id, quantity: 1, lineType: 'courtesy' });
} catch (error) {
  mismatchedAllocationBlocked = error.status >= 400;
}

const audits = await adminPb.collection('audit_events').getList(1, 50);
const result = {
  duplicatePaymentBlocked,
  emptyResidentNameBlocked,
  collaboratorEditAllowed: collaboratorEdit.phone === '04120000000',
  collaboratorStatusBlocked,
  collaboratorDeleteBlocked,
  adminStatusAllowed: adminStatusEdit.status === 'inactive',
  restrictedPrivacy: restrictedReport.privacy,
  identityReserved: restrictedReport.identityReserved,
  securityPrivacy: securityReport.privacy,
  gasSurveyUpdated: Number(gasResponseUpdated.data?.cylinders) === 2,
  duplicateGasSurveyBlocked,
  pickup18Blocked,
  otherHouseholdCneBlocked,
  sameHouseholdCneBlocked,
  cneRateLimited,
  cneServiceResidentListBlocked,
  disabledServiceBlocked,
  regularProfileWriteBlocked,
  trustedProfileCreated: trustedProfile.status === 'registered' && trustedProfile.source === 'qa-service',
  courtesyApproverRecorded: courtesy.approvedBy === adminUser.id,
  aggregate18Blocked,
  ownWithoutAllocationBlocked,
  collectorMismatchBlocked,
  reusedAllocationBlocked,
  mismatchedAllocationBlocked,
  verifiedPaymentMutationBlocked,
  collaboratorAllocationBlocked,
  overAllocationBlocked,
  crossHouseholdAllocationBlocked,
  auditEvents: audits.totalItems,
};

const expected = duplicatePaymentBlocked
  && emptyResidentNameBlocked
  && collaboratorEdit.phone === '04120000000'
  && collaboratorStatusBlocked
  && collaboratorDeleteBlocked
  && adminStatusEdit.status === 'inactive'
  && restrictedReport.privacy === 'restricted'
  && restrictedReport.identityReserved === true
  && securityReport.privacy === 'restricted'
  && Number(gasResponseUpdated.data?.cylinders) === 2
  && duplicateGasSurveyBlocked
  && pickup18Blocked
  && otherHouseholdCneBlocked
  && sameHouseholdCneBlocked
  && cneRateLimited
  && cneServiceResidentListBlocked
  && disabledServiceBlocked
  && regularProfileWriteBlocked
  && trustedProfile.status === 'registered'
  && courtesy.approvedBy === adminUser.id
  && aggregate18Blocked
  && ownWithoutAllocationBlocked
  && collectorMismatchBlocked
  && reusedAllocationBlocked
  && mismatchedAllocationBlocked
  && verifiedPaymentMutationBlocked
  && collaboratorAllocationBlocked
  && overAllocationBlocked
  && crossHouseholdAllocationBlocked
  && audits.totalItems > 0;

console.log(JSON.stringify(result, null, 2));
if (!expected) throw new Error('La prueba de invariantes no produjo el resultado esperado.');
