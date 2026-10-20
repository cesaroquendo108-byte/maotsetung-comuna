// Migration: Adds gas, housing, and census detail fields directly to residents collection

migrate((app) => {
  const residents = app.findCollectionByNameOrId('residents');

  const text = (name, max = 200) => new TextField({ name, max });
  const bool = (name) => new BoolField({ name });

  const addField = (field) => {
    try {
      if (!residents.fields.getByName(field.name)) {
        residents.fields.add(field);
      }
    } catch (_) {}
  };

  addField(text('gasCylindersCount', 40));
  addField(text('gasCylinderSize', 40));
  addField(text('gasValveType', 60));
  addField(text('cookingAppliance', 60));
  addField(text('waterTankCapacity', 60));
  addField(text('housingTenure', 60));
  addField(text('communityTrade', 200));
  addField(text('petsCount', 40));
  addField(bool('isHouseholdHead'));
  addField(text('votingCenterName', 250));
  addField(text('houseNumber', 60));
  addField(text('houseSuffix', 40));

  app.save(residents);
});
