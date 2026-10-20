import { useMemo, useState } from 'react';
import { AsyncDataState, PageHeader, StatusBadge } from '../components/UI.jsx';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { approveConsolidatedLinkRequest, getConsolidatedCensusData, getConsolidatedLinkRequests, rejectConsolidatedLinkRequest } from '../lib/repository.js';
import { useAuth } from '../state/AuthContext.jsx';

const demoZones = [];

const demoSummary = {
  zones: 0,
  dwellings: 0,
  provisionalDwellings: 0,
  verifiedDwellings: 0,
  families: 0,
  familiesInReview: 0,
  people: 0,
  pendingCases: 0,
};

function Metric({ label, value, detail, tone = '' }) {
  return <article className={`metric-card ${tone ? `metric-card--${tone}` : ''}`}><span>{value}</span><p><strong>{label}</strong><small>{detail}</small></p></article>;
}

export default function ConsolidatedCensus() {
  const { membership, isDemo, role } = useAuth();
  const [actionState, setActionState] = useState({ id: '', status: 'idle', message: '' });
  const live = useAsyncData(
    async () => {
      if (isDemo) return null;
      const [census, linkRequests] = await Promise.all([getConsolidatedCensusData(membership), getConsolidatedLinkRequests(membership)]);
      return { ...census, linkRequests };
    },
    [isDemo, membership?.id, membership?.community, membership?.role],
  );
  const summary = isDemo ? demoSummary : live.data?.summary;
  const zones = isDemo
    ? demoZones.map(([code, name]) => ({ code, name, status: 'active' }))
    : (live.data?.zones || []);
  const cases = isDemo
    ? []
    : Object.entries((live.data?.cases || []).reduce((result, item) => {
      result[item.type] = (result[item.type] || 0) + 1;
      return result;
    }, {})).map(([type, count]) => ({ type, count, label: type.replaceAll('_', ' ') }));
  const zoneRows = useMemo(() => zones.slice(0, isDemo ? 7 : 40), [zones, isDemo]);
  const linkRequests = isDemo ? [] : (live.data?.linkRequests || []);

  const resolveRequest = async (item, action) => {
    setActionState({ id: item.id, status: 'sending', message: '' });
    try {
      if (action === 'approve') await approveConsolidatedLinkRequest(membership, item.id, item.raw || {});
      else await rejectConsolidatedLinkRequest(membership, item.id, 'No se pudo confirmar la coincidencia con el hogar declarado.');
      setActionState({ id: item.id, status: 'done', message: action === 'approve' ? 'Vinculación aprobada.' : 'Solicitud rechazada.' });
      live.reload();
    } catch (error) {
      setActionState({ id: item.id, status: 'error', message: error?.message || 'No se pudo actualizar la solicitud.' });
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="ADMINISTRACIÓN / CENSO CONSOLIDADO"
        title="Zonas, viviendas y familias"
        description="La vivienda física se mantiene separada de la familia censal y de las personas que la integran."
        actions={<StatusBadge tone={isDemo ? 'warning' : 'success'}>{isDemo ? 'Vista de demostración' : 'Datos operativos'}</StatusBadge>}
      />

      {!isDemo && <AsyncDataState loading={live.loading} error={live.error} onRetry={live.reload} loadingLabel="Cargando la consolidación..." />}

      {(isDemo || (!live.loading && !live.error)) && <>
        <section className="metrics-grid" aria-label="Resumen del censo consolidado">
          <Metric label="Zonas" value={summary?.zones ?? '—'} detail="Hojas históricas convertidas" />
          <Metric label="Viviendas" value={summary?.dwellings ?? '—'} detail={`${summary?.provisionalDwellings ?? 0} provisionales`} tone="warning" />
          <Metric label="Familias" value={summary?.families ?? '—'} detail={`${summary?.familiesInReview ?? 0} para revisión`} />
          <Metric label="Personas" value={summary?.people ?? '—'} detail="Integrantes vinculados" tone="accent" />
          <Metric label="Casos pendientes" value={summary?.pendingCases ?? '—'} detail="Requieren decisión humana" tone="warning" />
        </section>

        <section className="census-insight-grid">
          <article className="panel census-table-panel">
            <header className="table-toolbar">
              <div><p className="eyebrow">ZONAS</p><h2>Catálogo estable</h2></div>
              <small>{isDemo ? 'Mostrando ejemplos de 40 zonas' : `${zones.length} zonas`}</small>
            </header>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Código</th><th>Zona</th><th>Estado</th><th>Familias</th><th>Viviendas</th></tr></thead>
                <tbody>{zoneRows.map((zone) => (
                  <tr key={zone.id || zone.code}>
                    <td><strong className="mono">{zone.code}</strong></td>
                    <td>{zone.name}</td>
                    <td><StatusBadge tone={zone.status === 'active' ? 'success' : 'warning'}>{zone.status === 'active' ? 'Activa' : zone.status}</StatusBadge></td>
                    <td>{isDemo ? '—' : live.data?.familiesByZone?.[zone.id] || 0}</td>
                    <td>{isDemo ? '—' : live.data?.dwellingsByZone?.[zone.id] || 0}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </article>

          <aside className="census-side">
            <article className="panel">
              <p className="eyebrow">REVISIÓN HUMANA</p>
              <h2>Conflictos detectados</h2>
              <div className="incident-list">
                {cases.map((item) => <div className="incident-row" key={item.type}><span className="incident-glyph incident-glyph--warning">!</span><p><strong>{item.label}</strong><small>Sin decisión automática</small></p><span>{item.count}</span></div>)}
                {!cases.length && <p className="empty-inline">No hay casos pendientes.</p>}
              </div>
            </article>
            <article className="panel">
              <p className="eyebrow">REGLAS DE ESTRUCTURA</p>
              <h2>Historial preservado</h2>
              <p className="empty-inline">Una fusión conserva los códigos anteriores; una separación conserva la familia, sus integrantes y los valores originales del Excel.</p>
            </article>
          </aside>
        </section>

        {!isDemo && <section className="panel" style={{ padding: '22px', marginTop: '14px' }}>
          <header className="table-toolbar">
            <div><p className="eyebrow">VINCULACIONES</p><h2>Personas que esperan confirmación</h2></div>
            <small>{linkRequests.length} pendientes</small>
          </header>
          {!linkRequests.length && <p className="empty-inline">No hay solicitudes de residentes pendientes.</p>}
          {linkRequests.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Persona</th><th>Zona</th><th>Búsqueda</th><th>Resultado</th><th>Acciones</th></tr></thead>
            <tbody>{linkRequests.map((item) => {
              const personName = [item.person?.firstName, item.person?.lastName].filter(Boolean).join(' ') || 'Persona sin coincidencia';
              const query = item.query || {};
              const message = actionState.id === item.id ? actionState.message : '';
              return <tr key={item.id}>
                <td><strong>{personName}</strong><small className="table-subline">{item.person?.idNumber || query.idNumber || 'Identidad por confirmar'}</small></td>
                <td>{item.zone ? `${item.zone.code} · ${item.zone.name}` : 'Sin zona'}</td>
                <td><small>{query.code || query.idNumber || query.phone || 'Referencia declarada'}</small></td>
                <td>{item.dwelling?.code || item.family?.legacyFamilyNumber ? `Hogar ${item.dwelling?.code || 'histórico'} · Familia ${item.family?.legacyFamilyNumber || '—'}` : 'Nuevo hogar para revisión'}</td>
                <td><div className="row-actions">{role === 'admin' && <><button className="row-action" type="button" disabled={actionState.id === item.id && actionState.status === 'sending'} onClick={() => resolveRequest(item, 'approve')}>Aprobar</button><button className="row-action danger-link" type="button" disabled={actionState.id === item.id && actionState.status === 'sending'} onClick={() => resolveRequest(item, 'reject')}>Rechazar</button></>}{message && <small>{message}</small>}</div></td>
              </tr>;
            })}</tbody>
          </table></div>}
          {role !== 'admin' && linkRequests.length > 0 && <p className="empty-inline">El colaborador puede revisar la solicitud; la aprobación final la realiza un administrador.</p>}
        </section>}
      </>}
    </div>
  );
}
