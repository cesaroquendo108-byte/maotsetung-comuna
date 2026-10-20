// Migration: Adds file attachments (cedulaFile, rifFile) to residents collection for document archiving

migrate((app) => {
  const residents = app.findCollectionByNameOrId('residents');

  const file = (name) => new FileField({
    name,
    maxSelect: 1,
    maxSize: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  });

  try {
    if (!residents.fields.getByName('cedulaFile')) {
      residents.fields.add(file('cedulaFile'));
    }
  } catch (_) {}

  try {
    if (!residents.fields.getByName('rifFile')) {
      residents.fields.add(file('rifFile'));
    }
  } catch (_) {}

  app.save(residents);
});
