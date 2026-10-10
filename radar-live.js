(() => {
  const money = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge = n => n >= 85 ? 'success' : n >= 70 ? 'primary' : n >= 50 ? 'warning' : 'secondary';
  const profile = () => {
    try { return JSON.parse(localStorage.getItem('licitaRadarProfile') || localStorage.getItem('licita_profile') || '{}') || {}; }
    catch { return {}; }
  };

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

    input.id = 'radar-q';
    if (selects[0]) selects[0].id = 'radar-uf';
    if (selects[1]) selects[1].id = 'radar-min';
    search.id = 'radar-search';

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
      if (pp.valorMin) params.set('valorMin', pp.valorMin);
      if (pp.valorMax) params.set('valorMax', pp.valorMax);

      status.className = 'alert alert-light border d-flex align-items-center gap-2 mb-4';
      status.innerHTML = '<span class="spinner-border spinner-border-sm text-primary"></span><span>Buscando oportunidades abertas no PNCP...</span>';
      search.disabled = true;
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-muted">Carregando dados reais...</td></tr>';

      try {
        const r = await fetch(`/api/pncp?${params}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
        const rows = (j.data || []).filter(x => (x.score?.compatibilidade ?? 0) >= minScore);
        status.className = 'alert alert-success border-0 mb-4';
        status.innerHTML = `<strong>PNCP conectado.</strong> ${rows.length} oportunidade(s) exibida(s) de ${j.total} encontrada(s).`;
        tbody.innerHTML = rows.length ? rows.map(x => {
          const s = x.score || {};
          const prazo = s.diasRestantes == null ? '—' : s.diasRestantes <= 0 ? 'Hoje' : `${s.diasRestantes} dia${s.diasRestantes === 1 ? '' : 's'}`;
          const id = encodeURIComponent(x.numeroControlePNCP || x.id || '');
          return `<tr>
            <td><div class="fw-semibold">${esc(x.orgao || x.unidade || 'Órgão não informado')}</div><small class="text-muted">${esc(x.modalidade || '')}</small></td>
            <td style="white-space:normal;min-width:320px"><div>${esc(x.objeto || 'Sem descrição')}</div><small class="text-muted">${esc(x.municipio || '')}${x.uf ? ' · '+esc(x.uf) : ''}</small></td>
            <td>${money(x.valorEstimado)}</td>
            <td><span class="badge bg-${badge(s.compatibilidade)}-subtle text-${badge(s.compatibilidade)}">${s.compatibilidade ?? 0}%</span></td>
            <td>${prazo}</td>
            <td><a class="btn btn-sm btn-outline-primary" href="./analise.html?id=${id}">Analisar</a></td>
          </tr>`;
        }).join('') : '<tr><td colspan="6" class="text-center py-5"><div class="fw-semibold">Nenhuma oportunidade com esses filtros.</div><small class="text-muted">Reduza a compatibilidade mínima ou altere a busca.</small></td></tr>';
      } catch (e) {
        status.className = 'alert alert-danger mb-4';
        status.innerHTML = `<strong>Backend indisponível.</strong> ${esc(e.message)}. Esta página precisa ser aberta pelo deploy da Vercel, não pelo GitHub Pages.`;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-danger">Não foi possível carregar o PNCP.</td></tr>';
      } finally {
        search.disabled = false;
      }
    }

    // Ajusta o cabeçalho para os dados reais sem alterar o tema.
    const tr = table?.querySelector('thead tr');
    if (tr) tr.innerHTML = '<th>Órgão</th><th>Objeto</th><th>Valor</th><th>Compatibilidade</th><th>Prazo</th><th>Ação</th>';
    search.addEventListener('click', load);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(setup, 0));
  else setTimeout(setup, 0);
})();
