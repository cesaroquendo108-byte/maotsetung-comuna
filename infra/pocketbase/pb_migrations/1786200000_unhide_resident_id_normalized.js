// Migration: Unhides idNumberNormalized in residents so it can be queried and filtered in API requests

migrate((app) => {
  const residents = app.findCollectionByNameOrId('residents');
  const field = residents.fields.getByName('idNumberNormalized');
  if (field) {
    field.hidden = false;
  }
  app.save(residents);
});
