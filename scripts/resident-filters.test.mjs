import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResidentIdFilter,
  buildResidentSearchFilter,
  buildResidentSegmentFilter,
  buildResidentCouncilFilter,
  buildResidentsFilter,
  isElectoralSegment,
  profileMatchesElectoralSegment,
} from '../src/lib/residentFilters.js';

test('la búsqueda por nombre no agrega una condición de cédula vacía', () => {
  const filter = buildResidentSearchFilter('María Pérez');
  assert.match(filter, /firstName/);
  assert.match(filter, /lastName/);
  assert.doesNotMatch(filter, /idNumberNormalized/);
});

test('la búsqueda por cédula conserva solo sus dígitos y escapa texto', () => {
  const filter = buildResidentSearchFilter('V-12"34');
  assert.match(filter, /idNumberNormalized ~ "1234"/);
  assert.match(filter, /V-12\\"34/);
});

test('los segmentos etarios se calculan con cortes reproducibles', () => {
  const today = new Date(2026, 6, 22);
  assert.equal(
    buildResidentSegmentFilter('Adulto', today),
    'birthDate != "" && birthDate <= "2008-07-22 23:59:59.999Z" && birthDate > "1966-07-22 23:59:59.999Z"',
  );
  assert.equal(buildResidentSegmentFilter('Todos', today), '');
  assert.equal(buildResidentSegmentFilter('segmento-no-permitido', today), '');
});

test('el corte etario sigue siendo una fecha válida el 29 de febrero', () => {
  const filter = buildResidentSegmentFilter('Niñez', new Date(2024, 1, 29));
  assert.match(filter, /2006-02-28 23:59:59\.999Z/);
});

test('el filtro final mantiene el alcance recibido y combina búsqueda y segmento', () => {
  const filter = buildResidentsFilter('community = "comuna1"', {
    query: 'Ana',
    segment: 'Gas Caracas',
    today: new Date(2026, 6, 22),
  });
  assert.match(filter, /^community = "comuna1" && status = "active"/);
  assert.match(filter, /firstName ~ "Ana"/);
  assert.match(filter, /gasProvider = "Gas Caracas"$/);
});

test('los filtros electorales se calculan sobre perfiles ya cargados', () => {
  assert.equal(isElectoralSegment('Sin centro electoral'), true);
  assert.equal(profileMatchesElectoralSegment({ status: 'unknown', votingCenterName: '' }, 'Sin centro electoral'), true);
  assert.equal(profileMatchesElectoralSegment({ status: 'registered', votingCenterName: 'Centro A' }, 'Con centro electoral'), true);
  assert.equal(profileMatchesElectoralSegment({ status: 'registered', source: 'resultadosconvzla-2024' }, 'Fuente 2024'), true);
  assert.equal(profileMatchesElectoralSegment({ status: 'not_registered', votingCenterName: '' }, 'No inscrito CNE'), true);
});

test('el filtro por IDs evita valores no válidos', () => {
  const filter = buildResidentIdFilter(['abc123abc123abc', 'id con espacios']);
  assert.match(filter, /abc123abc123abc/);
  assert.doesNotMatch(filter, /espacios/);
});

test('el filtro por consejo comunal filtra por zoneCode y household code', () => {
  assert.equal(buildResidentCouncilFilter('Todos'), '');
  assert.equal(buildResidentCouncilFilter(''), '');
  const filterSac = buildResidentCouncilFilter('SAC');
  assert.equal(filterSac, '(zoneCode = "SAC" || household.code ~ "SAC")');

  const combined = buildResidentsFilter('community = "comuna1"', {
    query: 'Carmen',
    segment: 'Todos',
    council: 'MNG',
  });
  assert.match(combined, /zoneCode = "MNG" \|\| household\.code ~ "MNG"/);
  assert.match(combined, /firstName ~ "Carmen"/);

  assert.equal(buildResidentCouncilFilter('CC-SAC'), '(zoneCode = "SAC" || household.code ~ "SAC")');
  assert.equal(buildResidentSegmentFilter('CC El Manguito'), '(zoneCode = "MNG" || household.code ~ "MNG")');
});
