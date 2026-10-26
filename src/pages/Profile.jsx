import { useState } from 'react';
import { roleLabel } from '../lib/permissions.js';
import { AsyncDataState, PageHeader, Segmented, StatusBadge } from '../components/UI.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { COMMUNITY_CONFIG } from '../config/community.js';
import {
  approveMembershipRequest,
  authorizeUserRequestByEmail,
  deleteMemberAccount,
  emailFromAccessRequest,
  getAccessManagementData,
  inviteRoleByEmail,
  revokeMembershipRole,
  revokeRoleInvitation,
  updateMembershipRole,
} from '../lib/repository.js';
import { useAsyncData } from '../hooks/useAsyncData.js';

export default function Profile({ onAction }) {
  const { user, role, isDemo, setDemoRole, signOut, community, membership } = useAuth();
  const [notifications, setNotifications] = useState({ clap: true, services: true, surveys: false });
  const [tab, setTab] = useState('account');
  const [accessForms, setAccessForms] = useState({});
  const [roleInvite, setRoleInvite] = useState({ email: '', role: 'collaborator' });
  const [accessMessage, setAccessMessage] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const access = useAsyncData(
    () => role === 'admin' && !isDemo ? getAccessManagementData(membership) : Promise.resolve({ requests: [], members: [], invitations: [] }),
    [role, isDemo, membership?.id],
  );
  const accessError = role === 'admin' && !isDemo ? (access.error || (!access.loading && !access.data ? 'El servidor respondio sin informacion de accesos.' : '')) : '';
  const accessReady = isDemo || (!access.loading && !accessError && Boolean(access.data));
  const initials = String(user?.name || user?.email || 'U').split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();

  return (
    <div className="page">
      <PageHeader eyebrow="CUENTA / SEGURIDAD" title="Tu cuenta" description="Identidad y accesos de la plataforma comunal." />
      <Segmented value={tab} onChange={setTab} label="Seccion de cuenta" options={[{ value: 'account', label: 'Perfil' }, ...(role === 'admin' ? [{ value: 'access', label: 'Accesos' }] : [])]} />

      {tab === 'account' && (
        <div className="profile-grid">
          <section className="panel profile-card">
            <div className="profile-identity"><span>{initials}</span><div><h2>{user?.name || 'Residente'}</h2><p>{user?.email}</p><StatusBadge tone="success">{roleLabel(role)}</StatusBadge></div></div>
            <dl><div><dt>Consejo</dt><dd>{community?.name || (isDemo ? COMMUNITY_CONFIG.name : 'Sin nombre')}</dd></div><div><dt>Codigo</dt><dd className="mono">{community?.code || (isDemo ? COMMUNITY_CONFIG.code : 'Sin codigo')}</dd></div><div><dt>Hogar vinculado</dt><dd className="mono">{membership?.expand?.household?.code || (isDemo ? 'MTT-SAC-014' : 'Sin hogar vinculado')}</dd></div><div><dt>Inicio de sesion</dt><dd>Google / PocketBase</dd></div></dl>
            <p className="profile-update-note">Las correcciones del censo se solicitan desde la seccion Censo y quedan auditadas.</p>
          </section>

          <section className="panel notification-card">
            <p className="eyebrow">AVISOS</p><h2>Notificaciones</h2><p>Elige que novedades deseas recibir.</p>
            {[
              ['clap', 'Jornadas CLAP', 'Pago, validacion y fecha de entrega'],
              ['services', 'Servicios', 'Agua, luz, gas y averias de tu consejo comunal'],
              ['surveys', 'Encuestas', 'Gas, juguetes y consultas comunitarias'],
            ].map(([key, label, description]) => (
              <label className="toggle-row" key={key}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={notifications[key]} onChange={(event) => setNotifications({ ...notifications, [key]: event.target.checked })} /><i /></label>
            ))}
          </section>

          {isDemo && (
            <section className="panel demo-role-card">
              <p className="eyebrow">SOLO EN LA DEMO</p><h2>Probar niveles de acceso</h2><p>Cambia de rol para comprobar que ve cada persona.</p>
              <Segmented value={role} onChange={setDemoRole} label="Rol de demostracion" options={[{ value: 'admin', label: 'Admin' }, { value: 'collaborator', label: 'Colaborador' }, { value: 'regular', label: 'Residente' }]} />
            </section>
          )}

          <section className="profile-actions"><button className="danger-button" type="button" onClick={signOut}>Cerrar sesion</button><small>Sesion protegida por PocketBase.</small></section>

          {!isDemo && (
            <section className="panel" style={{ marginTop: '1.5rem', border: '1px solid #FCA5A5', borderRadius: '1rem', padding: '1.25rem' }}>
              <p className="eyebrow" style={{ color: '#DC2626' }}>ZONA DE PELIGRO</p>
              <h2 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>Eliminar mi cuenta del consejo</h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
                Al eliminar tu cuenta se borrara tu membresía, tu registro de residente vinculado y se cerrara tu sesion. Esta accion no se puede deshacer. La junta podra volver a registrarte manualmente si lo necesitas.
              </p>
              {deleteError && <p style={{ fontSize: '0.82rem', color: '#DC2626', marginBottom: '0.5rem' }}>{deleteError}</p>}
              {!deleteConfirm ? (
                <button
                  type="button"
                  style={{
                    background: 'transparent',
                    border: '1px solid #DC2626',
                    color: '#DC2626',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  onClick={() => setDeleteConfirm(true)}
                >
                  Eliminar mi cuenta
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    type="button"
                    disabled={deleteLoading}
                    style={{
                      background: '#DC2626',
                      border: 'none',
                      color: '#FFFFFF',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: deleteLoading ? 'wait' : 'pointer',
                      opacity: deleteLoading ? 0.6 : 1,
                    }}
                    onClick={async () => {
                      setDeleteLoading(true);
                      setDeleteError('');
                      try {
                        await deleteMemberAccount({
                          membershipId: membership?.id,
                          residentId: membership?.resident,
                        });
                        signOut();
                      } catch (err) {
                        setDeleteError(err?.message || 'No se pudo eliminar la cuenta. Intenta de nuevo.');
                        setDeleteLoading(false);
                      }
                    }}
                  >
                    {deleteLoading ? 'Eliminando...' : 'Confirmar eliminacion definitiva'}
                  </button>
                  <button
                    type="button"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border, #CBD5E1)',
                      color: 'var(--text-main)',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => { setDeleteConfirm(false); setDeleteError(''); }}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {tab === 'access' && role === 'admin' && (
        <>
        <AsyncDataState loading={!isDemo && access.loading} error={accessError} onRetry={access.reload} loadingLabel="Cargando solicitudes y miembros..." />
        {accessReady && (
        <section className="profile-grid">
          <article className="panel permissions-panel role-assignment-panel">
            <header><div><p className="eyebrow">CONSULTA MASIVA CNE Y EDADES</p><h2>Re-matching y actualización de censo</h2><p>Consulta la API de cedula.com.ve para auto-completar fechas de nacimiento y centros de votación faltantes.</p></div></header>
            <div style={{ padding: '0 24px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button className="primary-button" type="button" onClick={() => onAction && onAction('cneBulk')}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '6px' }}>sync</span>
                Ejecutar Re-matching de Edades y CNE
              </button>
              <small style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>Consulta por lote las cédulas sin fecha de nacimiento.</small>
            </div>
          </article>

          <article className="panel permissions-panel role-assignment-panel">
            <header><div><p className="eyebrow">ASIGNAR ROL POR CORREO</p><h2>Personal y roles</h2><p>Si la cuenta todavia no existe, el rol se activara automaticamente al entrar con Google usando ese correo.</p></div></header>
            <form className="role-assignment-form" onSubmit={async (event) => {
              event.preventDefault();
              setAccessMessage('Guardando autorizacion...');
              try {
                await inviteRoleByEmail({ membership, ...roleInvite });
                setRoleInvite({ email: '', role: 'collaborator' });
                setAccessMessage('Correo autorizado. El rol se activara al iniciar sesion con Google.');
                access.reload();
              } catch (error) { setAccessMessage(error?.message || 'No fue posible autorizar el correo.'); }
            }}>
              <input type="email" required placeholder="persona@gmail.com" value={roleInvite.email} onChange={(event) => setRoleInvite((current) => ({ ...current, email: event.target.value }))} />
              <select value={roleInvite.role} onChange={(event) => setRoleInvite((current) => ({ ...current, role: event.target.value }))}><option value="admin">Administrador</option><option value="collaborator">Colaborador</option><option value="regular">Residente</option></select>
              <button className="primary-button" type="submit">Guardar autorizacion</button>
            </form>
            {accessMessage && <p className="data-quality-note">{accessMessage}</p>}
          </article>

          <article className="panel permissions-panel">
            <header><div><p className="eyebrow">SOLICITUDES PENDIENTES</p><h2>Vincular hogares con verificacion</h2><p>La coincidencia de cedula o telefono nunca aprueba por si sola.</p></div><StatusBadge tone="warning">{access.data?.requests?.length || 0} pendientes</StatusBadge></header>
            {(access.data?.requests || []).map((request) => {
              const form = accessForms[request.id] || { householdCode: '', role: 'regular', verificationMethod: 'Validacion presencial', notes: '' };
              const setForm = (key, value) => setAccessForms((current) => ({ ...current, [request.id]: { ...form, [key]: value } }));
              const requestEmail = emailFromAccessRequest(request);
              const requestName = request.accountName || request.expand?.user?.name || requestEmail || 'Cuenta solicitante';
              return <form className="access-request" key={request.id} onSubmit={async (event) => {
                event.preventDefault();
                setAccessMessage('Procesando...');
                try {
                  await approveMembershipRequest({ membership, request, ...form });
                  setAccessMessage('Acceso aprobado y auditado.');
                  access.reload();
                } catch (error) { setAccessMessage(error?.message || 'No fue posible aprobar.'); }
              }}>
                <div><strong>{requestName}</strong><small>{requestEmail || 'Correo protegido'} - Cedula terminada en {String(request.idNumber || '').replace(/\D/g, '').slice(-4) || '-'} - solicitud {new Date(request.created).toLocaleDateString('es-VE')}</small></div>
                <input aria-label="Codigo de hogar" required placeholder="Codigo de hogar" value={form.householdCode} onChange={(event) => setForm('householdCode', event.target.value)} />
                <select aria-label="Metodo de verificacion" value={form.verificationMethod} onChange={(event) => setForm('verificationMethod', event.target.value)}><option>Validacion presencial</option><option>Invitacion entregada</option><option>OTP al telefono censado</option></select>
                <select aria-label="Rol inicial" value={form.role} onChange={(event) => setForm('role', event.target.value)}><option value="regular">Residente</option><option value="collaborator">Colaborador</option><option value="admin">Administrador</option></select>
                <button className="secondary-button" type="submit">Aprobar</button>
                <button className="text-button" type="button" disabled={!requestEmail} onClick={async () => {
                  setAccessMessage('Autorizando correo...');
                  try {
                    await authorizeUserRequestByEmail({ membership, request, role: form.role });
                    setAccessMessage(`Correo y cuenta autorizados como ${roleLabel(form.role)}.`);
                    access.reload();
                  } catch (error) { setAccessMessage(error?.message || 'No fue posible autorizar el correo.'); }
                }}>Autorizar correo</button>
              </form>;
            })}
            {!access.loading && !(access.data?.requests || []).length && <p className="empty-inline">No hay solicitudes pendientes.</p>}
          </article>

          <article className="panel permissions-panel">
            <header><div><p className="eyebrow">MIEMBROS ACTIVOS</p><h2>Roles del consejo</h2></div></header>
            <div className="table-wrap"><table><thead><tr><th>Cuenta</th><th>Hogar</th><th>Rol</th><th>Acciones</th></tr></thead><tbody>{(access.data?.members || []).map((member) => <tr key={member.id}><td><strong>{member.accountName || member.expand?.user?.name || 'Usuario'}</strong><small className="table-subline">{member.accountEmail || member.expand?.user?.email || 'Correo protegido'}</small></td><td className="mono">{member.expand?.household?.code || '-'}</td><td><select value={member.role} disabled={member.user === user.id} onChange={async (event) => {
              try { await updateMembershipRole({ membership, memberId: member.id, role: event.target.value }); access.reload(); } catch (error) { setAccessMessage(error?.message || 'No fue posible cambiar el rol.'); }
            }}><option value="admin">Administrador</option><option value="collaborator">Colaborador</option><option value="regular">Residente</option></select></td><td><button className="text-button danger-text" type="button" disabled={member.user === user.id} onClick={async () => {
              try { await revokeMembershipRole({ membership, memberId: member.id }); setAccessMessage('Rol retirado.'); access.reload(); } catch (error) { setAccessMessage(error?.message || 'No fue posible retirar el rol.'); }
            }}>Quitar rol</button></td></tr>)}</tbody></table></div>
            <div className="permissions-note"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>warning</span><p>Tu propio rol se bloquea en esta vista para evitar que el consejo quede sin administración por accidente.</p></div>
          </article>

          <article className="panel permissions-panel">
            <header><div><p className="eyebrow">AUTORIZACIONES POR CORREO</p><h2>Pendientes y aceptadas</h2></div><StatusBadge tone="info">{access.data?.invitations?.length || 0}</StatusBadge></header>
            <div className="table-wrap"><table><thead><tr><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{(access.data?.invitations || []).map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td>{roleLabel(invitation.role)}</td><td><StatusBadge tone={invitation.status === 'accepted' ? 'success' : 'warning'}>{invitation.status === 'accepted' ? 'Activa' : 'Pendiente'}</StatusBadge></td><td><button className="text-button danger-text" type="button" onClick={async () => {
              try { await revokeRoleInvitation({ membership, invitationId: invitation.id }); setAccessMessage('Autorizacion retirada.'); access.reload(); } catch (error) { setAccessMessage(error?.message || 'No fue posible retirar la autorizacion.'); }
            }}>Retirar</button></td></tr>)}</tbody></table></div>
            {!(access.data?.invitations || []).length && <p className="empty-inline">No hay autorizaciones por correo.</p>}
          </article>
        </section>
        )}
        </>
      )}
    </div>
  );
}
