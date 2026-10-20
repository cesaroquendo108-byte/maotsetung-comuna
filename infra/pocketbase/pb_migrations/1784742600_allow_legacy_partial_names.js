migrate((app) => {
  const residents = app.findCollectionByNameOrId('residents');
  residents.fields.getByName('firstName').required = false;
  residents.fields.getByName('lastName').required = false;
  app.save(residents);
}, (app) => {
  const residents = app.findCollectionByNameOrId('residents');
  residents.fields.getByName('firstName').required = true;
  residents.fields.getByName('lastName').required = true;
  app.save(residents);
});
