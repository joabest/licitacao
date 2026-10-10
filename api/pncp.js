const BASE_URL = 'https://pncp.gov.br/api/consulta';

const clean = (v = '') => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const list = (v = '') => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const ymd = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function normalizeCompra(c) {
  const u = c.unidadeOrgao || {};
  const o = c.orgaoEntidade || {};
  return {
    id: c.numeroControlePNCP || `${o.cnpj || ''}-${c.anoCompra || ''}-${c.sequencialCompra || c.numeroCompra || ''}`,
    numeroControlePNCP: c.numeroControlePNCP || null,
    numeroCompra: c.numeroCompra || null,
    anoCompra: c.anoCompra || null,
    processo: c.processo || null,
    objeto: c.objetoCompra || '',
    informacaoComplementar: c.informacaoComplementar || '',
    modalidadeId: c.modalidadeId ?? null,
    modalidade: c.modalidadeNome || '',
    modoDisputa: c.modoDisputaNome || '',
    situacao: c.situacaoCompraNome || '',
    valorEstimado: Number(c.valorTotalEstimado || 0),
    valorHomologado: Number(c.valorTotalHomologado || 0),
    dataAberturaProposta: c.dataAberturaProposta || null,
    dataEncerramentoProposta: c.dataEncerramentoProposta || null,
    dataPublicacaoPncp: c.dataPublicacaoPncp || null,
    dataAtualizacao: c.dataAtualizacao || null,
    orgao: o.razaosocial || o.razaoSocial || '',
    cnpjOrgao: o.cnpj || '',
    unidade: u.nomeUnidade || '',
    codigoUnidade: u.codigoUnidade || '',
    municipio: u.municipioNome || '',
    codigoIbge: u.codigoIbge || null,
    uf: u.ufSigla || '',
    amparoLegal: c.amparoLegal || null,
    srp: Boolean(c.srp),
  };
}

function score(compra, prefs) {
  const text = clean(`${compra.objeto} ${compra.informacaoComplementar} ${compra.modalidade}`);
  const positives = [...prefs.areas, ...prefs.positivas, ...prefs.q].map(clean).filter(Boolean);
  const negatives = prefs.negativas.map(clean).filter(Boolean);
  let compat = 20;
  const reasons = [];

  let hits = 0;
  for (const term of positives) {
    if (term && text.includes(term)) { hits++; reasons.push(`Termo compatível: ${term}`); }
  }
  compat += Math.min(55, hits * 11);

  const negHits = negatives.filter(term => term && text.includes(term));
  if (negHits.length) {
    compat -= Math.min(45, negHits.length * 18);
    reasons.push(`Termo negativo: ${negHits.join(', ')}`);
  }

  if (prefs.uf && compra.uf && clean(prefs.uf) === clean(compra.uf)) {
    compat += 10;
    reasons.push(`UF preferida: ${compra.uf}`);
  }

  if (prefs.min > 0 || prefs.max > 0) {
    const inside = compra.valorEstimado >= prefs.min && (!prefs.max || compra.valorEstimado <= prefs.max);
    if (inside) { compat += 10; reasons.push('Valor dentro da faixa desejada'); }
    else compat -= 8;
  }

  const now = Date.now();
  const end = compra.dataEncerramentoProposta ? Date.parse(compra.dataEncerramentoProposta) : NaN;
  const days = Number.isFinite(end) ? Math.ceil((end - now) / 86400000) : null;
  let urgencia = 45;
  if (days !== null) {
    if (days <= 1) urgencia = 100;
    else if (days <= 3) urgencia = 88;
    else if (days <= 7) urgencia = 72;
    else if (days <= 14) urgencia = 55;
    else urgencia = 35;
  }
  const viabilidade = clamp(70 + (compra.valorEstimado > 0 ? 8 : -8) + (days !== null && days >= 3 ? 10 : -5) + (negHits.length ? -20 : 0), 0, 100);
  return { compatibilidade: clamp(Math.round(compat), 0, 100), viabilidade, urgencia, diasRestantes: days, motivos: reasons.slice(0, 8) };
}

async function fetchPncp(modalidade, params) {
  const qs = new URLSearchParams({
    dataFinal: params.dataFinal,
    codigoModalidadeContratacao: String(modalidade),
    pagina: String(params.pagina),
    tamanhoPagina: String(params.tamanhoPagina),
  });
  if (params.uf) qs.set('uf', params.uf.toUpperCase());
  if (params.codigoMunicipioIbge) qs.set('codigoMunicipioIbge', params.codigoMunicipioIbge);
  if (params.cnpj) qs.set('cnpj', params.cnpj.replace(/\D/g, ''));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(`${BASE_URL}/v1/contratacoes/proposta?${qs}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (r.status === 204) return { data: [], totalRegistros: 0, totalPaginas: 0 };
    if (!r.ok) throw new Error(`PNCP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const modalidades = list(req.query.modalidades || '4,6,8').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 8);
  const pagina = clamp(Number(req.query.pagina || 1), 1, 1000);
  const tamanhoPagina = clamp(Number(req.query.tamanhoPagina || 100), 1, 500);
  const params = {
    dataFinal: /^\d{8}$/.test(String(req.query.dataFinal || '')) ? String(req.query.dataFinal) : ymd(),
    pagina,
    tamanhoPagina,
    uf: String(req.query.uf || '').trim(),
    codigoMunicipioIbge: String(req.query.codigoMunicipioIbge || '').trim(),
    cnpj: String(req.query.cnpj || '').trim(),
  };
  const prefs = {
    q: list(req.query.q || ''),
    areas: list(req.query.areas || ''),
    positivas: list(req.query.positivas || ''),
    negativas: list(req.query.negativas || ''),
    uf: String(req.query.ufPreferida || req.query.uf || '').trim(),
    min: Number(req.query.valorMin || 0),
    max: Number(req.query.valorMax || 0),
  };

  try {
    const settled = await Promise.allSettled(modalidades.map(m => fetchPncp(m, params)));
    const fontes = settled.map((s, i) => ({ modalidade: modalidades[i], ok: s.status === 'fulfilled', erro: s.status === 'rejected' ? String(s.reason?.message || s.reason) : null }));
    const map = new Map();
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      for (const raw of (s.value.data || [])) {
        const n = normalizeCompra(raw);
        if (n.id) map.set(n.id, n);
      }
    }

    const now = Date.now();
    let data = [...map.values()].filter(x => !x.dataEncerramentoProposta || Date.parse(x.dataEncerramentoProposta) >= now - 60000);
    data = data.map(x => ({ ...x, score: score(x, prefs) }));

    if (prefs.q.length || prefs.areas.length || prefs.positivas.length) {
      data.sort((a, b) => b.score.compatibilidade - a.score.compatibilidade || b.score.urgencia - a.score.urgencia);
    } else {
      data.sort((a, b) => (Date.parse(a.dataEncerramentoProposta || '2999-01-01') - Date.parse(b.dataEncerramentoProposta || '2999-01-01')));
    }

    return res.status(200).json({
      source: 'PNCP',
      endpoint: '/v1/contratacoes/proposta',
      queriedAt: new Date().toISOString(),
      filtros: { ...params, modalidades },
      total: data.length,
      fontes,
      data,
    });
  } catch (e) {
    return res.status(502).json({ error: 'Falha ao consultar o PNCP', detail: String(e?.message || e) });
  }
}
