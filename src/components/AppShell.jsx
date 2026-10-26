import Brand from './Brand.jsx';
import { isAuthorizedAdmin, roleLabel } from '../lib/permissions.js';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { COMMUNITY_CONFIG } from '../config/community.js';

export default function AppShell({ section, onSection, user, role, community, memberships, onSelectCommunity, isDemo, onOpenDonate, children }) {
  const isOnline = useOnlineStatus();
  const isAdmin = (role === 'admin' || isAuthorizedAdmin(user)) && (isDemo || isAuthorizedAdmin(user));
  const itemGroups = [
    {
      label: 'General',
      items: [
        { id: 'home', label: 'Panel', short: 'Inicio', icon: 'home' },
        { id: 'clap', label: 'Jornada CLAP', short: 'CLAP', icon: 'shopping_bag' },
        { id: 'census', label: isAdmin ? 'Censo' : 'Mi Hogar', short: isAdmin ? 'Censo' : 'Hogar', icon: isAdmin ? 'groups' : 'family_restroom' },
      ],
    },
    {
      label: 'Consejo',
      items: [{ id: 'community', label: 'Servicios y reportes', short: 'Consejo', icon: 'campaign' }],
    },
    {
      label: 'Administración',
      items: [
        ...(isAdmin ? [{ id: 'analytics', label: 'Inteligencia BI', short: 'Métricas BI', icon: 'analytics' }] : []),
        { id: 'profile', label: 'Cuenta y accesos', short: 'Cuenta', icon: 'account_circle' },
      ],
    },
  ];
  const items = itemGroups.flatMap((group) => group.items);
  const communityName = community?.name || (isDemo ? COMMUNITY_CONFIG.name : 'Consejo sin nombre');
  const communityCode = community?.code || (isDemo ? COMMUNITY_CONFIG.code : 'Sin código');

  return (
    <div className="app-shell">
      {!isOnline && (
        <div className="offline-banner" role="alert">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>wifi_off</span>
          <span>Navegando sin conexión a internet · Algunas acciones de sincronización están pausadas.</span>
        </div>
      )}
      <aside className="sidebar">
        <Brand />
        <div className="community-switcher">
          <span>Consejo activo</span>
          <strong>{communityName}</strong>
          <small>{communityCode} · contexto aislado</small>
          {memberships?.length > 1 && <select aria-label="Cambiar comunidad" value={memberships.find((item) => item.community === community?.id)?.id || ''} onChange={(event) => onSelectCommunity(event.target.value)}>{memberships.map((item) => <option key={item.id} value={item.id}>{item.expand?.community?.name || item.community}</option>)}</select>}
        </div>
        <div className="sidebar-support-box">
          <button type="button" className="support-pill-btn" onClick={onOpenDonate}>
            <span className="material-symbols-outlined" style={{ fontSize: '1.1rem' }}>favorite</span>
            <strong>Apoyar</strong>
          </button>
        </div>
        <nav aria-label="Navegación principal">
          {itemGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <button key={item.id} type="button" className={section === item.id ? 'active' : ''} onClick={() => onSection(item.id)}>
                  <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>{item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-cycle">
          <div><span>{isDemo ? 'Jornada activa' : 'Jornadas CLAP'}</span><i /></div>
          <strong>{isDemo ? 'Julio 2026' : 'Consulta el estado actual'}</strong>
          <small>{isDemo ? 'Cobro y validación en curso' : 'Pagos, asignaciones y entregas'}</small>
          <button type="button" onClick={() => onSection('clap')}>Ver jornada <span className="material-symbols-outlined" style={{ fontSize: '1.2em', marginLeft: '4px' }}>arrow_forward</span></button>
        </div>
        <button type="button" className="user-card" onClick={() => onSection('profile')}>
          <span className="avatar">{String(user?.name || user?.email || 'U').charAt(0).toUpperCase()}</span>
          <span><strong>{user?.name || 'Residente'}</strong><small>{roleLabel(role)}{isDemo ? ' · Demo' : ''}</small></span>
          <i className="material-symbols-outlined">more_vert</i>
        </button>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <Brand compact />
          <div className="mobile-header-right">
            <button type="button" className="support-pill-btn compact" onClick={onOpenDonate}>
              <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>favorite</span>
              <strong>Apoyar</strong>
            </button>
            <button className="mobile-avatar" type="button" onClick={() => onSection('profile')} aria-label="Abrir cuenta">
              {String(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
            </button>
          </div>
        </header>
        <main>{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación móvil">
        {items.map((item) => (
          <button key={item.id} type="button" className={section === item.id ? 'active' : ''} onClick={() => onSection(item.id)}>
            <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span><small>{item.short || item.label}</small>
          </button>
        ))}
      </nav>
    </div>
  );
}
