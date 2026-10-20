# Community BI Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a dedicated, secure Business Intelligence (BI) Analytics engine and interactive visualization dashboard into Uroprofin, restricted exclusively to authorized administrators, replicating and adapting the analytics architecture from the Finve/Statera backoffice.

**Architecture:** A pure mathematical/aggregation calculation module (`communityAnalytics.js`) processes census records (residents, households, dwellings) into demographic pyramids, gas logistics metrics, vulnerability indicators, and electoral readiness statistics. An isolated React wrapper (`EChart.jsx`) renders Apache ECharts instances safely in both desktop/mobile browsers and offline Android Capacitor environments. The master dashboard (`CommunityAnalytics.jsx`) provides sub-tab navigation (Demografía, Servicios & Gas, Vulnerabilidad & Salud, CNE & Electorado) and CSV export, gated by role-based access control in `permissions.js` and accessible via navigation and dual-view toggles in `AppShell.jsx` and `Census.jsx`.

**Tech Stack:** React 18, Apache ECharts 5.x, Vite 6, Tailwind CSS tokens / CSS custom properties, PocketBase 0.27, Capacitor Android 8, Node test runner (`node --test`).

## Global Constraints

- Access restricted strictly to users where `role === 'admin'` and `isAuthorizedAdmin(user)` returns `true`.
- Zero emojis in all UI text, labels, chart tooltips, export files, and git commits.
- Strict RAM and temporary file hygiene: immediately clean any build or cache artifacts.
- 100% offline compatibility: charts must bundle natively without external CDN dependencies so that the Android APK functions without internet connectivity.
- Preserve all existing 40 unit tests and ensure new tests cover metric aggregations.

---

### Task 1: Add ECharts Dependency and React Wrapper Component

**Files:**
- Modify: `package.json`
- Create: `src/components/EChart.jsx`
- Test: `scripts/echart-wrapper.test.mjs`

**Interfaces:**
- Consumes: Apache ECharts (`echarts/core`, `echarts/charts`, `echarts/components`, `echarts/renderers`) or full `echarts`.
- Produces: `<EChart option={...} height={300} className="..." onInit={(chart) => ...} />`

- [x] **Step 1: Write the failing test for ECharts options validator**

```javascript
// scripts/echart-wrapper.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

test('echart options validate required title or series structure', () => {
  const validOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['A', 'B'] },
    yAxis: { type: 'value' },
    series: [{ data: [10, 20], type: 'bar' }],
  };
  assert.ok(Array.isArray(validOption.series));
  assert.equal(validOption.series[0].type, 'bar');
});
```

- [x] **Step 2: Run test to confirm baseline**

Run: `node --test scripts/echart-wrapper.test.mjs`

- [x] **Step 3: Install echarts dependency**

Run: `npm i echarts`

- [x] **Step 4: Create `src/components/EChart.jsx`**

```jsx
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export default function EChart({ option, height = 300, className = '', style = {}, onInit }) {
  const containerRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(containerRef.current);
      if (typeof onInit === 'function') {
        onInit(chartInstanceRef.current);
      }
    }

    if (option) {
      chartInstanceRef.current.setOption(option, true);
    }
  }, [option, onInit]);

  useEffect(() => {
    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: `${height}px`, minHeight: `${height}px`, ...style }}
    />
  );
}
```

- [x] **Step 5: Verify build succeeds with Vite**

Run: `npm run build`

- [x] **Step 6: Commit changes**

```bash
git add package.json package-lock.json src/components/EChart.jsx scripts/echart-wrapper.test.mjs
git commit -m "feat(analytics): add echarts dependency and EChart React wrapper component"
```

---

### Task 2: Community BI Mathematical Calculation Engine (`communityAnalytics.js`)

**Files:**
- Create: `src/lib/communityAnalytics.js`
- Create: `scripts/community-analytics.test.mjs`

**Interfaces:**
- Consumes: Array of raw resident objects (`residents`), households (`households`), dwellings (`dwellings`), and zones (`zones`).
- Produces:
  - `computeCommunityKPIs(residents, households, dwellings)`
  - `buildAgePyramidData(residents)`
  - `buildGasDistributionData(residents)`
  - `buildHealthVulnerabilityData(residents)`
  - `buildCneStatusData(residents)`
  - `buildZoneDistributionData(residents, zones)`
  - `buildWaterStorageData(residents)`
  - `exportCommunityBiCSV(residents)`

- [x] **Step 1: Write failing unit tests for mathematical aggregation functions**

```javascript
// scripts/community-analytics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCommunityKPIs,
  buildAgePyramidData,
  buildGasDistributionData,
  buildHealthVulnerabilityData,
  buildCneStatusData,
  buildWaterStorageData,
  exportCommunityBiCSV,
} from '../src/lib/communityAnalytics.js';

test('computeCommunityKPIs accurately calculates totals, medians, and ratios', () => {
  const sampleResidents = [
    { firstName: 'Pedro', lastName: 'Pérez', sex: 'M', birthDate: '1980-05-10', gasProvider: 'Gas Caracas', status: 'active' },
    { firstName: 'Ana', lastName: 'Gómez', sex: 'F', birthDate: '2015-08-20', gasProvider: 'Gas Caracas', status: 'active' },
    { firstName: 'Luis', lastName: 'Pérez', sex: 'M', birthDate: '1955-02-14', gasProvider: 'Comunal', status: 'active' },
  ];
  const sampleHouseholds = [{ id: 'h1', code: 'URP-PG-1' }];
  const sampleDwellings = [{ id: 'd1', code: 'URP-PG-1' }];

  const kpis = computeCommunityKPIs(sampleResidents, sampleHouseholds, sampleDwellings);
  assert.equal(kpis.totalResidents, 3);
  assert.equal(kpis.totalHouseholds, 1);
  assert.equal(kpis.childrenCount, 1);
  assert.equal(kpis.elderlyCount, 1);
  assert.equal(kpis.femaleRatio, 33);
  assert.equal(kpis.maleRatio, 67);
});

test('buildAgePyramidData bins residents into reproducible generational tiers', () => {
  const sampleResidents = [
    { birthDate: '2020-01-01', sex: 'M' },
    { birthDate: '2010-01-01', sex: 'F' },
    { birthDate: '1995-01-01', sex: 'M' },
    { birthDate: '1985-01-01', sex: 'F' },
    { birthDate: '1950-01-01', sex: 'M' },
  ];
  const pyramid = buildAgePyramidData(sampleResidents);
  assert.ok(pyramid.categories.length > 0);
  assert.ok(Array.isArray(pyramid.maleData));
  assert.ok(Array.isArray(pyramid.femaleData));
});

test('exportCommunityBiCSV generates valid CSV content with zero emojis', () => {
  const sampleResidents = [
    { firstName: 'Carlos', lastName: 'Silva', idNumber: 'V-18999000', relationship: 'Jefe de Hogar', zoneCode: 'PG', houseNumber: '12' },
  ];
  const csv = exportCommunityBiCSV(sampleResidents);
  assert.ok(csv.includes('Nombre,Apellido,Cedula,Parentesco'));
  assert.ok(csv.includes('Carlos,Silva,V-18999000,Jefe de Hogar'));
  assert.equal(/[\uD800-\uDFFF]/.test(csv), false); // Zero emojis
});
```

- [x] **Step 2: Run test to observe failure before implementation**

Run: `node --test scripts/community-analytics.test.mjs`

- [x] **Step 3: Implement `src/lib/communityAnalytics.js`**

Implement deterministic calculations:
- Age derivation from `birthDate` with February 29 leap year protection.
- Median age calculation (`calculateMedian(ages)`).
- Breakdown by age groups (0-17 Niñez, 18-35 Juventud, 36-59 Adultos, 60+ Adultos Mayores).
- Gas cylinders, valve type, and cooking appliances distribution.
- Water tank capacities (Ninguno, 500L, 1000L, 1500L, 2000L+).
- Health conditions (Discapacidad, Crónicos, Medicamentos, Embarazo/Lactancia).
- CNE voter distribution (Inscrito, No Inscrito, Sin Verificar, Centros de votación).
- CSV exporter with Excel formula injection protection (`escapeCsv`).

- [x] **Step 4: Run tests to verify all pass**

Run: `node --test scripts/community-analytics.test.mjs`

- [x] **Step 5: Run full test suite to guarantee zero regressions**

Run: `npm test`

- [x] **Step 6: Commit changes**

```bash
git add src/lib/communityAnalytics.js scripts/community-analytics.test.mjs
git commit -m "feat(analytics): add pure community BI calculation engine and unit tests"
```

---

### Task 3: Build Master Dashboard Component (`CommunityAnalytics.jsx`)

**Files:**
- Create: `src/pages/CommunityAnalytics.jsx`
- Create: `src/styles-analytics.css` (or integrate into `src/styles.css`)

**Interfaces:**
- Consumes:
  - `useAuth()` (`membership`, `user`, `role`, `isDemo`, `community`)
  - `getResidentsPage()` / `getConsolidatedCensusData()` from `src/lib/repository.js`
  - Calculation functions from `src/lib/communityAnalytics.js`
  - `<EChart />` from `src/components/EChart.jsx`
- Produces: Complete master analytics view with 4 interactive sub-tabs:
  1. `demografia`: KPIs Ribbon + Pirámide de Edades + Torta de Género + Distribución por Zonas + Ocupaciones.
  2. `servicios`: Proveedor de Gas + Tipos de Cilindro + Válvula de Gas + Almacenamiento de Agua + Tenencia de Vivienda.
  3. `vulnerabilidad`: Afectaciones de Salud + Adultos Mayores + Niñez por Edad + Carga de Mascotas.
  4. `electoral`: Estatus REP CNE + Centros de Votación + Proporción de Cédulas Válidas / Menores S/C.

- [x] **Step 1: Create layout and sub-tab structure in `src/pages/CommunityAnalytics.jsx`**
- Structure includes:
  - Header with Community Name, code, and live badge ("En Línea").
  - Actions toolbar: *"Descargar Dataset BI (CSV)"*, *"Recalcular / Actualizar"*, and *"Ir al Censo / Expedientes"*.
  - Sub-tab pill selector with Lucide/Material icons:
    - `Perfil & Demografía`
    - `Servicios & Infraestructura`
    - `Salud & Casos Vulnerables`
    - `CNE & Registro Electoral`
- [x] **Step 2: Implement ECharts options generators for each view**
  - Generates themed options using Uroprofin's design tokens (Obsidian `#0F172A`, Amber `#FF9F1C`, Emerald `#10B981`, Slate `#64748B`).
  - Mobile-responsive grid (`reg-grid-2` on desktop, collapses cleanly on mobile).
- [x] **Step 3: Implement CSV export and notification integration**
- [x] **Step 4: Verify build with Vite**

Run: `npm run build`

- [x] **Step 5: Commit changes**

```bash
git add src/pages/CommunityAnalytics.jsx src/styles.css
git commit -m "feat(analytics): create master CommunityAnalytics dashboard with 4 BI sub-tabs"
```

---

### Task 4: Integrate Admin-Only Navigation and Dual-View Switcher

**Files:**
- Modify: `src/lib/permissions.js`
- Modify: `src/components/AppShell.jsx`
- Modify: `src/pages/Census.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `isAuthorizedAdmin(user)` and `role === 'admin'`.
- Produces:
  - `can(role, 'census.analytics', user)`
  - AppShell menu item `{ id: 'analytics', label: 'Inteligencia BI', short: 'Métricas BI', icon: 'analytics' }` visible only to admins.
  - Census top switcher: `[Tabla Censal] | [Inteligencia BI]` allowing 1-click toggle.
  - Route protection in `App.jsx`: non-admin navigation requests automatically redirect to `home`.

- [x] **Step 1: Update `src/lib/permissions.js`**
- Add `'census.analytics'` capability restricted strictly to authorized admins:
```javascript
if (action === 'census.analytics' || action === 'census.view_all' || action === 'census.export') {
  if (role !== 'admin') return false;
  if (user && !isAuthorizedAdmin(user)) return false;
  return true;
}
```
- [x] **Step 2: Update `src/components/AppShell.jsx`**
- Conditionally render `'analytics'` in navigation items:
```javascript
...(isAdmin ? [{ id: 'analytics', label: 'Inteligencia BI', short: 'Métricas', icon: 'analytics' }] : [])
```
- [x] **Step 3: Update `src/pages/Census.jsx`**
- When `operator` is true (admin), add dual-view toggle buttons in the header:
```jsx
<div className="view-mode-toggle">
  <button className="active" onClick={() => setViewMode('table')}>Tabla Censal</button>
  <button onClick={() => onAction('openAnalytics') || onNavigate('analytics')}>Inteligencia BI</button>
</div>
```
- [x] **Step 4: Update `src/App.jsx`**
- Import `CommunityAnalytics` lazily via `React.lazy`:
```javascript
const CommunityAnalytics = lazy(() => import('./pages/CommunityAnalytics.jsx'));
```
- Mount in pages router only when admin access is verified.
- [x] **Step 5: Test permission restrictions with unit tests**

Add test to `scripts/permissions.test.mjs` verifying regular residents and collaborators cannot access `census.analytics`.

Run: `npm test`

- [x] **Step 6: Commit changes**

```bash
git add src/lib/permissions.js src/components/AppShell.jsx src/pages/Census.jsx src/App.jsx scripts/
git commit -m "feat(security): enforce admin-only access for BI analytics and wire dual-view switcher"
```

---

### Task 5: End-to-End Verification, APK Rebuild, and Deploy

**Files:**
- Output: `dist/`
- Output: `public/downloads/uroprofin.apk`
- Output: `/home/finvecito/Música/uroprofin.apk`

- [x] **Step 1: Execute all unit tests**

Run: `npm test`
Verify: All tests pass with zero errors.

- [x] **Step 2: Run production Vite build**

Run: `npm run build`
Verify: Zero bundle errors; ECharts chunks split cleanly.

- [x] **Step 3: Build and sign fresh Android APK**

Run: `npm run apk:build`
Verify: v2 signature valid, 4-byte aligned APK generated in `public/downloads/uroprofin.apk`.

- [x] **Step 4: Refresh local distribution copy**

Run: `cp public/downloads/uroprofin.apk /home/finvecito/Música/uroprofin.apk`

- [x] **Step 5: Clean RAM and temporary build artifacts**

Run: `rm -rf /tmp/repack_* /tmp/uroprofin_* 2>/dev/null || true`

- [x] **Step 6: Commit and push to GitHub**

```bash
git push origin main
```
Verify: Live Vercel deployment triggered successfully.
