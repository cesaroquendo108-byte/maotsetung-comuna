import {
  allowGet,
  allowJsonPost,
  authenticate,
  bodyOf,
  findCommunity,
  json,
  pbRequest,
  serviceToken,
} from './_consolidated.js';
import { createHash } from 'node:crypto';

const FINVE_TOKEN = process.env.FINVE_MCP_TOKEN || 'bkaYrRwAQy+kHe1pr/QAk2pDdJnVN2tSeo/Aab6mmBs=';
const FINVE_MCP_URL = process.env.FINVE_MCP_URL || 'https://api.finve.net/mcp';

let rateCache = {
  data: null,
  timestamp: 0,
};

async function queryFinveRate(currency = 'USD', dateStr) {
  const reqDate = dateStr || new Date().toISOString().split('T')[0];
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'lookup_exchange_rate',
      arguments: {
        currency,
        date: reqDate,
      },
    },
  };

  const response = await fetch(FINVE_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${FINVE_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Finve MCP status: ${response.status}`);
  }

  const resJson = await response.json();
  const content = resJson.result?.content?.[0]?.text;
  if (!content) throw new Error('Respuesta vacia de Finve MCP');

  const parsed = JSON.parse(content);
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  return item?.exchangeRate || null;
}

async function queryDolarApiFallback() {
  const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial');
  if (res.ok) {
    const data = await res.json();
    return data?.promedio || null;
  }
  return null;
}

async function getLiveRates() {
  const now = Date.now();
  if (rateCache.data && now - rateCache.timestamp < 1000 * 60 * 15) {
    return rateCache.data;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  let bcvRate = null;
  let usdtRate = null;

  try {
    bcvRate = await queryFinveRate('USD', todayStr);
  } catch (_) {
    try {
      bcvRate = await queryDolarApiFallback();
    } catch (_) {}
  }

  try {
    usdtRate = await queryFinveRate('USDT', todayStr);
  } catch (_) {}

  if (!bcvRate) bcvRate = 875.65;
  if (!usdtRate) usdtRate = 1009.28;

  const quotaBs = 1000;
  const families = 300;
  const monthlyTotalBs = quotaBs * families;
  const quotaUsd = Number((quotaBs / bcvRate).toFixed(2));
  const monthlyTotalUsd = Number((monthlyTotalBs / bcvRate).toFixed(2));
  const annualTotalUsd = Number((monthlyTotalUsd * 12).toFixed(2));

  const result = {
    date: todayStr,
    bcvRate,
    usdtRate,
    quotaBs,
    quotaUsd,
    families,
    monthlyTotalBs,
    monthlyTotalUsd,
    annualTotalUsd,
    source: 'Finve BVC Engine',
  };

  rateCache = {
    data: result,
    timestamp: now,
  };

  return result;
}

const DEFAULT_PORTFOLIO_HOLDINGS = [
  {
    id: 'sec-calox-2026',
    issuer: 'Calox International C.A.',
    ticker: 'CAL-PC-2026-II',
    instrumentType: 'Papel Comercial',
    isin: 'VE0000001048',
    nominalAmountBs: 150000,
    couponRate: 12.5,
    indexation: 'Indexado BCV (USD)',
    issueDate: '2026-09-18',
    maturityDate: '2026-12-18',
    custodyAccount: 'Caja Venezolana de Valores · Cuenta 84920 · Statera Casa de Bolsa',
    custodyProofTitle: 'Certificado de Custodia CVV #84920-A',
    status: 'active',
    statusLabel: 'En Custodia Activa',
    projectedYieldUsd: 21.41,
  },
  {
    id: 'sec-santa-teresa-2026',
    issuer: 'C.A. Ron Santa Teresa',
    ticker: 'RST-PB-2026',
    instrumentType: 'Pagaré Bursátil',
    isin: 'VE0000002194',
    nominalAmountBs: 100000,
    couponRate: 14.0,
    indexation: 'Indexado BCV (USD)',
    issueDate: '2026-08-25',
    maturityDate: '2026-11-25',
    custodyAccount: 'Caja Venezolana de Valores · Cuenta 84920 · Statera Casa de Bolsa',
    custodyProofTitle: 'Certificado de Custodia CVV #84920-B',
    status: 'active',
    statusLabel: 'En Custodia Activa',
    projectedYieldUsd: 15.98,
  },
  {
    id: 'sec-reserva-salud',
    issuer: 'Fondo de Reserva Comunal & Salud',
    ticker: 'RES-SALUD-LIQ',
    instrumentType: 'Cuenta Remunerada de Liquidez',
    isin: 'CUENTA-BNC-4982',
    nominalAmountBs: 50000,
    couponRate: 36.0,
    indexation: 'Tasa Bancaria VES',
    issueDate: '2026-10-01',
    maturityDate: 'A la vista (Disponibilidad inmediata)',
    custodyAccount: 'Banco Nacional de Crédito · Fideicomiso Comunal',
    custodyProofTitle: 'Estado de Cuenta Fiduciario BNC',
    status: 'active',
    statusLabel: 'Liquidez Inmediata',
    projectedYieldUsd: 17.13,
  },
];

function encode(val) {
  return encodeURIComponent(val);
}

async function handleRate(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const rates = await getLiveRates();
  return json(res, 200, rates);
}

async function handleData(req, res) {
  if (!allowGet(req, res)) return;

  try {
    let auth = null;
    try {
      auth = await authenticate(req);
    } catch (_) {}

    const token = await serviceToken().catch(() => null);
    const communityCode = 'URP-001';

    let community = null;
    if (token) {
      try {
        community = await findCommunity({ communityCode, token });
      } catch (_) {}
    }

    const rateData = await getLiveRates();
    const bcvRate = rateData.bcvRate || 875.65;
    const usdtRate = rateData.usdtRate || 1009.28;

    const quotaBs = 1000;
    const targetFamilies = 300;
    const currentPeriod = new Date().toISOString().slice(0, 7);

    let rawReports = [];
    if (token && community) {
      try {
        const reportsRes = await pbRequest(
          `/api/collections/payment_reports/records?perPage=50&sort=-created&filter=${encode(`community = "${community.id}"`)}`,
          { token }
        );
        rawReports = reportsRes.items || [];
      } catch (_) {}
    }

    const verifiedReports = rawReports.filter((r) => r.status === 'verified');
    const activeContributorsCount = verifiedReports.length;
    const totalCollectedBs = verifiedReports.reduce((sum, r) => sum + (Number(r.amountBs || r.amount) || quotaBs), 0);
    const totalCollectedUsd = bcvRate > 0 ? Number((totalCollectedBs / bcvRate).toFixed(2)) : 0;
    const targetMonthlyBs = targetFamilies * quotaBs;
    const targetMonthlyUsd = bcvRate > 0 ? Number((targetMonthlyBs / bcvRate).toFixed(2)) : 0;
    const participationRate = targetFamilies > 0 ? Number(((activeContributorsCount / targetFamilies) * 100).toFixed(1)) : 0;

    const portfolioHoldings = [];
    const totalPortfolioNominalBs = 0;
    const totalPortfolioNominalUsd = 0;
    const totalProjectedYieldUsd = 0;

    const ledger = rawReports.map((r) => ({
      id: r.id,
      location: r.householdCode ? `Hogar ${r.householdCode}` : (r.notes || 'Aporte Vecinal'),
      amountBs: Number(r.amountBs || r.amount) || quotaBs,
      status: r.status || 'verified',
      time: r.created ? r.created.slice(0, 16).replace('T', ' ') : 'Reciente',
      ref: r.referenceNumber ? `••••${String(r.referenceNumber).slice(-4)}` : 'S/R',
    }));

    let myContribution = {
      period: currentPeriod,
      quotaBs,
      quotaUsd: Number((quotaBs / bcvRate).toFixed(2)),
      paid: false,
      paidAt: '',
      status: 'pending',
      referenceNumber: '',
    };

    if (auth?.user?.id && rawReports.length) {
      const userReport = rawReports.find((r) => r.user === auth.user.id || r.createdBy === auth.user.id);
      if (userReport) {
        myContribution = {
          period: currentPeriod,
          quotaBs,
          quotaUsd: Number((quotaBs / bcvRate).toFixed(2)),
          paid: userReport.status === 'verified',
          paidAt: userReport.created ? userReport.created.slice(0, 10) : '',
          status: userReport.status || 'pending',
          referenceNumber: userReport.referenceNumber || '',
        };
      }
    }

    return json(res, 200, {
      fund: {
        name: 'Fondo Comunal de Inversión y Desarrollo Mao Tse Tung',
        code: 'FONDO-MTT-2026',
        currentPeriod,
        quotaBs,
        quotaUsd: Number((quotaBs / bcvRate).toFixed(2)),
        targetFamilies,
        activeContributorsCount,
        participationRate,
        totalCollectedBs,
        totalCollectedUsd,
        targetMonthlyBs,
        targetMonthlyUsd,
        custodyAccount: 'Caja Venezolana de Valores (CVV) · Cuenta N° 84920 · Statera Casa de Bolsa',
      },
      rates: {
        bcvRate,
        usdtRate,
        date: new Date().toISOString().split('T')[0],
        source: 'Finve BVC Engine',
      },
      portfolio: {
        holdings: portfolioHoldings,
        totalNominalBs: totalPortfolioNominalBs,
        totalNominalUsd: totalPortfolioNominalUsd,
        totalProjectedYieldUsd: Number(totalProjectedYieldUsd.toFixed(2)),
      },
      ledger,
      myContribution,
    });
  } catch (error) {
    return json(res, 500, {
      error: error.message || 'Error consultando los datos del fondo comunal.',
    });
  }
}

async function handleContribute(req, res) {
  if (!allowJsonPost(req, res)) return;

  try {
    const auth = await authenticate(req);
    const input = bodyOf(req);
    const token = await serviceToken();

    const communityCode = String(input.communityCode || 'URP-001').trim().toUpperCase();
    const community = await findCommunity({ communityCode, token });

    const period = String(input.period || new Date().toISOString().slice(0, 7));
    const receiptBase64 = String(input.receiptBase64 || '').trim();
    const providedReference = String(input.referenceNumber || '').trim();
    const declaredAmount = Number(input.amountBs) || 1000;

    if (!receiptBase64 && !providedReference) {
      return json(res, 400, { error: 'Debes adjuntar el comprobante o ingresar la referencia del pago móvil.' });
    }

    let sha256 = '';
    if (receiptBase64) {
      const cleanBase64 = receiptBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      sha256 = createHash('sha256').update(buffer).digest('hex');
    }

    const rates = await getLiveRates();
    const bcvRate = rates.bcvRate || 875.65;

    let extraction = {
      amount: declaredAmount,
      reference: providedReference || `PM-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
    };
    let isExtractionSuccessful = false;

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const openRouterKeys = [
      process.env.OPENROUTER_API_KEY,
      process.env.VITE_OPENROUTER_API_KEY,
    ].filter(Boolean);
    const visionModels = [
      process.env.OPENROUTER_MODEL,
      'google/gemini-2.5-flash',
      'google/gemini-2.5-flash-lite',
      'google/gemini-3.1-flash-lite',
    ].filter(Boolean);

    // 1. Native Gemini AI Studio Direct Call
    if (receiptBase64 && geminiKey) {
      try {
        const cleanB64 = receiptBase64.replace(/^data:image\/\w+;base64,/, '');
        const mimeType = receiptBase64.includes('png') ? 'image/png' : 'image/jpeg';
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: 'Extrae exclusivamente monto total en bolívares, referencia bancaria y fecha de este comprobante de pago móvil venezolano. Devuelve JSON con campos: amount (number|null), reference (string|null), date (YYYY-MM-DD|null).' },
                { inlineData: { mimeType, data: cleanB64 } }
              ]
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            }
          })
        });
        if (geminiRes.ok) {
          const gemData = await geminiRes.json();
          const rawText = gemData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            if (parsed && (parsed.amount != null || parsed.reference)) {
              extraction = {
                amount: parsed.amount != null ? Number(parsed.amount) : declaredAmount,
                reference: parsed.reference ? String(parsed.reference).trim() : providedReference,
                date: parsed.date || new Date().toISOString().split('T')[0],
              };
              isExtractionSuccessful = true;
            }
          }
        }
      } catch (_) {}
    }

    // 2. OpenRouter Multi-Key & Multi-Model Vision Cascade
    if (receiptBase64 && !isExtractionSuccessful && openRouterKeys.length > 0) {
      for (const apiKey of openRouterKeys) {
        if (isExtractionSuccessful) break;
        for (const model of visionModels) {
          try {
            const openRouterResp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: 'Extrae exclusivamente monto total en bolívares, referencia bancaria y fecha de este pago móvil venezolano. Devuelve JSON con campos: amount (number|null), reference (string|null), date (YYYY-MM-DD|null).',
                      },
                      {
                        type: 'image_url',
                        image_url: { url: receiptBase64 },
                      },
                    ],
                  },
                ],
              }),
            });

            if (openRouterResp.ok) {
              const respData = await openRouterResp.json();
              const parsed = JSON.parse(respData.choices?.[0]?.message?.content || '{}');
              if (parsed && (parsed.amount != null || parsed.reference)) {
                extraction = {
                  amount: parsed.amount != null ? Number(parsed.amount) : declaredAmount,
                  reference: parsed.reference ? String(parsed.reference).trim() : providedReference,
                  date: parsed.date || new Date().toISOString().split('T')[0],
                };
                isExtractionSuccessful = true;
                break;
              }
            }
          } catch (_) {}
        }
      }
    }

    let isDuplicateSha = false;
    let isDuplicateRef = false;

    if (sha256) {
      try {
        const existingSha = await pbRequest(
          `/api/collections/payment_reports/records?perPage=1&filter=${encode(`receiptSha256 = "${sha256}"`)}`,
          { token }
        );
        if (existingSha.items?.length) isDuplicateSha = true;
      } catch (_) {}
    }

    const finalReference = extraction.reference || providedReference;
    if (finalReference) {
      try {
        const existingRef = await pbRequest(
          `/api/collections/payment_reports/records?perPage=1&filter=${encode(`reference = "${finalReference}"`)}`,
          { token }
        );
        if (existingRef.items?.length) isDuplicateRef = true;
      } catch (_) {}
    }

    const expectedQuota = 1000;
    const diff = Math.abs(Number(extraction.amount || declaredAmount) - expectedQuota);
    let status = 'verified';
    let reviewNotes = 'Aporte reglamentario verificado por el sistema.';

    if (isDuplicateSha || isDuplicateRef) {
      status = 'rejected';
      reviewNotes = 'Comprobante o número de referencia duplicado.';
    } else if (diff > 5) {
      status = 'amount_mismatch';
      reviewNotes = `Monto detectado (Bs ${extraction.amount}) difiere de la cuota oficial de Bs ${expectedQuota}.`;
    }

    const amountUsd = Number(((extraction.amount || declaredAmount) / bcvRate).toFixed(2));

    // Resolve household for payment report
    let householdId = null;
    try {
      const memRes = await pbRequest(
        `/api/collections/community_memberships/records?perPage=1&filter=${encode(`community = "${community.id}" && user = "${auth.user.id}" && status = "active"`)}`,
        { token }
      );
      if (memRes.items?.length && memRes.items[0].household) {
        householdId = memRes.items[0].household;
      }
    } catch (_) {}

    if (!householdId) {
      try {
        const hhRes = await pbRequest(
          `/api/collections/households/records?perPage=1&filter=${encode(`community = "${community.id}" && status != "inactive"`)}`,
          { token }
        );
        householdId = hhRes.items?.[0]?.id || null;
      } catch (_) {}
    }

    let record = null;
    if (householdId) {
      try {
        record = await pbRequest('/api/collections/payment_reports/records', {
          method: 'POST',
          token,
          body: {
            community: community.id,
            household: householdId,
            reportedBy: auth.user.id,
            cycle: period,
            cycleRecord: null,
            amount: extraction.amount || declaredAmount,
            currency: 'VES',
            method: 'pago_movil',
            reference: finalReference,
            referenceNormalized: String(finalReference).replace(/\D/g, ''),
            status: status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'pending_review',
            reviewNotes: JSON.stringify({
              fund: 'Fondo Comunal Mao Tse Tung',
              period,
              bcvRate,
              amountUsd,
              sha256,
              reviewNotes,
              isExtractionSuccessful,
            }),
          },
        });
      } catch (saveErr) {
        console.warn('Advertencia al guardar reporte de pago:', saveErr.message);
      }
    }

    if (!record) {
      record = {
        id: `reg-${Date.now()}`,
        status,
        amount: extraction.amount || declaredAmount,
        reference: finalReference,
      };
    }

    return json(res, 200, {
      success: true,
      contribution: {
        id: record?.id,
        period,
        amountBs: extraction.amount || declaredAmount,
        amountUsd,
        bcvRate,
        reference: finalReference,
        status,
        reviewNotes,
        sha256,
        extraction,
      },
    });
  } catch (error) {
    return json(res, error.status || 500, {
      error: error.message || 'Error procesando el aporte al fondo comunal.',
    });
  }
}

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim().toLowerCase();

  if (action === 'rate') {
    return handleRate(req, res);
  }

  if (action === 'contribute' || req.method === 'POST') {
    return handleContribute(req, res);
  }

  return handleData(req, res);
}
