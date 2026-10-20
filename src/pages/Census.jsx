import { useEffect, useState } from 'react';
import { can, isAuthorizedAdmin } from '../lib/permissions.js';
import { demoHousehold, demoResidents, segmentOptions } from '../lib/demoData.js';
import { AsyncDataState, PageHeader, StatusBadge } from '../components/UI.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { downloadCensusExport, getResidentsPage, runCneBulkLookup } from '../lib/repository.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { formatHousingTenure } from '../lib/formatters.js';
import { calculateFinvePotentialScore } from '../lib/communityAnalytics.js';
import { COMMUNITY_CONFIG } from '../config/community.js';

const PAGE_SIZE = 50;

const firstAvailable = (...values) => values.find((value) => String(value || '').trim()) || '';

function PaginationFooter({ page, totalPages, totalItems, itemCount, onPageChange, loading }) {
  const safeTotalPages = Math.max(1, totalPages || 0);
  const firstItem = itemCount ? ((page - 1) * PAGE_SIZE) + 1 : 0;
  const lastItem = itemCount ? firstItem + itemCount - 1 : 0;

  return (
    <footer>
      <span aria-live="polite">{totalItems ? `Mostrando ${firstItem}-${lastItem} de ${totalItems}` : 'Sin registros'} · Pagina {page} de {safeTotalPages}</span>
      <div className="pagination-actions">
        <button className="link-button" type="button" onClick={() => onPageChange(page - 1)} disabled={loading || page <= 1}><span>←</span> Anterior</button>
        <button className="link-button" type="button" onClick={() => onPageChange(page + 1)} disabled={loading || page >= safeTotalPages}>Siguiente <span>→</span></button>
      </div>
    </footer>
  );
}

function HouseholdView({ onAction, household, members, isDemo, pagination, loading, error, role }) {
  const headMember = members.find((m) => m.isHouseholdHead || String(m.relationship || '').toLowerCase().includes('jef')) || members[0];
  const activeGasMember = members.find((m) => m.gasProvider && m.gasProvider !== 'Sin definir') || headMember;
  const gasProvider = activeGasMember?.gasProvider || household?.gasProvider || (isDemo ? 'Gas Caracas' : 'Sin definir');
  const cylinders = activeGasMember?.cylinders || activeGasMember?.rawRecord?.gasCylindersCount || (isDemo ? '2' : '1');
  const cylinderSize = activeGasMember?.cylinderSize || (isDemo ? '10kg' : '10kg');
  const valveType = activeGasMember?.valveType === 'rosca' ? 'Rosca' : 'Pico Rápido';

  const tenure = headMember?.housingTenure || (isDemo ? 'propia' : 'propia');
  const zone = headMember?.zoneCode || '';
  const houseNum = headMember?.houseNumber || '';
  const streetAddress = headMember?.dwellingAddress || household?.address || (zone && houseNum ? `Zona ${zone} · Casa ${houseNum}` : (isDemo ? demoHousehold.address : COMMUNITY_CONFIG.name));
  const votingCenter = headMember?.center || (isDemo ? 'E.B.N. Bicentenario Republicano' : '');

  return (
    <div className="household-view">
      <section className="panel household-card">
        <header>
          <div>
            <p className="eyebrow">MI HOGAR</p>
            <h2>{household?.code || (houseNum ? `CASA ${houseNum}` : 'Hogar Verificado')}</h2>
            <p style={{ color: 'var(--text-main)', marginTop: '2px' }}>{streetAddress}</p>
            {zone && <small style={{ color: 'var(--muted)', display: 'block', marginTop: '2px' }}>Zona: {zone} {houseNum ? `· Casa Nº ${houseNum}` : ''}</small>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
            <StatusBadge tone="success">Vinculado</StatusBadge>
            <button
              className="secondary-button"
              type="button"
              style={{ fontSize: '0.82rem', minHeight: '34px', padding: '0 14px' }}
              onClick={() => onAction('addFamilyMember')}
            >
              <span style={{ marginRight: '4px' }}>+</span> Agregar integrante
            </button>
          </div>
        </header>

        <div className="household-meta">
          <span>
            <small>Integrantes</small>
            <strong>{pagination.totalItems || members.length}</strong>
          </span>
          <span>
            <small>Servicio de gas</small>
            <strong>{gasProvider}</strong>
            {gasProvider !== 'Sin definir' && (
              <small style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted)' }}>
                {cylinders} bombona(s) · {cylinderSize} ({valveType})
              </small>
            )}
          </span>
          <span>
            <small>Condición vivienda</small>
            <strong style={{ textTransform: 'capitalize' }}>
              {formatHousingTenure(tenure)}
            </strong>
          </span>
          {votingCenter && (
            <span>
              <small>Centro electoral</small>
              <strong style={{ fontSize: '0.82rem' }}>{votingCenter}</strong>
            </span>
          )}
        </div>

        <div className="member-list">
          {members.map((member) => (
            <article key={member.id}>
              <span className="member-avatar">{member.name.charAt(0)}</span>
              <p>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong>{member.name}</strong>
                  {member.isHouseholdHead && (
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(79, 145, 173, 0.15)', color: 'var(--blue, #0284C7)', padding: '1px 5px', borderRadius: '4px' }}>
                      Jefe(a)
                    </span>
                  )}
                  {role === 'admin' && member.finveScore !== undefined && (
                    <span
                      title={`Potencial Finve: ${member.finveScore}/100 pts (${member.finveTierLabel})`}
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: member.finveTier === 'Alto' ? '#ECFDF5' : member.finveTier === 'Medio' ? '#FFFBEB' : '#F1F5F9',
                        color: member.finveTier === 'Alto' ? '#065F46' : member.finveTier === 'Medio' ? '#92400E' : '#475569',
                        border: `1px solid ${member.finveTier === 'Alto' ? '#A7F3D0' : member.finveTier === 'Medio' ? '#FDE68A' : '#CBD5E1'}`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: member.finveTierColor || '#94A3B8' }} />
                      Finve {member.finveScore}
                    </span>
                  )}
                </span>
                <small>
                  {member.relationship || 'Integrante'} · {member.age == null ? 'fecha pendiente' : `${member.age} años`}
                  {member.phone ? ` · Tel: ${member.phone}` : ''}
                </small>
              </p>
              <p className="member-id">
                <strong>{member.idNumber}</strong>
                <small>{member.center ? `CNE: ${member.center}` : (member.age != null && member.age >= 18 ? 'Edad electoral' : 'No aplica')}</small>
              </p>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button className="row-action" type="button" onClick={() => onAction('residentUpdate', member)}>Reportar cambio</button>
                <button
                  className="row-action"
                  type="button"
                  style={{ color: '#DC2626', borderColor: '#FECACA' }}
                  onClick={() => onAction('residentDeactivate', member)}
                >
                  Eliminar
                </button>
              </div>
            </article>
          ))}
          {!members.length && <p className="empty-inline">{loading ? 'Cargando integrantes...' : error || 'No hay integrantes activos vinculados.'}</p>}
        </div>
        <PaginationFooter {...pagination} itemCount={members.length} loading={loading} />
      </section>

      <aside className="census-side">
        <article className="panel cne-card">
          <p className="eyebrow">DATOS DEL HOGAR</p>
          <span className="cne-mark">{COMMUNITY_CONFIG.shortCode || 'MTT'}</span>
          <h2>Ficha de la vivienda</h2>
          <p style={{ fontSize: '0.82rem', margin: '0 0 8px' }}>
            Tu hogar está registrado con servicio de <strong>{gasProvider}</strong> ({cylinders} cilindro(s)) y vivienda <strong>{tenure}</strong>.
          </p>
          <p style={{ fontSize: '0.82rem', margin: 0, color: 'var(--muted)' }}>
            Si requieres actualizar las bombonas, agregar un familiar o corregir el centro de votación, usa los botones directos de acción.
          </p>
        </article>
      </aside>
    </div>
  );
}

export default function Census({ role, onAction, onNavigate }) {
  const { user, membership, household, isDemo } = useAuth();
  const operator = can(role, 'census.view_all', isDemo ? null : user) || isAuthorizedAdmin(user);
  const isAdmin = (role === 'admin' || isAuthorizedAdmin(user));
  const [segment, setSegment] = useState('Todos');
  const [selectedCouncil, setSelectedCouncil] = useState('Todos');
  const [query, setQuery] = useState('');
  const [exportState, setExportState] = useState({ status: 'idle', message: '' });
  const paginationKey = [
    isDemo ? 'demo' : 'live',
    membership?.id || '',
    membership?.community || '',
    membership?.household || '',
    membership?.role || '',
    query,
    segment,
    selectedCouncil,
  ].join('|');
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const page = pageState.key === paginationKey ? pageState.page : 1;
  const live = useAsyncData(
    () => isDemo ? Promise.resolve(null) : getResidentsPage(membership, { page, perPage: PAGE_SIZE, query, segment, council: selectedCouncil }),
    [isDemo, membership?.id, membership?.community, membership?.household, membership?.role, page, query, segment, selectedCouncil],
  );
  const ageFromDate = (birthDate) => {
    if (!birthDate) return null;
    const date = new Date(birthDate);
    if (Number.isNaN(date.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - date.getFullYear();
    if (now.getMonth() < date.getMonth() || (now.getMonth() === date.getMonth() && now.getDate() < date.getDate())) age -= 1;
    return age;
  };
  const householdGasMap = new Map();
  (live.data?.items || []).forEach((r) => {
    const hKey = r.household || r.expand?.household?.id || r.expand?.household?.code || '';
    if (!hKey) return;
    const g = r.gasProvider || r.sourceValues?.rawInput?.gasProvider;
    if (g && g !== 'Sin definir') {
      const existing = householdGasMap.get(hKey);
      const isHead = r.isHouseholdHead === true || r.sourceValues?.rawInput?.isHouseholdHead === true || String(r.relationship || '').toLowerCase().includes('jef');
      const cyl = r.gasCylindersCount || r.sourceValues?.rawInput?.gasCylindersCount;
      if (!existing || isHead || (cyl && cyl !== '0')) {
        householdGasMap.set(hKey, {
          provider: g,
          cylinders: cyl || '1',
          size: r.gasCylinderSize || r.sourceValues?.rawInput?.gasCylinderSize || '10kg',
          valve: r.gasValveType || r.sourceValues?.rawInput?.gasValveType || 'pico_rapido',
        });
      }
    }
  });

  const liveResidents = (live.data?.items || []).map((record) => {
    const age = ageFromDate(record.birthDate);
    const electoral = record.electoralProfile;
    const voter = electoral?.status === 'registered'
      ? 'Inscrito'
      : electoral?.status === 'not_registered'
        ? 'No inscrito'
        : electoral?.status === 'verification_error'
          ? 'Error de verificacion'
          : 'Sin verificar';

    const rawInput = record.sourceValues?.rawInput || {};
    const hKey = record.household || record.expand?.household?.id || record.expand?.household?.code || '';
    const inheritedGas = householdGasMap.get(hKey);

    const gasProvider = record.gasProvider
      || rawInput.gasProvider
      || inheritedGas?.provider
      || '';

    const isHouseholdHead = Boolean(
      record.isHouseholdHead === true
      || rawInput.isHouseholdHead === true
      || String(record.relationship || '').toLowerCase().includes('jef')
    );

    const cylinders = record.gasCylindersCount
      || rawInput.gasCylindersCount
      || (isHouseholdHead ? (inheritedGas?.cylinders || '1') : '0');

    const cylinderSize = record.gasCylinderSize
      || rawInput.gasCylinderSize
      || inheritedGas?.size
      || '10kg';

    const valveType = record.gasValveType
      || rawInput.gasValveType
      || inheritedGas?.valve
      || 'pico_rapido';

    const votingCenter = electoral?.votingCenterName
      || record.votingCenterName
      || record.sourceValues?.votingCenterName
      || rawInput.votingCenterName
      || '';

    const votingCenterAddress = electoral?.votingCenterAddress
      || record.sourceValues?.rawInput?.votingCenterAddress
      || '';

    const housingTenure = record.housingTenure
      || rawInput.housingTenure
      || 'propia';

    const zoneCode = record.zoneCode
      || rawInput.zoneCode
      || record.expand?.household?.sector?.code
      || '';

    const houseNumber = record.houseNumber
      || rawInput.houseNumber
      || '';

    const dwellingAddress = record.dwellingAddress
      || rawInput.dwellingAddress
      || record.expand?.household?.address
      || '';

    const gasDisplay = gasProvider && gasProvider !== 'Sin definir'
      ? gasProvider
      : 'Sin definir';

    const finve = calculateFinvePotentialScore(record);

    return {
      id: record.id,
      household: record.expand?.household?.code || household?.code || (houseNumber ? `Casa ${houseNumber}` : 'Sin codigo'),
      householdId: hKey,
      name: `${record.firstName || ''} ${record.lastName || ''}`.trim() || 'Sin nombre',
      firstName: record.firstName || '',
      lastName: record.lastName || '',
      nationality: record.nationality || 'V',
      birthDate: record.birthDate || '',
      relationship: record.relationship || (isHouseholdHead ? 'Jefe(a) de Hogar' : 'Integrante'),
      isHouseholdHead,
      sex: record.sex || '',
      idNumber: record.idNumber || 'Sin cedula',
      phone: firstAvailable(record.phone, record.phone1, record.phone2, rawInput.phone),
      age,
      segment: age == null ? 'Sin fecha' : age < 18 ? 'Ninez' : age >= 60 ? 'Adulto mayor' : 'Adulto',
      finveScore: finve.score,
      finveTier: finve.tier,
      finveTierLabel: finve.tierLabel,
      finveTierColor: finve.tierColor,
      voter,
      center: votingCenter,
      centerAddress: votingCenterAddress,
      cneSource: electoral?.source || (votingCenter ? 'Registro Comunal' : ''),
      gasProvider,
      gas: gasDisplay,
      cylinders,
      cylinderSize,
      valveType,
      housingTenure,
      zoneCode,
      houseNumber,
      dwellingAddress,
      notes: record.notes || '',
      status: record.status === 'active' ? 'Activo' : 'Revisar',
      rawRecord: record,
    };
  });
  const residents = isDemo ? demoResidents : liveResidents;
  const filtered = isDemo ? residents.filter((resident) => {
    const hasCenter = Boolean(String(resident.center || '').trim()) && resident.center !== '—';
    const cnePending = ['Pendiente', 'Sin verificar', 'Error de verificacion'].includes(resident.voter) || !hasCenter;
    const textMatch = `${resident.name} ${resident.idNumber} ${resident.household} ${resident.center || ''}`.toLowerCase().includes(query.toLowerCase());
    const councilMatch = selectedCouncil === 'Todos'
      || resident.zoneCode === selectedCouncil
      || (resident.household && resident.household.includes(selectedCouncil));
    const segmentMatch = segment === 'Todos'
      || resident.segment === segment
      || (segment === 'Votantes' && ['Inscrito', 'Inscrita'].includes(resident.voter))
      || (segment === 'Sin centro electoral' && !hasCenter)
      || (segment === 'Con centro electoral' && hasCenter)
      || (segment === 'CNE pendiente' && cnePending)
      || (segment === 'Error CNE' && resident.voter === 'Error de verificacion')
      || (segment === 'No inscrito CNE' && resident.voter === 'No inscrito')
      || (segment === 'Fuente 2024' && resident.cneSource === 'resultadosconvzla-2024')
      || (segment === 'Sin fecha' && resident.age == null)
      || (segment === 'Sin teléfono' && !resident.phone)
      || (segment === 'Gas Caracas' && resident.gas === 'Gas Caracas')
      || (segment === 'Gas Comunal' && resident.gas === 'Comunal')
      || (segment === 'Gas sin definir' && (!resident.gas || resident.gas === 'Sin definir'));
    return textMatch && segmentMatch && councilMatch;
  }) : residents;
  const totalItems = isDemo ? filtered.length : (live.data?.totalItems || 0);
  const totalPages = isDemo ? 1 : Math.max(1, live.data?.totalPages || 0);
  const [autoSynced, setAutoSynced] = useState(false);

  useEffect(() => {
    if (isDemo || role !== 'admin' || !membership || autoSynced || live.loading || live.error || !liveResidents.length) return;
    const missingDateCount = liveResidents.filter((r) => !r.birthDate && String(r.idNumber || '').replace(/\D/g, '').length >= 5).length;
    if (missingDateCount > 0) {
      setAutoSynced(true);
      runCneBulkLookup({ membership, limit: 100, confirmCommunityConsent: true })
        .then(() => {
          window.dispatchEvent(new CustomEvent('maotsetung:data-changed'));
          window.dispatchEvent(new CustomEvent('uroprofin:data-changed'));
        })
        .catch(() => {});
    }
  }, [isDemo, role, membership, autoSynced, live.loading, live.error, liveResidents]);

  useEffect(() => {
    if (isDemo || live.loading || live.error || !live.data || page <= totalPages) return;
    setPageState({ key: paginationKey, page: totalPages });
  }, [isDemo, live.loading, live.error, live.data, page, paginationKey, totalPages]);
  const changePage = (nextPage) => {
    const boundedPage = Math.max(1, Math.min(totalPages, nextPage));
    setPageState({ key: paginationKey, page: boundedPage });
  };
  const exportCensus = async (format) => {
    try {
      setExportState({ status: 'loading', message: format === 'csv' ? 'Preparando CSV...' : 'Preparando Excel...' });
      const fileName = await downloadCensusExport(membership, format, { query, segment, council: selectedCouncil });
      setExportState({ status: 'success', message: `Exportado: ${fileName}` });
    } catch (error) {
      setExportState({ status: 'error', message: error.message || 'No se pudo exportar.' });
    }
  };
  const pagination = { page, totalPages, totalItems, onPageChange: changePage };

  return (
    <div className="page">
      <PageHeader
        eyebrow="PERSONAS / HOGARES"
        title={operator ? 'Censo comunitario' : 'Mi hogar'}
        description={operator ? 'Una base organizada, trazable y preparada para más consejos comunales.' : 'Revisa los datos vinculados con tu cuenta y reporta cualquier cambio.'}
        actions={operator && <>
          {isAdmin && onNavigate && (
            <button className="secondary-button" type="button" onClick={() => onNavigate('analytics')}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>analytics</span>
              Inteligencia BI
            </button>
          )}
          <button className="primary-button" type="button" onClick={() => onAction('resident')}>+ Agregar persona</button>
        </>}
      />

      {isAdmin && onNavigate && (
        <div className="bi-view-switcher" style={{ marginBottom: '1.25rem' }}>
          <button
            type="button"
            className="pill-button active"
            style={{
              padding: '7px 14px',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: 'var(--panel, #0F172A)',
              color: '#FFFFFF',
              borderRadius: '20px',
              border: 'none',
              cursor: 'default',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>table_rows</span>
            Tabla Censal
          </button>
          <button
            type="button"
            className="pill-button"
            onClick={() => onNavigate('analytics')}
            style={{
              padding: '7px 14px',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: 'transparent',
              color: 'var(--muted, #64748B)',
              borderRadius: '20px',
              border: '1px solid var(--border, #CBD5E1)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>analytics</span>
            Inteligencia BI (Métricas)
          </button>
        </div>
      )}

      {!isDemo && <AsyncDataState loading={live.loading} error={live.error} onRetry={live.reload} loadingLabel="Cargando el censo..." />}

      {(isDemo || (!live.loading && !live.error)) && (!operator ? (
        (isDemo || household) ? (
          <HouseholdView onAction={onAction} household={isDemo ? demoHousehold : household} members={isDemo ? demoHousehold.members : liveResidents} isDemo={isDemo} pagination={isDemo ? { ...pagination, totalItems: demoHousehold.members.length } : pagination} loading={false} error="" role={role} />
        ) : (
          <section className="panel" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--meta)', marginBottom: '12px', display: 'block' }}>home</span>
            <h2 style={{ margin: '0 0 8px' }}>Tu hogar aún no está vinculado</h2>
            <p style={{ maxWidth: '420px', margin: '0 auto' }}>Un administrador del consejo debe aprobar tu solicitud y asociar tu cuenta con tu hogar en el censo. Mientras tanto, no se muestran datos personales aquí.</p>
          </section>
        )
      ) : (
        <>
          <section className="panel census-table-panel">
            <header className="table-toolbar">
              <div><p className="eyebrow">REGISTROS</p><h2>Personas censadas</h2></div>
              <div className="toolbar-actions">
                <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar en el censo" placeholder="Buscar cedula, nombre, centro u hogar..." />
                <label className="filter-select">
                  <span>Filtro</span>
                  <select value={segment} onChange={(event) => setSegment(event.target.value)} aria-label="Filtrar censo">
                    {segmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                {role === 'admin' && <>
                  <button className="secondary-button" type="button" onClick={() => exportCensus('csv')} disabled={exportState.status === 'loading'}>CSV</button>
                  <button className="secondary-button" type="button" onClick={() => exportCensus('xls')} disabled={exportState.status === 'loading'}>Excel</button>
                </>}
              </div>
            </header>
            <div
              className="council-filter-bar"
              style={{
                display: 'flex',
                gap: '8px',
                overflowX: 'auto',
                padding: '10px 16px',
                background: 'var(--subtle, #F8FAFC)',
                borderBottom: '1px solid var(--border, #E2E8F0)',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--muted, #64748B)',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                }}
              >
                Consejo Comunal:
              </span>
              <button
                type="button"
                className={`council-pill ${selectedCouncil === 'Todos' ? 'active' : ''}`}
                onClick={() => setSelectedCouncil('Todos')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '16px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  border: selectedCouncil === 'Todos' ? 'none' : '1px solid var(--border, #CBD5E1)',
                  background: selectedCouncil === 'Todos' ? 'var(--blue, #0284C7)' : '#FFFFFF',
                  color: selectedCouncil === 'Todos' ? '#FFFFFF' : 'var(--text-main, #1E293B)',
                }}
              >
                Todos los Consejos (5)
              </button>
              {COMMUNITY_CONFIG.councils.map((c) => {
                const isActive = selectedCouncil === c.abbreviation;
                return (
                  <button
                    key={c.code}
                    type="button"
                    className={`council-pill ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedCouncil(c.abbreviation)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: '16px',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      border: isActive ? 'none' : '1px solid var(--border, #CBD5E1)',
                      background: isActive ? 'var(--blue, #0284C7)' : '#FFFFFF',
                      color: isActive ? '#FFFFFF' : 'var(--text-main, #1E293B)',
                    }}
                  >
                    {c.shortName} ({c.abbreviation})
                  </button>
                );
              })}
            </div>
            {exportState.message && <p className={`inline-status ${exportState.status}`}>{exportState.message}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Hogar</th>
                    <th>Persona</th>
                    <th>Edad / Parentesco</th>
                    <th>Gas Comunitario</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {!isDemo && live.loading && <tr><td colSpan="5">Cargando registros...</td></tr>}
                  {!live.loading && !live.error && !filtered.length && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '36px 16px', color: '#64748B' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '2.5rem', color: '#94A3B8', display: 'block', marginBottom: '8px' }}>groups</span>
                        <strong style={{ display: 'block', color: '#1E293B', fontSize: '1rem' }}>{query || segment !== 'Todos' ? 'No hay registros que coincidan con los filtros' : 'No hay personas registradas en el censo aún'}</strong>
                        <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>{query || segment !== 'Todos' ? 'Intenta modificar el término de búsqueda o el filtro seleccionado.' : 'Los registros aparecerán aquí conforme los habitantes se registren o se agreguen.'}</p>
                      </td>
                    </tr>
                  )}
                  {!live.loading && !live.error && filtered.map((resident) => (
                    <tr key={resident.id}>
                      <td>
                        <strong className="mono">{resident.household}</strong>
                        {(resident.zoneCode || resident.houseNumber) && (
                          <small className="cell-note" style={{ display: 'block', fontWeight: 600 }}>
                            {resident.zoneCode ? `CC ${resident.zoneCode}` : ''} {resident.houseNumber ? `· Casa ${resident.houseNumber}` : ''}
                          </small>
                        )}
                        <small className="cell-note" style={{ display: 'block', textTransform: 'capitalize', color: '#64748B' }}>
                          Vivienda {formatHousingTenure(resident.housingTenure)}
                        </small>
                      </td>
                      <td>
                        <span className="person-cell">
                          <i>{resident.name.charAt(0)}</i>
                          <span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <strong>{resident.name}</strong>
                              {resident.isHouseholdHead && (
                                <span style={{ fontSize: '0.65rem', fontWeight: 700, background: 'rgba(79, 145, 173, 0.15)', color: 'var(--blue, #0284C7)', padding: '1px 5px', borderRadius: '4px' }}>
                                  Jefe(a)
                                </span>
                              )}
                              {role === 'admin' && resident.finveScore !== undefined && (
                                <span
                                  title={`Potencial Finve: ${resident.finveScore}/100 pts (${resident.finveTierLabel})`}
                                  style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: resident.finveTier === 'Alto' ? '#ECFDF5' : resident.finveTier === 'Medio' ? '#FFFBEB' : '#F1F5F9',
                                    color: resident.finveTier === 'Alto' ? '#065F46' : resident.finveTier === 'Medio' ? '#92400E' : '#475569',
                                    border: `1px solid ${resident.finveTier === 'Alto' ? '#A7F3D0' : resident.finveTier === 'Medio' ? '#FDE68A' : '#CBD5E1'}`,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                  }}
                                >
                                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: resident.finveTierColor || '#94A3B8' }} />
                                  Finve {resident.finveScore}
                                </span>
                              )}
                            </div>
                            <small>{resident.idNumber}{resident.phone ? ` · ${resident.phone}` : ''}</small>
                            {resident.center && (
                              <small style={{ display: 'block', color: '#047857', fontSize: '0.72rem', marginTop: '1px' }}>
                                CNE: {resident.center}
                              </small>
                            )}
                          </span>
                        </span>
                      </td>
                      <td>
                        <strong>{resident.age != null ? `${resident.age} años` : 'Sin fecha'}</strong>
                        <small className="cell-note" style={{ display: 'block' }}>{resident.segment}</small>
                        <small className="cell-note" style={{ display: 'block', color: '#64748B' }}>{resident.relationship}</small>
                      </td>
                      <td>
                        {resident.gasProvider && resident.gasProvider !== 'Sin definir' ? (
                          <div>
                            <strong>{resident.gasProvider}</strong>
                            <small className="cell-note" style={{ display: 'block' }}>
                              {resident.isHouseholdHead && resident.cylinders && resident.cylinders !== '0'
                                ? `${resident.cylinders} bombona(s) · ${resident.cylinderSize || '10kg'}`
                                : (resident.isHouseholdHead ? '1 bombona' : 'Gas del hogar')}
                            </small>
                            {resident.valveType && (
                              <small style={{ display: 'block', fontSize: '0.7rem', color: '#64748B' }}>
                                {resident.valveType === 'pico_rapido' ? 'Pico Rápido' : 'Rosca'}
                              </small>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: '#94A3B8', fontSize: '0.85rem' }}>Sin definir</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="row-action" type="button" onClick={() => onAction('residentUpdate', resident)}>Editar →</button>
                          {role === 'admin' && (
                            <button className="row-action danger-link" type="button" onClick={() => onAction('residentDeactivate', resident)}>Dar de baja</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PaginationFooter {...pagination} itemCount={filtered.length} loading={!isDemo && live.loading} />
          </section>
        </>
      ))}
    </div>
  );
}
