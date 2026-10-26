import React, { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../components/UI.jsx';
import EChart from '../components/EChart.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { isAuthorizedAdmin } from '../lib/permissions.js';
import { getCommunityAnalyticsData } from '../lib/repository.js';
import {
  computeCommunityKPIs,
  buildAgePyramidData,
  buildGasDistributionData,
  buildHealthVulnerabilityData,
  buildCneStatusData,
  buildZoneDistributionData,
  buildWaterStorageData,
  exportCommunityBiCSV,
  getDemoAnalyticsData,
} from '../lib/communityAnalytics.js';
import { COMMUNITY_CONFIG } from '../config/community.js';

export default function CommunityAnalytics({ role, onAction, onNavigate }) {
  const { user, membership, community, isDemo } = useAuth();
  const isAdmin = role === 'admin' && (isDemo || isAuthorizedAdmin(user));

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(max-width: 640px)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 640px)');
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const [activeTab, setActiveTab] = useState('demografia');
  const [loading, setLoading] = useState(!isDemo);
  const [error, setError] = useState('');
  const [dataset, setDataset] = useState(() => isDemo ? getDemoAnalyticsData() : null);

  const loadData = async () => {
    if (isDemo) {
      setDataset(getDemoAnalyticsData());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getCommunityAnalyticsData(membership);
      if (!data.residents || data.residents.length === 0) {
        setDataset(isDemo ? getDemoAnalyticsData() : { residents: [], households: [], dwellings: [], zones: [] });
      } else {
        setDataset(data);
      }
    } catch (err) {
      setError(err.message || 'Error al cargar los datos de analítica comunitaria.');
      if (isDemo) {
        setDataset(getDemoAnalyticsData());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isDemo, membership?.id, membership?.community]);

  const residents = dataset?.residents || [];
  const households = dataset?.households || [];
  const dwellings = dataset?.dwellings || [];
  const zones = dataset?.zones || [];

  // Compute calculated statistics
  const kpis = useMemo(() => computeCommunityKPIs(residents, households, dwellings), [residents, households, dwellings]);
  const agePyramid = useMemo(() => buildAgePyramidData(residents), [residents]);
  const gasData = useMemo(() => buildGasDistributionData(residents), [residents]);
  const healthData = useMemo(() => buildHealthVulnerabilityData(residents), [residents]);
  const cneData = useMemo(() => buildCneStatusData(residents), [residents]);
  const zoneData = useMemo(() => buildZoneDistributionData(residents, zones), [residents, zones]);
  const waterData = useMemo(() => buildWaterStorageData(residents), [residents]);

  const handleExportCsv = () => {
    if (!residents.length) return;
    const csv = exportCommunityBiCSV(residents);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inteligencia_bi_comunidad_${community?.code || COMMUNITY_CONFIG.code || 'MTT-001'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ECharts Configurations
  const agePyramidOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        let res = `<strong>Grupo ${params[0].name} años</strong><br/>`;
        params.forEach((p) => {
          const val = Math.abs(p.value);
          res += `${p.marker} ${p.seriesName}: <b>${val}</b> personas<br/>`;
        });
        return res;
      },
    },
    legend: {
      data: ['Hombres', 'Mujeres'],
      top: 0,
      textStyle: { color: '#524c57', fontWeight: 600, fontSize: isMobile ? 11 : 12 },
    },
    grid: { left: isMobile ? '1%' : '3%', right: isMobile ? '2%' : '4%', bottom: '2%', top: isMobile ? '30px' : '35px', containLabel: true },
    xAxis: [{
      type: 'value',
      axisLabel: {
        formatter: (v) => Math.abs(v),
        color: '#716a75',
        fontSize: isMobile ? 10 : 11,
      },
      splitLine: { lineStyle: { color: '#f0e4e2' } },
    }],
    yAxis: [{
      type: 'category',
      axisTick: { show: false },
      data: agePyramid.categories,
      axisLabel: { color: '#26222b', fontWeight: 600, fontSize: isMobile ? 10 : 11 },
    }],
    series: [
      {
        name: 'Hombres',
        type: 'bar',
        stack: 'total',
        barMaxWidth: isMobile ? 16 : 22,
        itemStyle: { color: '#4a91ad', borderRadius: [4, 0, 0, 4] },
        data: agePyramid.maleData,
      },
      {
        name: 'Mujeres',
        type: 'bar',
        stack: 'total',
        barMaxWidth: isMobile ? 16 : 22,
        itemStyle: { color: '#c62a38', borderRadius: [0, 4, 4, 0] },
        data: agePyramid.femaleData,
      },
    ],
  }), [agePyramid, isMobile]);

  const genderDonutOption = useMemo(() => ({
    tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
    legend: { bottom: 0, left: 'center', textStyle: { color: '#524c57', fontSize: isMobile ? 10 : 12 }, itemGap: isMobile ? 8 : 12 },
    series: [{
      name: 'Género',
      type: 'pie',
      radius: isMobile ? ['38%', '62%'] : ['45%', '70%'],
      center: ['50%', isMobile ? '38%' : '42%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      color: ['#c62a38', '#4a91ad'],
      data: [
        { value: kpis.femaleCount, name: `Mujeres (${kpis.femaleRatio}%)` },
        { value: kpis.maleCount, name: `Hombres (${kpis.maleRatio}%)` },
      ],
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: isMobile ? 12 : 14, fontWeight: 'bold' },
      },
    }],
  }), [kpis, isMobile]);

  const zoneBarOption = useMemo(() => {
    const categories = Object.keys(zoneData);
    const values = Object.values(zoneData);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: isMobile ? '1%' : '3%', right: isMobile ? '2%' : '4%', bottom: '2%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: '#524c57',
          fontSize: isMobile ? 10 : 11,
          interval: 0,
          rotate: isMobile && categories.length > 3 ? 20 : 0,
        },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0e4e2' } } },
      series: [{
        name: 'Habitantes',
        type: 'bar',
        barMaxWidth: isMobile ? 22 : 30,
        data: values,
        itemStyle: { color: '#c4761b', borderRadius: [4, 4, 0, 0] },
      }],
    };
  }, [zoneData, isMobile]);

  const gasProviderDonutOption = useMemo(() => {
    const data = Object.entries(gasData.providers).map(([name, value]) => ({ name, value }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
      legend: { bottom: 0, left: 'center', textStyle: { color: '#524c57', fontSize: isMobile ? 10 : 11 }, itemGap: isMobile ? 6 : 10 },
      series: [{
        name: 'Proveedor de Gas',
        type: 'pie',
        radius: isMobile ? ['36%', '60%'] : ['42%', '68%'],
        center: ['50%', isMobile ? '38%' : '42%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        color: ['#c62a38', '#4a91ad', '#c4761b', '#2f8f63'],
        data,
      }],
    };
  }, [gasData, isMobile]);

  const gasCylindersBarOption = useMemo(() => {
    const categories = Object.keys(gasData.cylinders);
    const values = Object.values(gasData.cylinders);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: isMobile ? '1%' : '3%', right: isMobile ? '2%' : '4%', bottom: '2%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: '#524c57', fontSize: isMobile ? 10 : 11 },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0e4e2' } } },
      series: [{
        name: 'Bombonas',
        type: 'bar',
        barMaxWidth: isMobile ? 24 : 32,
        data: values,
        itemStyle: { color: '#2f8f63', borderRadius: [4, 4, 0, 0] },
      }],
    };
  }, [gasData, isMobile]);

  const gasValveDonutOption = useMemo(() => {
    const data = Object.entries(gasData.valves).map(([name, value]) => ({ name, value }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
      legend: { bottom: 0, left: 'center', textStyle: { color: '#524c57', fontSize: isMobile ? 10 : 11 }, itemGap: isMobile ? 8 : 12 },
      series: [{
        name: 'Válvula de Gas',
        type: 'pie',
        radius: isMobile ? ['38%', '62%'] : ['42%', '68%'],
        center: ['50%', isMobile ? '38%' : '42%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        color: ['#84639a', '#c4761b'],
        data,
      }],
    };
  }, [gasData, isMobile]);

  const waterTankBarOption = useMemo(() => {
    const categories = Object.keys(waterData);
    const values = Object.values(waterData);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: isMobile ? '1%' : '3%', right: isMobile ? '2%' : '4%', bottom: '2%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: '#524c57',
          fontSize: isMobile ? 9 : 11,
          interval: 0,
          rotate: isMobile && categories.length > 3 ? 20 : 0,
        },
      },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0e4e2' } } },
      series: [{
        name: 'Viviendas',
        type: 'bar',
        barMaxWidth: isMobile ? 22 : 30,
        data: values,
        itemStyle: { color: '#4a91ad', borderRadius: [4, 4, 0, 0] },
      }],
    };
  }, [waterData, isMobile]);

  const chronicConditionsBarOption = useMemo(() => {
    const categories = Object.keys(healthData.chronicConditions);
    const values = Object.values(healthData.chronicConditions);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = params[0];
          return `<b>${p.name}</b><br/>${p.marker} Casos: <b>${p.value}</b>`;
        },
      },
      grid: { left: isMobile ? '1%' : '3%', right: isMobile ? '3%' : '4%', bottom: '2%', top: '6%', containLabel: true },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0e4e2' } } },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: '#26222b',
          fontWeight: 600,
          fontSize: isMobile ? 10 : 11,
          formatter: (val) => {
            if (isMobile && typeof val === 'string' && val.length > 14) {
              return val.slice(0, 13) + '…';
            }
            return val;
          },
        },
      },
      series: [{
        name: 'Casos Reportados',
        type: 'bar',
        barMaxWidth: isMobile ? 18 : 22,
        data: values,
        itemStyle: { color: '#c62a38', borderRadius: [0, 4, 4, 0] },
      }],
    };
  }, [healthData, isMobile]);

  const cneStatusDonutOption = useMemo(() => {
    const data = Object.entries(cneData.voters).map(([name, value]) => ({ name, value }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
      legend: { bottom: 0, left: 'center', textStyle: { color: '#524c57', fontSize: isMobile ? 10 : 11 }, itemGap: isMobile ? 6 : 10 },
      series: [{
        name: 'Registro Electoral',
        type: 'pie',
        radius: isMobile ? ['36%', '60%'] : ['45%', '70%'],
        center: ['50%', isMobile ? '38%' : '42%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        color: ['#2f8f63', '#c62a38', '#c4761b', '#716a75'],
        data,
      }],
    };
  }, [cneData, isMobile]);

  const cneCenterBarOption = useMemo(() => {
    const categories = Object.keys(cneData.centers);
    const values = Object.values(cneData.centers);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = params[0];
          return `<b>${p.name}</b><br/>${p.marker} Electores: <b>${p.value}</b>`;
        },
      },
      grid: { left: isMobile ? '1%' : '3%', right: isMobile ? '3%' : '4%', bottom: '2%', top: '6%', containLabel: true },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0e4e2' } } },
      yAxis: {
        type: 'category',
        data: categories,
        axisLabel: {
          color: '#26222b',
          fontSize: isMobile ? 10 : 11,
          formatter: (val) => {
            if (isMobile && typeof val === 'string' && val.length > 15) {
              return val.slice(0, 14) + '…';
            }
            return val;
          },
        },
      },
      series: [{
        name: 'Electores',
        type: 'bar',
        barMaxWidth: isMobile ? 18 : 22,
        data: values,
        itemStyle: { color: '#4a91ad', borderRadius: [0, 4, 4, 0] },
      }],
    };
  }, [cneData, isMobile]);

  const idCardsDonutOption = useMemo(() => {
    const data = Object.entries(cneData.idCards).map(([name, value]) => ({ name, value }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
      legend: { bottom: 0, left: 'center', textStyle: { color: '#524c57', fontSize: isMobile ? 10 : 11 }, itemGap: isMobile ? 6 : 10 },
      series: [{
        name: 'Cédulas de Identidad',
        type: 'pie',
        radius: isMobile ? ['36%', '60%'] : ['45%', '70%'],
        center: ['50%', isMobile ? '38%' : '42%'],
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        color: ['#2f8f63', '#c4761b', '#c62a38'],
        data,
      }],
    };
  }, [cneData, isMobile]);

  if (!isAdmin) {
    return (
      <div className="page">
        <section className="panel" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--red)', marginBottom: '12px', display: 'block' }}>lock</span>
          <h2>Acceso Restringido</h2>
          <p>El módulo de Inteligencia BI está reservado exclusivamente para administradores autorizados de la junta comunal.</p>
          <div style={{ marginTop: '1.5rem' }}>
            <button className="primary-button" type="button" onClick={() => onNavigate?.('home')}>
              Volver al Inicio
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page bi-page">
      <PageHeader
        eyebrow="INTELIGENCIA COMUNITARIA Y BI"
        title="Métricas del Censo y Logística Comunal"
        description="Tablero ejecutivo para la toma de decisiones, distribución de gas, capacidad hídrica y auditoría electoral."
        actions={
          <div className="bi-header-actions">
            {onNavigate && (
              <button className="secondary-button" type="button" onClick={() => onNavigate('census')}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>table_rows</span>
                Tabla Censal
              </button>
            )}
            <button className="secondary-button" type="button" onClick={handleExportCsv} disabled={!residents.length}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>download</span>
              {isMobile ? 'Exportar CSV' : 'Descargar Dataset BI (CSV)'}
            </button>
            <button className="secondary-button" type="button" onClick={loadData} disabled={loading}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>refresh</span>
              Actualizar
            </button>
          </div>
        }
      />

      {/* Switcher de Vista y Estado Comunal */}
      <div className="bi-controls-row">
        <div className="bi-view-switcher">
          {onNavigate && (
            <button
              type="button"
              className="pill-button"
              onClick={() => onNavigate('census')}
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
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>table_rows</span>
              Tabla Censal
            </button>
          )}
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
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>analytics</span>
            {isMobile ? 'Métricas BI' : 'Inteligencia BI (Métricas)'}
          </button>
        </div>

        <div className="bi-community-meta">
          <span style={{ fontSize: '0.8rem', color: 'var(--meta)' }}>
            Consejo: <b>{community?.name || (isDemo ? COMMUNITY_CONFIG.name : 'Comunidad')}</b>
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.72rem',
              padding: '3px 8px',
              borderRadius: '12px',
              background: isDemo ? '#FEF3C7' : '#D1FAE5',
              color: isDemo ? '#92400E' : '#065F46',
              fontWeight: 700,
            }}
          >
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isDemo ? '#D97706' : '#10B981' }} />
            {isDemo ? 'Demostración' : 'Tiempo Real'}
          </span>
        </div>
      </div>

      {error && (
        <div className="panel" style={{ background: '#FFF1F2', borderColor: '#FECDD3', color: '#9F1239', padding: '12px 16px', marginBottom: '1.25rem' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>{error}</p>
        </div>
      )}

      {/* Ribbon de Métricas Clave (KPIs) */}
      <section className="bi-kpi-grid">
        <article className="panel bi-kpi-card">
          <small className="bi-kpi-label">Habitantes</small>
          <div className="bi-kpi-val-row">
            <h2 className="bi-kpi-val">{kpis.totalResidents}</h2>
            <small className="bi-kpi-unit">personas</small>
          </div>
          <small className="bi-kpi-sub">
            {kpis.femaleRatio}% M / {kpis.maleRatio}% H
          </small>
        </article>

        <article className="panel bi-kpi-card">
          <small className="bi-kpi-label">Familias</small>
          <div className="bi-kpi-val-row">
            <h2 className="bi-kpi-val">{kpis.totalHouseholds}</h2>
            <small className="bi-kpi-unit">hogares</small>
          </div>
          <small className="bi-kpi-sub">
            ~{kpis.avgHouseholdSize} pers. / hogar
          </small>
        </article>

        <article className="panel bi-kpi-card">
          <small className="bi-kpi-label">Edad Mediana</small>
          <div className="bi-kpi-val-row">
            <h2 className="bi-kpi-val">{kpis.medianAge}</h2>
            <small className="bi-kpi-unit">años</small>
          </div>
          <small className="bi-kpi-sub">
            Población joven-adulta
          </small>
        </article>

        <article className="panel bi-kpi-card">
          <small className="bi-kpi-label">Niñez (0-17)</small>
          <div className="bi-kpi-val-row">
            <h2 className="bi-kpi-val">{kpis.childrenCount}</h2>
            <small className="bi-kpi-unit">menores</small>
          </div>
          <small className="bi-kpi-sub">
            {residents.length ? Math.round((kpis.childrenCount / residents.length) * 100) : 0}% población
          </small>
        </article>

        <article className="panel bi-kpi-card">
          <small className="bi-kpi-label">Adultos Mayores</small>
          <div className="bi-kpi-val-row">
            <h2 className="bi-kpi-val">{kpis.elderlyCount}</h2>
            <small className="bi-kpi-unit">60+ años</small>
          </div>
          <small className="bi-kpi-sub">
            Atención prioritaria
          </small>
        </article>

        <article className="panel bi-kpi-card">
          <small className="bi-kpi-label">Cédulas Válidas</small>
          <div className="bi-kpi-val-row">
            <h2 className="bi-kpi-val">{cneData.idCards['Cédula Válida']}</h2>
            <small className="bi-kpi-unit">titulares</small>
          </div>
          <small className="bi-kpi-sub">
            {residents.length ? Math.round((cneData.idCards['Cédula Válida'] / residents.length) * 100) : 0}% auditados
          </small>
        </article>
      </section>

      {/* Barra de Sub-Pestañas */}
      <nav className="bi-subnav" aria-label="Categorías analíticas">
        {[
          { id: 'demografia', label: 'Demografía & Pirámide', shortLabel: 'Demografía', icon: 'groups' },
          { id: 'servicios', label: 'Servicios & Infraestructura', shortLabel: 'Servicios & Gas', icon: 'propane_tank' },
          { id: 'vulnerabilidad', label: 'Salud & Casos Vulnerables', shortLabel: 'Salud Comunal', icon: 'medical_services' },
          { id: 'electoral', label: 'CNE & Registro Electoral', shortLabel: 'Electoral CNE', icon: 'how_to_vote' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`bi-subnav-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{tab.icon}</span>
            <span>{isMobile ? tab.shortLabel : tab.label}</span>
          </button>
        ))}
      </nav>

      {/* TAB 1: Demografía */}
      {activeTab === 'demografia' && (
        <div className="bi-charts-grid">
          <article className="panel bi-chart-card bi-chart-card--wide">
            <div className="bi-chart-card-header">
              <h3>Pirámide Poblacional por Rango Etario y Género</h3>
              <small>Estructura generacional comunitaria (Hombres a la izquierda vs Mujeres a la derecha)</small>
            </div>
            <EChart option={agePyramidOption} height={isMobile ? 290 : 340} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Distribución por Género</h3>
              <small>Proporción demográfica consolidada</small>
            </div>
            <EChart option={genderDonutOption} height={isMobile ? 240 : 280} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Concentración por Consejo Comunal</h3>
              <small>Habitantes distribuidos por consejos comunales</small>
            </div>
            <EChart option={zoneBarOption} height={isMobile ? 240 : 280} />
          </article>
        </div>
      )}

      {/* TAB 2: Servicios & Infraestructura */}
      {activeTab === 'servicios' && (
        <div className="bi-charts-grid">
          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Proveedor de Gas Doméstico</h3>
              <small>Distribución del suministro en la comunidad</small>
            </div>
            <EChart option={gasProviderDonutOption} height={isMobile ? 240 : 280} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Capacidad de Cilindros de Gas</h3>
              <small>Total de bombonas por capacidad (kg)</small>
            </div>
            <EChart option={gasCylindersBarOption} height={isMobile ? 240 : 280} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Tipo de Conexión y Válvula</h3>
              <small>Pico Rápido vs Conexión Rosca para reemplazo logístico</small>
            </div>
            <EChart option={gasValveDonutOption} height={isMobile ? 240 : 280} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Almacenamiento de Agua Potable</h3>
              <small>Capacidad de tanques en litros por vivienda</small>
            </div>
            <EChart option={waterTankBarOption} height={isMobile ? 240 : 280} />
          </article>
        </div>
      )}

      {/* TAB 3: Salud & Casos Vulnerables */}
      {activeTab === 'vulnerabilidad' && (
        <div className="bi-charts-grid">
          <article className="panel bi-chart-card bi-chart-card--wide">
            <div className="bi-chart-card-header">
              <h3>Enfermedades Crónicas en la Comunidad</h3>
              <small>Casos diagnosticados para operativos de salud y fármacos</small>
            </div>
            <EChart option={chronicConditionsBarOption} height={isMobile ? 260 : 280} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Indicadores de Vulnerabilidad</h3>
              <small>Población prioritaria y carga veterinaria</small>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--card-2, #F8FAFC)', borderRadius: '10px', border: '1px solid var(--line, #E2E8F0)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600 }}>Gestación y Lactancia</span>
                <strong style={{ fontSize: '1.15rem', color: 'var(--red)' }}>{healthData.pregnantCount}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--card-2, #F8FAFC)', borderRadius: '10px', border: '1px solid var(--line, #E2E8F0)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600 }}>Adultos Mayores Vulnerables</span>
                <strong style={{ fontSize: '1.15rem', color: 'var(--text)' }}>{healthData.elderlyCount}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--card-2, #F8FAFC)', borderRadius: '10px', border: '1px solid var(--line, #E2E8F0)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600 }}>Mascotas / Carga Veterinaria</span>
                <strong style={{ fontSize: '1.15rem', color: 'var(--blue, #4A91AD)' }}>{healthData.petsTotal}</strong>
              </div>
            </div>
          </article>
        </div>
      )}

      {/* TAB 4: CNE & Registro Electoral */}
      {activeTab === 'electoral' && (
        <div className="bi-charts-grid">
          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Estatus Electoral REP (CNE)</h3>
              <small>Inscripción de mayores de 18 años ante el registro</small>
            </div>
            <EChart option={cneStatusDonutOption} height={isMobile ? 240 : 280} />
          </article>

          <article className="panel bi-chart-card">
            <div className="bi-chart-card-header">
              <h3>Auditoría de Documento de Identidad</h3>
              <small>Cédulas vigentes vs menores en trámite</small>
            </div>
            <EChart option={idCardsDonutOption} height={isMobile ? 240 : 280} />
          </article>

          <article className="panel bi-chart-card bi-chart-card--wide">
            <div className="bi-chart-card-header">
              <h3>Concentración por Centro de Votación</h3>
              <small>Planteles y centros asignados por el CNE a los electores del censo</small>
            </div>
            <EChart option={cneCenterBarOption} height={isMobile ? 290 : 300} />
          </article>
        </div>
      )}
    </div>
  );
}
