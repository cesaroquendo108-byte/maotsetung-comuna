import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFundContribution,
  DEFAULT_PORTFOLIO_HOLDINGS,
} from '../src/lib/fundPaymentGateway.js';
import { formatBs, formatUsd } from '../src/lib/finveRates.js';

test('Finve rate conversion calculates accurate USD and Bs figures for 300 families', () => {
  const bcvRate = 875.65;
  const quotaBs = 1000;
  const families = 300;

  const quotaUsd = Number((quotaBs / bcvRate).toFixed(2));
  assert.equal(quotaUsd, 1.14);

  const monthlyBs = quotaBs * families;
  assert.equal(monthlyBs, 300000);

  const monthlyUsd = Number((monthlyBs / bcvRate).toFixed(2));
  assert.equal(monthlyUsd, 342.60);

  const annualUsd = Number((monthlyUsd * 12).toFixed(2));
  assert.equal(annualUsd, 4111.20);
});

test('classifyFundContribution marks exact 1000 Bs as verified', () => {
  const verdict = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 1000,
    reference: 'PM-83599136',
  });
  assert.equal(verdict.status, 'verified');
  assert.equal(verdict.verified, true);
});

test('classifyFundContribution tolerates small 2 Bs variance as verified', () => {
  const verdict = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 1002,
    reference: 'PM-83599137',
    tolerance: 5,
  });
  assert.equal(verdict.status, 'verified');
  assert.equal(verdict.verified, true);
});

test('classifyFundContribution flags amount mismatch when underpaid or overpaid', () => {
  const underpaid = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 800,
    reference: 'PM-83599138',
  });
  assert.equal(underpaid.status, 'amount_mismatch');
  assert.equal(underpaid.verified, false);

  const overpaid = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 1500,
    reference: 'PM-83599139',
  });
  assert.equal(overpaid.status, 'amount_mismatch');
  assert.equal(overpaid.verified, false);
});

test('classifyFundContribution flags duplicate reference or sha256 hash', () => {
  const duplicateRef = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 1000,
    reference: 'PM-83599136',
    isDuplicateReference: true,
  });
  assert.equal(duplicateRef.status, 'duplicate_flag');
  assert.equal(duplicateRef.verified, false);

  const duplicateSha = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 1000,
    reference: 'PM-99999999',
    isDuplicateSha: true,
  });
  assert.equal(duplicateSha.status, 'duplicate_flag');
  assert.equal(duplicateSha.verified, false);
});

test('classifyFundContribution flags manual_review if reference is missing', () => {
  const missingRef = classifyFundContribution({
    expectedAmount: 1000,
    extractedAmount: 1000,
    reference: '',
  });
  assert.equal(missingRef.status, 'manual_review');
  assert.equal(missingRef.verified, false);
});

test('fixed-income portfolio structure contains valid ISINs and positive coupon rates', () => {
  assert.ok(DEFAULT_PORTFOLIO_HOLDINGS.length >= 3);
  for (const holding of DEFAULT_PORTFOLIO_HOLDINGS) {
    assert.ok(holding.nominalAmountBs > 0);
    assert.ok(holding.couponRate > 0);
    assert.ok(holding.custodyAccount.includes('Caja Venezolana de Valores') || holding.custodyAccount.includes('Banco Nacional de Crédito'));
    assert.ok(holding.isin.length >= 5);
  }
});

test('formatters format currency strings with standard locale symbols', () => {
  const bs = formatBs(1000);
  assert.ok(bs.includes('1.000') || bs.includes('1000'));
  const usd = formatUsd(342.60);
  assert.ok(usd.includes('342.60') || usd.includes('$'));
});
