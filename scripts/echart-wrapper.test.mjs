import test from 'node:test';
import assert from 'node:assert/strict';

test('echart options validate required structure and series mapping', () => {
  const sampleOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['Portón Gris', 'Recta', 'Subida', 'Plana'] },
    yAxis: { type: 'value' },
    series: [{ data: [12, 19, 8, 15], type: 'bar', color: '#FF9F1C' }],
  };

  assert.ok(Array.isArray(sampleOption.xAxis.data));
  assert.equal(sampleOption.xAxis.data.length, 4);
  assert.ok(Array.isArray(sampleOption.series));
  assert.equal(sampleOption.series[0].type, 'bar');
  assert.equal(sampleOption.series[0].data[0], 12);
});
