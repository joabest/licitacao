(() => {
  const PNCP = 'https://pncp.gov.br/api/consulta/v1/contratacoes/proposta';
  const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge = n => n >= 85 ? 'success' : n >= 70 ? 'primary' : n >= 50 ? 'warning' : 'secondary';
  const clean = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
  const ymd = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;

  const profile = () => {
    try { return JSON.parse(localStorage.getItem('licitaRadarProfile') || localStorage.getItem('licita_profile') || '{}') || {}; }
    catch { return {}; }
  };

  function normalize(c) {
    const u = c.unidadeOrgao || {};
    const o = c.orgaoEntidade || {};
    return {
      id: c.numeroControlePNCP || `${o.cnpj || ''}-${c.anoCompra || ''}-${c.sequencialCompra || c.numeroCompra || ''}`,
      numeroControlePNCP: c.numeroControlePNCP || null,
      objeto: c.objetoCompra || '',
      informacaoComplementar: c.informacaoComplementar || '',
      modalidade: c.modalidadeNome || '',
      modalidadeId: c.modalidadeId ?? null,
      valorEstimado: Number(c.valorTotalEstimado || 0),
      dataEncerramentoProposta: c.dataEncerramentoProposta || null,
      orgao: o.razaosocial || o.razaoSocial || '',
      unidade: u.nomeUnidade || '',
      municipio: u.municipioNome || '',
      uf: u.ufSigla || ''
    };
  }

  function localScore(x, q, p) {
    const text = clean(`${x.objeto} ${x.informacaoComplementar} ${x.modalidade}`);
    const positives = [...split(q), ...(Array.isArray(p.areas) ? p.areas : split(p.areas)), ...(Array.isArray(p.positivas) ? p.positivas : split(p.positivas))].map(clean);
    const negatives = (Array.isArray(p.negativas) ? p.negativas : split(p.negativas)).map(clean);
    let compat = 20;
    const hits = positives.filter(t => t && text.includes(t)).length;
    compat += Math.min(55, hits * 11);
    compat -= Math.min(45, negatives.filter(t => t && text.includes(t)).length * 18);
    if (p.uf && x.uf && clean(p.uf) === clean(x.uf)) compat += 10;
    const end = x.dataEncerramentoProposta ? Date.parse(x.dataEncerramentoProposta) : NaN;
    const days = Number.isFinite(end) ? Math.ceil((end - Date.now()) / 86400000) : null;
    const urgencia = days == null ? 45 : days <= 1 ? 100 : days <= 3 ? 88 : days <= 7 ? 72 : days <= 14 ? 55 : 35;
    return { compatibilidade: clamp(compat), urgencia, diasRestantes: days };
  }

  async function directPncp({uf, q}) {
    const final = new Date();
    final.setDate(final.getDate() + 90);
    const modalidades = [4, 6, 8];
    const calls = modalidades.map(async modalidade => {
      const params = new URLSearchParams({ dataFinal: ymd(final), codigoModalidadeContratacao: String(modalidade), pagina: '1', tamanhoPagina: '100' });
      if (uf) params.set('uf', uf);
      const r = await fetch(`${PNCP}?${params}`, { headers: { accept: 'application/json' } });
      if (r.status === 204) return [];
      if (!r.ok) throw new Error(`PNCP retornou HTTP ${r.status}`);
      const j = await r.json();
      return (j.data || []).map(normalize);
    });
    const settled = await Promise.allSettled(calls);
    const ok = settled.filter(x => x.status === 'fulfilled');
    if (!ok.length) throw (settled[0]?.reason || new Error('PNCP indisponível'));
    const map = new Map();
    ok.flatMap(x => x.value).forEach(x => { if (x.id) map.set(x.id, x); });
    const p = profile();
    const now = Date.now();
    const data = [...map.values()]
      .filter(x => !x.dataEncerramentoProposta || Date.parse(x.dataEncerramentoProposta) >= now - 60000)
      .map(x => ({ ...x, score: localScore(x, q, p) }))
      .sort((a,b) => b.score.compatibilidade - a.score.compatibilidade || b.score.urgencia - a.score.urgencia);
    return { source: 'PNCP direto', total: data.length, data };
  }

  async function backendPncp(params) {
    const r = await fetch(`/api/pncp?${params}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
    return j;
  }

  function setup() {
    const heading = [...document.querySelectorAll('h5')].find(x => x.textContent.trim() === 'Radar de Licitações');
    if (!heading) return;
    const body = heading.closest('.card-body');
    if (!body) return;
    const input = body.querySelector('input.form-control');
    const selects = body.querySelectorAll('select.form-select');
    const search = [...body.querySelectorAll('button')].find(b => b.textContent.trim() === 'Buscar');
    const table = body.querySelector('table');
    const tbody = table?.querySelector('tbody');
    if (!input || !search || !tbody) return;

    const status = document.createElement('div');
    status.id = 'radar-status';
    status.className = 'alert alert-light border d-flex align-items-center gap-2 mb-4';
    status.innerHTML = '<span class="spinner-border spinner-border-sm text-primary"></span><span>Conectando ao PNCP...</span>';
    table.closest('.table-responsive')?.before(status);

    const p = profile();
    if (p.uf && selects[0]) selects[0].value = p.uf;
    if (p.positivas && !input.value) input.value = Array.isArray(p.positivas) ? p.positivas.join(', ') : p.positivas;

    async function load() {
      const q = input.value.trim();
      const uf = selects[0]?.value && selects[0].value !== 'Todos' ? selects[0].value : '';
      const minScore = Number(String(selects[1]?.value || '0').replace('%','')) || 0;
      const pp = profile();
      const params = new URLSearchParams({ tamanhoPagina: '100', modalidades: '4,6,8' });
      if (uf) params.set('uf', uf);
      if (q) params.set('q', q);
      if (pp.areas) params.set('areas', Array.isArray(pp.areas) ? pp.areas.join(',') : pp.areas);
      if (pp.positivas) params.set('positivas', Array.isArray(pp.positivas) ? pp.positivas.join(',') : pp.positivas);
      if (pp.negativas) params.set('negativas', Array.isArray(pp.negativas) ? pp.negativas.join(',') : pp.negativas);
      if (pp.uf) params.set('ufPreferida', pp.uf);

      status.className = 'alert alert-light border d-flex align-items-center gap-2 mb-4';
      status.innerHTML = '<span class="spinner-border spinner-border-sm text-primary"></span><span>Buscando oportunidades abertas no PNCP...</span>';
      search.disabled = true;
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-muted">Carregando dados reais...</td></tr>';

      try {
        let j;
        if (location.hostname.endsWith('github.io')) {
          j = await directPncp({ uf, q });
        } else {
          try { j = await backendPncp(params); }
          catch { j = await directPncp({ uf, q }); }
        }
        const rows = (j.data || []).filter(x => (x.score?.compatibilidade ?? 0) >= minScore);
        status.className = 'alert alert-success border-0 mb-4';
        status.innerHTML = `<strong>PNCP conectado.</strong> ${rows.length} oportunidade(s) exibida(s) de ${j.total} encontrada(s). <small>Fonte: ${esc(j.source || 'PNCP')}</small>`;
        tbody.innerHTML = rows.length ? rows.map(x => {
          const s = x.score || {};
          const prazo = s.diasRestantes == null ? '—' : s.diasRestantes <= 0 ? 'Hoje' : `${s.diasRestantes} dia${s.diasRestantes === 1 ? '' : 's'}`;
          const id = encodeURIComponent(x.numeroControlePNCP || x.id || '');
          return `<tr><td><div class="fw-semibold">${esc(x.orgao || x.unidade || 'Órgão não informado')}</div><small class="text-muted">${esc(x.modalidade || '')}</small></td><td style="white-space:normal;min-width:320px"><div>${esc(x.objeto || 'Sem descrição')}</div><small class="text-muted">${esc(x.municipio || '')}${x.uf ? ' · '+esc(x.uf) : ''}</small></td><td>${money(x.valorEstimado)}</td><td><span class="badge bg-${badge(s.compatibilidade)}-subtle text-${badge(s.compatibilidade)}">${s.compatibilidade ?? 0}%</span></td><td>${prazo}</td><td><a class="btn btn-sm btn-outline-primary" href="./analise.html?id=${id}">Analisar</a></td></tr>`;
        }).join('') : '<tr><td colspan="6" class="text-center py-5"><div class="fw-semibold">Nenhuma oportunidade com esses filtros.</div><small class="text-muted">Reduza a compatibilidade mínima ou altere a busca.</small></td></tr>';
      } catch (e) {
        status.className = 'alert alert-danger mb-4';
        status.innerHTML = `<strong>PNCP não respondeu ao navegador.</strong> ${esc(e.message)}. Nesse caso precisaremos manter um proxy backend.`;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-danger">Não foi possível carregar o PNCP.</td></tr>';
      } finally { search.disabled = false; }
    }

    const tr = table?.querySelector('thead tr');
    if (tr) tr.innerHTML = '<th>Órgão</th><th>Objeto</th><th>Valor</th><th>Compatibilidade</th><th>Prazo</th><th>Ação</th>';
    search.addEventListener('click', load);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(setup, 0));
  else setTimeout(setup, 0);
})();
