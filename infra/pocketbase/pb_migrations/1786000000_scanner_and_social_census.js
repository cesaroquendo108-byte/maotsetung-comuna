// Migration: Adds scanner and social census fields to residents, and adjusts rules for self-registration

migrate((app) => {
  const residents = app.findCollectionByNameOrId('residents');
  const households = app.findCollectionByNameOrId('households');
  const dwellings = app.findCollectionByNameOrId('dwellings');
  const memberships = app.findCollectionByNameOrId('community_memberships');

  const text = (name, max = 200) => new TextField({ name, max });
  const number = (name, min = 0, max = 1000) => new NumberField({ name, min, max, onlyInt: true });
  const json = (name, maxSize = 50000) => new JSONField({ name, maxSize });
  const select = (name, values) => new SelectField({ name, values, maxSelect: 1 });

  const addResidentField = (field) => {
    try {
      if (!residents.fields.getByName(field.name)) {
        residents.fields.add(field);
      }
    } catch (_) {}
  };

  // Add RIF and fiscal address fields
  addResidentField(text('rifNumber', 40));
  addResidentField(text('rifAddress', 500));
  addResidentField(text('rifState', 100));
  addResidentField(text('rifMunicipality', 100));
  addResidentField(text('rifParish', 100));
  addResidentField(text('rifCity', 100));

  // Add social and community census fields
  addResidentField(select('conditionAffection', [
    'ninguna',
    'discapacidad_motora',
    'discapacidad_visual',
    'discapacidad_auditiva',
    'enfermedad_cronica',
    'adulto_mayor_dependiente',
    'otra',
  ]));
  addResidentField(text('affectionDetail', 1000));
  addResidentField(number('childrenCount', 0, 30));
  addResidentField(json('children', 50000));
  addResidentField(text('dwellingAddress', 300));
  addResidentField(text('zoneCode', 40));

  // Documents attached (filenames or storage keys)
  addResidentField(text('cedulaDoc', 500));
  addResidentField(text('rifDoc', 500));

  // Allow authenticated users to create and link their own resident record
  residents.createRule = '@request.auth.id != "" && @request.auth.disabled = false';
  households.createRule = '@request.auth.id != "" && @request.auth.disabled = false';
  dwellings.createRule = '@request.auth.id != "" && @request.auth.disabled = false';
  memberships.createRule = '@request.auth.id != "" && @request.auth.disabled = false';

  app.save(residents);
  app.save(households);
  app.save(dwellings);
  app.save(memberships);
});
