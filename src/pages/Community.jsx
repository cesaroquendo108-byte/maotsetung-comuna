import { useState } from 'react';
import { demoIncidents } from '../lib/demoData.js';
import { AsyncDataState, PageHeader, Segmented, StatusBadge } from '../components/UI.jsx';
import CommunityMap from '../components/CommunityMap.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { getCommunityData } from '../lib/repository.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { can } from '../lib/permissions.js';

export default function Community({ role, onAction }) {
  const { membership, isDemo } = useAuth();
  const [tab, setTab] = useState('services');
  const live = useAsyncData(
    () => isDemo ? Promise.resolve(null) : getCommunityData(membership),
    [isDemo, membership?.id],
  );
  const communityError = !isDemo ? (live.error || (!live.loading && !live.data ? 'El servidor respondió sin información comunitaria.' : '')) : '';
  const communityReady = isDemo || (!live.loading && !communityError && Boolean(live.data));
  const reports = isDemo ? demoIncidents : (live.data?.reports || []).map((report) => ({
    ...report,
    reports: 1,
    tone: report.category === 'Agua' ? 'water' : report.category === 'Luz' ? 'electricity' : report.category === 'Gas' ? 'gas' : 'security',
  }));
  const inboxReports = isDemo ? demoIncidents.slice(0, 3).map((report, index) => ({
    ...report,
    status: ['new', 'triage', 'resolved'][index] || 'new',
    urgent: index === 0,
    privacy: 'community',
    description: report.title,
    created: new Date().toISOString(),
  })) : (live.data?.inbox || []);
  const inboxCount = (status) => inboxReports.filter((report) => status.includes(report.status)).length;
  const reportStatusLabel = (status) => ({ new: 'Pendiente', triage: 'En revisión', in_progress: 'En atención', resolved: 'Resuelta', closed: 'Cerrada', rejected: 'Rechazada' }[status] || status);
  const countCategory = (category) => reports
    .filter((report) => report.category === category)
    .reduce((sum, report) => sum + Number(report.reports || 1), 0);
  const serviceCards = [
    { id: 'water', label: 'Agua', symbol: 'A', status: 'Reportes activos', reports: countCategory('Agua'), tone: 'water' },
    { id: 'electricity', label: 'Luz', symbol: 'L', status: 'Reportes activos', reports: countCategory('Luz'), tone: 'electricity' },
    { id: 'gas', label: 'Gas', symbol: 'G', status: 'Encuesta disponible', reports: isDemo ? 96 : live.data?.gasResponses?.length || 0, tone: 'gas' },
    { id: 'security', label: 'Seguridad', symbol: 'S', status: 'Canal privado', reports: null, tone: 'security' },
  ];
  const gasResponses = isDemo ? [] : (live.data?.gasResponses || []);
  const gasStats = isDemo ? { communal: 58, caracas: 31, other: 7, wants: 74, cylinders: 112, total: 96 } : gasResponses.reduce((acc, record) => {
    const data = record.data || {};
    if (/comunal|pdvsa/i.test(data.provider || '')) acc.communal += 1;
    else if (/caracas/i.test(data.provider || '')) acc.caracas += 1;
    else acc.other += 1;
    if (data.wantsRefill) acc.wants += 1;
    acc.cylinders += Number(data.cylinders || 0);
    acc.total += 1;
    return acc;
  }, { communal: 0, caracas: 0, other: 0, wants: 0, cylinders: 0, total: 0 });
  const denominator = gasStats.total || 1;
  const formatCampaignDate = (value) => {
    const dateOnly = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return 'por definir';
    return new Date(`${dateOnly}T12:00:00`).toLocaleDateString('es-VE');
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="PARTICIPACIÓN / SERVICIOS"
        title="Consejo comunal"
        description="Reportes útiles para actuar, sin convertir información sensible en un muro público."
        actions={<button className="primary-button" type="button" onClick={() => onAction('incident')}>+ Nuevo reporte</button>}
      />
      <AsyncDataState loading={!isDemo && live.loading} error={communityError} onRetry={live.reload} loadingLabel="Cargando reportes y encuestas…" />
      {communityReady && <>
      <Segmented value={tab} onChange={setTab} label="Vista del consejo" options={[{ value: 'services', label: 'Servicios' }, { value: 'reports', label: 'Seguimiento' }, ...(can(role, 'reports.triage') ? [{ value: 'inbox', label: 'Buzón' }] : []), { value: 'gas', label: 'Encuesta de gas' }, { value: 'toys', label: 'Juguetes' }]} />

      {tab === 'services' && (
        <>
          <section className="service-grid">
            {serviceCards.map((service) => (
              <button key={service.id} type="button" className={`service-card service-card--${service.tone}`} onClick={() => service.id === 'gas' ? setTab('gas') : service.id === 'security' ? onAction('safety', { category: 'Seguridad' }) : onAction('incident', { category: service.label })}>
                <span>{service.symbol}</span>
                <p><small>{service.label}</small><strong>{service.status}</strong></p>
                <i>{service.reports == null ? 'Privado' : `${service.reports} reportes`} →</i>
              </button>
            ))}
          </section>

          <section className="community-grid">
            <article className="panel map-placeholder">
              <header><div><p className="eyebrow">REFERENCIA TERRITORIAL</p><h2>Referencia y resumen del consejo</h2></div><StatusBadge tone="info">Sin hogares visibles</StatusBadge></header>
              <CommunityMap
                water={countCategory('Agua')}
                electricity={countCategory('Luz')}
                gas={countCategory('Gas')}
                total={reports.reduce((sum, report) => sum + Number(report.reports || 1), 0)}
                incidents={reports}
              />
              <p className="map-note"><strong>Referencia:</strong> se muestran los puntos de inicio y cierre indicados para el consejo comunal. Los conteos por categoría no tienen posición por hogar.</p>
            </article>

            <article className="panel safety-card">
              <p className="eyebrow">CANAL PROTEGIDO</p>
              <span className="shield-symbol">S</span>
              <h2>Seguridad y violencia intrafamiliar</h2>
              <p>Estos reportes no aparecen en el listado comunitario. Solo los ve el equipo expresamente autorizado.</p>
              <ul><li>Opción de identidad reservada</li><li>Acceso restringido y auditado</li><li>Marca de atención urgente</li></ul>
              <button className="secondary-button full" type="button" onClick={() => onAction('safety')}>Abrir canal protegido</button>
              <small>Si existe peligro inmediato, busca un lugar seguro y contacta a emergencias o a una persona de confianza.</small>
            </article>
          </section>
        </>
      )}

      {tab === 'reports' && (
        <section className="panel reports-board">
          <header><div><p className="eyebrow">SEGUIMIENTO</p><h2>Reportes activos</h2></div><StatusBadge tone="info">{reports.length} visibles</StatusBadge></header>
          {reports.map((incident) => (
            <article key={incident.id}>
              <span className={`incident-glyph incident-glyph--${incident.tone}`}>{incident.category.charAt(0)}</span>
              <div><p><strong>{incident.title}</strong><StatusBadge tone={incident.status === 'En seguimiento' ? 'warning' : 'info'}>{incident.status}</StatusBadge></p><small>{incident.zone || 'Consejo comunal no indicado'} · Actualizado {isDemo ? String(incident.updated || 'sin fecha').toLowerCase() : incident.updated ? new Date(incident.updated).toLocaleDateString('es-VE') : 'sin fecha'}</small></div>
              <div className="report-volume"><strong>{incident.reports}</strong><small>reportes</small></div>
              <StatusBadge tone="neutral">Resumen agregado</StatusBadge>
            </article>
          ))}
          {!reports.length && !live.loading && <p className="empty-inline">No hay reportes comunitarios visibles.</p>}
          <div className="reports-privacy"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>Los reportes privados y de seguridad nunca se muestran en esta lista.</p></div>
        </section>
      )}

      {tab === 'inbox' && can(role, 'reports.triage') && (
        <section className="inbox-dashboard">
          <div className="inbox-metrics">
            <article><span>{inboxCount(['new'])}</span><p><strong>Pendientes</strong><small>Sin revisar</small></p></article>
            <article><span>{inboxCount(['triage', 'in_progress'])}</span><p><strong>En revisión</strong><small>Con seguimiento</small></p></article>
            <article><span>{inboxCount(['resolved', 'closed'])}</span><p><strong>Resueltas</strong><small>Con cierre registrado</small></p></article>
          </div>
          <section className="panel inbox-board">
            <header><div><p className="eyebrow">BUZÓN DE ATENCIÓN</p><h2>Historial de reportes</h2><p>Quejas, sugerencias e incidencias reportadas por vecinos del consejo.</p></div><StatusBadge tone="info">{inboxReports.length} reportes</StatusBadge></header>
            <div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Urgencia</th><th>Reporte</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{inboxReports.map((report) => <tr key={report.id}><td>{report.created ? new Date(report.created).toLocaleDateString('es-VE') : '—'}</td><td>{report.category}</td><td><StatusBadge tone={report.urgent ? 'danger' : 'neutral'}>{report.urgent ? 'Alta' : 'Normal'}</StatusBadge></td><td><strong>{report.title}</strong><small className="table-subline">{report.description || report.zone || 'Sin detalle'}</small></td><td><StatusBadge tone={['resolved', 'closed'].includes(report.status) ? 'success' : report.status === 'new' ? 'warning' : 'info'}>{reportStatusLabel(report.status)}</StatusBadge></td><td><div className="inbox-actions">{report.status === 'new' && <button className="secondary-button compact" type="button" onClick={() => onAction('reportReview', report)}>Revisar</button>}{!['resolved', 'closed', 'rejected'].includes(report.status) && <button className="secondary-button compact" type="button" onClick={() => onAction('reportResolve', report)}>Resolver</button>}</div></td></tr>)}</tbody></table></div>
            {!inboxReports.length && <p className="empty-inline">El buzón está vacío.</p>}
          </section>
        </section>
      )}

      {tab === 'gas' && (
        <section className="gas-dashboard">
          <article className="panel gas-survey-lead">
            <p className="eyebrow">{isDemo ? 'CAMPAÑA / JULIO 2026' : 'ENCUESTA / DEMANDA ACTUAL'}</p>
            <h2>¿Cuántos hogares necesitan recarga?</h2>
            <p>El gas se cobra en efectivo, así que esta encuesta mide intención y volumen. No registra un pago automático.</p>
            <div className="gas-bars">
              <div><span><strong>Gas Comunal / PDVSA</strong><small>{gasStats.communal} hogares</small></span><i><b style={{ width: `${Math.round((gasStats.communal / denominator) * 100)}%` }} /></i></div>
              <div><span><strong>Gas Caracas</strong><small>{gasStats.caracas} hogares</small></span><i><b style={{ width: `${Math.round((gasStats.caracas / denominator) * 100)}%` }} /></i></div>
              <div><span><strong>Otro / sin definir</strong><small>{gasStats.other} hogares</small></span><i><b style={{ width: `${Math.round((gasStats.other / denominator) * 100)}%` }} /></i></div>
            </div>
            <p className="empty-inline" style={{ marginTop: '12px' }}>Estadísticas consolidadas del censo comunitario.</p>
          </article>
          <aside>
            <article className="metric-card"><span>{gasStats.total}</span><p><strong>respuestas</strong><small>{role === 'regular' && !isDemo ? 'de tu hogar' : 'de hogares vinculados'}</small></p></article>
            <article className="metric-card"><span>{gasStats.wants}</span><p><strong>quieren recarga</strong><small>intención, no pago</small></p></article>
            <article className="metric-card"><span>{gasStats.cylinders}</span><p><strong>bombonas</strong><small>volumen solicitado</small></p></article>
            <article className="panel manual-cash"><p className="eyebrow">COBRO MANUAL</p><strong>Preparado para efectivo</strong><p>El colaborador podrá marcar “cobrado” en la jornada sin fingir una conciliación bancaria.</p></article>
          </aside>
        </section>
      )}

      {tab === 'toys' && (
        <section className="panel reports-board">
          <header><div><p className="eyebrow">NIÑEZ / CAMPAÑAS</p><h2>Juguetes para niñas y niños</h2><p>Planificación por fecha de nacimiento, rango de edad y asignación auditada.</p></div>{role !== 'regular' && <button className="primary-button" type="button" onClick={() => onAction('toy')}>+ Nueva campaña</button>}</header>
          {(isDemo ? [{ id: 'toy-demo', name: 'Jornada navideña', minAge: 0, maxAge: 12, cutoffDate: '2026-12-01', status: 'planning' }] : live.data?.toyCampaigns || []).map((campaign) => (
            <article key={campaign.id}>
              <span className="incident-glyph incident-glyph--gas">J</span>
              <div><p><strong>{campaign.name}</strong><StatusBadge tone="warning">{campaign.status === 'planning' ? 'Planificación' : campaign.status}</StatusBadge></p><small>Edades {campaign.minAge}–{campaign.maxAge} · corte {formatCampaignDate(campaign.cutoffDate)}</small></div>
            </article>
          ))}
          {!isDemo && !live.loading && !(live.data?.toyCampaigns || []).length && <p className="empty-inline">No hay campañas de juguetes activas.</p>}
          <div className="reports-privacy"><span className="material-symbols-outlined" style={{ fontSize: '15px' }}>info</span><p>Los listados individuales no son públicos; el consejo ve solo el estado agregado de la campaña.</p></div>
        </section>
      )}
      </>}
    </div>
  );
}
