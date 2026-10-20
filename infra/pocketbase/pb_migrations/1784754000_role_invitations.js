migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const communes = app.findCollectionByNameOrId('communes');
  const activeAdmin = '@request.auth.id != "" && @request.auth.disabled = false && @collection.community_memberships:roleInviteAdmin.user ?= @request.auth.id && @collection.community_memberships:roleInviteAdmin.community ?= community && @collection.community_memberships:roleInviteAdmin.status ?= "active" && @collection.community_memberships:roleInviteAdmin.role ?= "admin"';

  const invitations = new Collection({
    type: 'base',
    name: 'role_invitations',
    fields: [
      { type: 'relation', name: 'community', collectionId: communes.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: 'email', name: 'email', required: true, presentable: true },
      { type: 'select', name: 'role', required: true, values: ['admin', 'collaborator', 'regular'], maxSelect: 1 },
      { type: 'select', name: 'status', required: true, values: ['pending', 'accepted', 'revoked'], maxSelect: 1 },
      { type: 'relation', name: 'invitedBy', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: false },
      { type: 'relation', name: 'acceptedBy', collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { type: 'date', name: 'acceptedAt' },
      { type: 'text', name: 'notes', max: 1000 },
      { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_role_invitations_community_email ON role_invitations (community, email)',
      'CREATE INDEX idx_role_invitations_status ON role_invitations (community, status)',
    ],
  });
  app.save(invitations);
  invitations.listRule = activeAdmin;
  invitations.viewRule = activeAdmin;
  invitations.createRule = `(${activeAdmin}) && invitedBy = @request.auth.id && status = "pending"`;
  invitations.updateRule = `(${activeAdmin}) && @request.body.community:changed = false && @request.body.email:changed = false && @request.body.invitedBy:changed = false`;
  invitations.deleteRule = activeAdmin;
  app.save(invitations);
}, (app) => {
  const invitations = app.findCollectionByNameOrId('role_invitations');
  app.delete(invitations);
});
