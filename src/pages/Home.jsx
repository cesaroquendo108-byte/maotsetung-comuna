import { can } from '../lib/permissions.js';
import { demoCycle, demoIncidents, demoStats } from '../lib/demoData.js';
import { AsyncDataState, Metric, PageHeader, ProgressBar, StatusBadge } from '../components/UI.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { getDashboardData } from '../lib/repository.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { formatCurrencyTotals } from '../lib/formatters.js';

export default function Home({ role, user, onNavigate, onAction }) {
  const { membership, community, isDemo } = useAuth();
  const live = useAsyncData(
    () => isDemo ? Promise.resolve(null) : getDashboardData(membership),
    [isDemo, membership?.id],
  );
  const dashboardError = !isDemo ? (live.error || (!live.loading && !live.data ? 'El servidor respondió sin datos para este consejo.' : '')) : '';
  const dashboardReady = isDemo || (!live.loading && !dashboardError && Boolean(live.data));
  const operator = can(role, 'census.view_all');
  const firstName = String(user?.name || 'vecino').split(' ')[0];
  const stats = isDemo ? demoStats : live.data;
  const cycle = isDemo ? demoCycle : live.data?.cycle;
  const incidents = isDemo ? demoIncidents : (live.data?.incidents || []);
  const paymentsProgress = stats?.eligibleBags > 0 ? Math.round((stats.paymentsReported / stats.eligibleBags) * 100) : 0;
  const cycleStart = cycle?.startsAt || cycle?.paymentOpensAt || cycle?.distributionStartsAt;
  const cycleDate = cycleStart ? new Date(cycleStart) : null;
  const communityLabel = isDemo
    ? 'COMUNA MAO TSE TUNG · SAN AGUSTÍN'
    : String(community?.name || 'COMUNA MAO TSE TUNG').toUpperCase();
  const paymentStep = stats?.paymentsValidated > 0
    ? { className: 'done', marker: '✓', title: 'Pago validado', detail: 'Confirmado por la operación' }
    : stats?.paymentsReported > 0
      ? { className: 'active', marker: '2', title: 'Pago en revisión', detail: 'La junta validará el reporte' }
      : { className: '', marker: '2', title: 'Pago por reportar', detail: cycle ? 'Disponible durante la jornada' : 'Espera la próxima jornada' };
  const deliveryStep = isDemo
    ? { title: 'Entrega pendiente', detail: 'Te avisaremos la fecha' }
    : cycle
      ? { title: 'Entrega por confirmar', detail: 'Consulta la jornada para ver el estado' }
      : { title: 'Sin entrega programada', detail: 'No hay una jornada activa' };
  const nextAction = (() => {
    if (isDemo) {
      return operator
        ? { title: 'Revisa pagos sin asignar.', detail: 'Hay montos agrupados que deben distribuirse entre varios hogares antes de la entrega.' }
        : { title: 'Tu reporte fue recibido.', detail: 'No necesitas enviar el comprobante otra vez. El estado cambiará al ser validado.' };
    }
    if (!cycle) return { title: 'No hay una jornada CLAP cargada.', detail: 'Cuando se carguen pagos o se abra una jornada formal, aquí aparecerá el operativo.' };
    if (operator) {
      return stats?.paymentsReported > stats?.paymentsValidated
        ? { title: 'Hay reportes que aún no figuran como validados.', detail: 'Abre la jornada para revisar sus estados antes de preparar las entregas.' }
        : { title: 'No hay pagos pendientes visibles.', detail: 'La jornada seguirá actualizándose cuando lleguen nuevos reportes.' };
    }
    if (stats?.paymentsValidated > 0) return { title: 'Tu pago fue validado.', detail: 'Consulta la jornada para seguir el estado de la entrega.' };
    if (stats?.paymentsReported > 0) return { title: 'Tu pago está en revisión.', detail: 'No necesitas enviar el comprobante otra vez mientras continúe pendiente.' };
    return { title: 'Aún no hay un pago reportado.', detail: 'Puedes registrar el pago desde la jornada CLAP cuando tengas la referencia.' };
  })();

  return (
    <div className="page page--home">
      <PageHeader
        eyebrow={`${communityLabel} / ${cycleDate ? cycleDate.toLocaleDateString('es-VE', { month: 'long', year: 'numeric' }).toUpperCase() : 'GESTIÓN DEL CONSEJO'}`}
        title={`Hola, ${firstName}.`}
        description={operator ? 'Aquí tienes el estado operativo del consejo comunal.' : 'Tu hogar y el consejo comunal, en un solo vistazo.'}
        actions={<StatusBadge tone={dashboardError ? 'error' : (!isDemo && live.loading ? 'info' : 'success')}>{dashboardError ? 'Datos no disponibles' : (!isDemo && live.loading ? 'Actualizando datos' : 'Sistema operativo')}</StatusBadge>}
      />

      <AsyncDataState loading={!isDemo && live.loading} error={dashboardError} onRetry={live.reload} loadingLabel="Cargando el resumen comunitario…" />

      {dashboardReady && <>
      <section className="hero-grid">
        <article className="cycle-hero">
          <div className="cycle-hero__top">
            <div>
              <p className="eyebrow">{cycle ? 'JORNADA CLAP' : 'JORNADAS CLAP'}</p>
              <h2>{cycle?.name || 'Sin jornada CLAP'}</h2>
              <p>{operator ? 'Cobro, validación y preparación de entregas.' : 'Revisa tu pago y confirma la entrega de tu bolsa.'}</p>
            </div>
            <span className="cycle-number">{cycleDate ? String(cycleDate.getDate()).padStart(2, '0') : '—'}<span>{cycleDate ? `/${String(cycleDate.getFullYear()).slice(-2)}` : ''}</span></span>
          </div>

          {operator ? (
            <div className="operator-progress">
              <ProgressBar value={stats.paymentsReported} max={stats.eligibleBags || 1} label="Pagos reportados" detail={stats.eligibleBags ? `${stats.paymentsReported} / ${stats.eligibleBags}` : 'Sin asignaciones'} />
              <div className="cycle-summary">
                <p><span>{stats.paymentsReported}</span><small>reportes</small></p>
                <p><span>{isDemo ? 'Bs. 0,00' : formatCurrencyTotals(stats.paymentTotals)}</span><small>monto reportado válido</small></p>
                <p><span>{paymentsProgress}%</span><small>avance estimado</small></p>
              </div>
            </div>
          ) : (
            <ol className="resident-timeline">
              <li className="done"><span>✓</span><p><strong>Hogar vinculado</strong><small>Tu cuenta tiene acceso a este hogar</small></p></li>
              <li className={paymentStep.className}><span>{paymentStep.marker}</span><p><strong>{paymentStep.title}</strong><small>{paymentStep.detail}</small></p></li>
              <li><span>3</span><p><strong>{deliveryStep.title}</strong><small>{deliveryStep.detail}</small></p></li>
            </ol>
          )}

          <div className="cycle-hero__actions">
            <button className="primary-button" type="button" onClick={() => onNavigate('clap')}>{operator ? 'Abrir jornada' : 'Ver mi bolsa'} <span>→</span></button>
            {!operator && <button className="secondary-button" type="button" onClick={() => onAction('payment')}>Reportar pago</button>}
          </div>
        </article>

        <article className="next-action-card">
          <p className="eyebrow">SIGUIENTE ACCIÓN</p>
          <span className="action-icon">{operator ? '!' : '✓'}</span>
          <h3>{nextAction.title}</h3>
          <p>{nextAction.detail}</p>
          <button className="link-button" type="button" onClick={() => onNavigate('clap')}>{cycle ? (operator ? 'Abrir jornada' : 'Ver detalle') : 'Ver jornadas'} <span>→</span></button>
        </article>
      </section>

      {(isDemo || operator) && (
      <section className="section-block">
        <div className="section-title">
          <div><p className="eyebrow">LECTURA RÁPIDA</p><h2>El consejo en cifras</h2></div>
          <button className="link-button" type="button" onClick={() => onNavigate('census')}>Ver censo <span>→</span></button>
        </div>
        <div className="metrics-grid">
          <Metric label="Hogares" value={live.loading && !isDemo ? '—' : stats.households} detail="Hogares registrados" />
          <Metric label="Residentes" value={live.loading && !isDemo ? '—' : stats.residents} detail="Registros activos" />
          <Metric label="Adultos mayores (60+)" value={live.loading && !isDemo ? '—' : (stats?.seniors ?? 0)} detail="Población prioritaria (60 años o más)" tone="warning" />
          <Metric label="Niños y jóvenes (<18)" value={live.loading && !isDemo ? '—' : (stats?.children ?? 0)} detail="Población infantil comunitaria" tone="accent" />
          <Metric label="Pagos reportados" value={live.loading && !isDemo ? '—' : stats.paymentsReported} detail={cycle?.source === 'payment_import_staging' ? 'Excel CLAP importado' : 'Jornada CLAP'} />
          <Metric label="Pagos validados" value={live.loading && !isDemo ? '—' : stats.paymentsValidated} detail="Sin contar pendientes" />
        </div>
      </section>
      )}

      <section className="home-lower-grid">
        <article className="panel incident-panel">
          <header><div><p className="eyebrow">SERVICIOS</p><h2>Reportes activos</h2></div><button className="link-button" type="button" onClick={() => onNavigate('community')}>Ver todos</button></header>
          <div className="incident-list">
            {incidents.map((incident) => (
              <div key={incident.id} className="incident-row">
                <span className={`incident-glyph incident-glyph--${incident.tone}`}>{incident.category.slice(0, 1)}</span>
                <p><strong>{incident.title}</strong><small>{incident.zone || 'Zona no indicada'} · {isDemo ? String(incident.updated || 'Sin fecha') : incident.updated ? new Date(incident.updated).toLocaleDateString('es-VE') : 'Sin fecha'}</small></p>
                <span>{incident.reports ?? '•'}<small>{incident.status || 'activo'}</small></span>
              </div>
            ))}
            {!incidents.length && !live.loading && <p className="empty-inline">No hay reportes comunitarios activos.</p>}
          </div>
          <button className="secondary-button full" type="button" onClick={() => onAction('incident')}>+ Reportar una avería</button>
        </article>
      </section>
      </>}
    </div>
  );
}
