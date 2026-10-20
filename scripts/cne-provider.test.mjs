import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDirectCne, normalizeResultados2024FromDocument } from '../server/cneProvider.js';

test('extrae centro electoral desde tablas estilo CNE', () => {
  const result = normalizeDirectCne(`
    <html>
      <body>
        <h1>Registro Electoral</h1>
        <table>
          <tr><td>Cédula:</td><td>V-00000000</td></tr>
          <tr><td>Nombre:</td><td>Persona de prueba</td></tr>
          <tr><td>Estado:</td><td>EDO. MIRANDA</td></tr>
          <tr><td>Municipio:</td><td>MP. SUCRE</td></tr>
          <tr><td>Parroquia:</td><td>PQ. PETARE</td></tr>
          <tr><td>Centro:</td><td>UNIDAD EDUCATIVA DE PRUEBA</td></tr>
          <tr><td>Dirección:</td><td>CALLE PRINCIPAL</td></tr>
        </table>
      </body>
    </html>
  `);

  assert.equal(result.status, 'registered');
  assert.equal(result.center, 'UNIDAD EDUCATIVA DE PRUEBA');
  assert.equal(result.address, 'CALLE PRINCIPAL');
  assert.equal(result.state, 'EDO. MIRANDA');
  assert.equal(result.municipality, 'MP. SUCRE');
  assert.equal(result.parish, 'PQ. PETARE');
  assert.equal(result.source, 'cne-direct');
});

test('marca no inscrito solo cuando el portal lo afirma explícitamente', () => {
  const result = normalizeDirectCne('Registro Electoral Esta cédula no está registrado');
  assert.equal(result.status, 'not_registered');
  assert.equal(result.registered, false);
  assert.equal(result.center, '');
});

test('cruza acta 2024 con CSV publico sin guardar URL ni votos', async () => {
  const resultByActa = new Map([
    ['999999_123456_0001Acta0001.jpg', {
      EDO: 'EDO. MIRANDA',
      MUN: 'MP. SUCRE',
      PAR: 'PQ. PETARE',
      CENTRO: '130901069',
      MESA: '1',
      URL: 'https://static.resultadosconvzla.com/999999_123456_0001Acta0001.jpg',
    }],
  ]);
  const tableByCenterMesa = new Map([
    ['130901069|1', {
      CODIGO_CV: '130901069',
      MESA: '1',
      'NOMBRE DEL CENTRO DE VOTACION': 'UNIDAD EDUCATIVA MUNICIPAL AGUSTIN AVELEDO',
      VOTANTES_MESA: '839',
    }],
  ]);

  const result = await normalizeResultados2024FromDocument(
    '<img src="https://static.resultadosconvzla.com/999999_123456_0001Acta0001.jpg" alt="Acta">',
    { index: { resultByActa, tableByCenterMesa } },
  );

  assert.equal(result.status, 'registered');
  assert.equal(result.center, 'UNIDAD EDUCATIVA MUNICIPAL AGUSTIN AVELEDO');
  assert.equal(result.address, 'EDO. MIRANDA · MP. SUCRE · PQ. PETARE · Mesa 1');
  assert.equal(result.source, 'resultadosconvzla-2024');
  assert.equal(JSON.stringify(result).includes('Acta0001'), false);
  assert.equal(JSON.stringify(result).includes('839'), false);
});
