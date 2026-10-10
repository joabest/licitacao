const AREA_KEYWORDS={
  ti:['ti','tecnologia','informatica','informática','computador','computadores','notebook','notebooks','rede','redes','servidor','software','suporte técnico','manutenção de computadores'],
  construcao:['construção','construcao','obra','obras','reforma','engenharia civil','alvenaria','pintura','telhado','piso','hidráulica','hidraulica','elétrica','eletrica','manutenção predial'],
  alimentacao:['alimentação','alimentacao','alimentos','refeição','refeicoes','refeições','merenda','cesta básica','cesta basica','gêneros alimentícios','generos alimenticios','buffet','coffee break'],
  limpeza:['limpeza','higienização','higienizacao','conservação','conservacao','copeiragem','sanitização','sanitizacao','material de limpeza'],
  saude:['saúde','saude','medicamento','medicamentos','hospitalar','médico','medico','odontológico','odontologico','enfermagem','laboratório','laboratorio'],
  escritorio:['papelaria','material de escritório','material de escritorio','papel a4','toner','cartucho','expediente','mobiliário de escritório','mobiliario de escritorio'],
  seguranca:['segurança','seguranca','vigilância','vigilancia','monitoramento','cftv','controle de acesso','alarme','portaria'],
  logistica:['transporte','logística','logistica','frete','entrega','veículo','veiculo','motorista','armazenagem','distribuição','distribuicao']
};
const $=s=>document.querySelector(s);
const norm=s=>(s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const csv=s=>norm(s).split(',').map(x=>x.trim()).filter(Boolean);
const clamp=n=>Math.max(0,Math.min(100,Math.round(n)));

function getProfile(){
  const saved=JSON.parse(localStorage.getItem('licitaradar_profile')||'{}');
  return {
    cnae:saved.cnae||'', areas:saved.areas||[], positivas:saved.positivas||'', negativas:saved.negativas||'',
    uf:saved.uf||'', valorMin:saved.valorMin||'', valorMax:saved.valorMax||''
  };
}
function setProfile(p){localStorage.setItem('licitaradar_profile',JSON.stringify(p));}
function fillProfile(){
  const p=getProfile(); $('#cnae').value=p.cnae; $('#positivas').value=p.positivas; $('#negativas').value=p.negativas; $('#uf').value=p.uf; $('#valorMin').value=p.valorMin; $('#valorMax').value=p.valorMax;
  [...$('#areas').options].forEach(o=>o.selected=p.areas.includes(o.value));
}
function readProfile(){return {cnae:$('#cnae').value.trim(),areas:[...$('#areas').selectedOptions].map(o=>o.value),positivas:$('#positivas').value.trim(),negativas:$('#negativas').value.trim(),uf:$('#uf').value.trim().toUpperCase(),valorMin:$('#valorMin').value,valorMax:$('#valorMax').value};}

function analyse(opp,p){
  const text=norm(opp.objeto);
  const cnaeTerms=norm(p.cnae).split(/[^a-z0-9]+/).filter(x=>x.length>3);
  const positive=csv(p.positivas);
  const negative=csv(p.negativas);
  const areaTerms=p.areas.flatMap(a=>AREA_KEYWORDS[a]||[]).map(norm);
  const cnaeHits=[...new Set(cnaeTerms.filter(t=>text.includes(t)))];
  const posHits=[...new Set(positive.filter(t=>text.includes(t)))];
  const areaHits=[...new Set(areaTerms.filter(t=>text.includes(t)))];
  const negHits=[...new Set(negative.filter(t=>text.includes(t)))];

  let objectScore=0;
  if(areaHits.length) objectScore+=Math.min(45,20+areaHits.length*8);
  if(cnaeHits.length) objectScore+=Math.min(25,10+cnaeHits.length*5);
  if(posHits.length) objectScore+=Math.min(20,8+posHits.length*6);
  objectScore-=Math.min(40,negHits.length*20);
  objectScore=clamp(objectScore);

  let regionScore=100;
  if(p.uf) regionScore=opp.uf===p.uf?100:35;
  let valueScore=100;
  const v=Number(opp.valor||0), min=Number(p.valorMin||0), max=Number(p.valorMax||0);
  if(min&&v<min)valueScore=45;
  if(max&&v>max)valueScore=45;
  if((min&&v<min*0.5)||(max&&v>max*2))valueScore=20;
  const compatibility=clamp(objectScore*.75+regionScore*.10+valueScore*.15);

  let viability=75;
  if(regionScore<50) viability-=18;
  if(valueScore<50) viability-=18;
  if(negHits.length) viability-=20;
  if(opp.dias<=1) viability-=25; else if(opp.dias<=3) viability-=12; else if(opp.dias>=7) viability+=8;
  viability=clamp(viability);

  let urgency=30;
  if(opp.dias<=1)urgency=100; else if(opp.dias<=2)urgency=90; else if(opp.dias<=3)urgency=80; else if(opp.dias<=5)urgency=65; else if(opp.dias<=7)urgency=50;

  const reasons=[];
  if(areaHits.length) reasons.push(`Área compatível: ${areaHits.slice(0,4).join(', ')}`);
  if(cnaeHits.length) reasons.push(`Termos relacionados à atividade: ${cnaeHits.slice(0,4).join(', ')}`);
  if(posHits.length) reasons.push(`Palavras positivas encontradas: ${posHits.join(', ')}`);
  if(p.uf) reasons.push(opp.uf===p.uf?`UF ${opp.uf} dentro da preferência`:`UF ${opp.uf} fora da preferência ${p.uf}`);
  if(v) reasons.push(valueScore>=80?'Valor dentro da faixa desejada':'Valor fora da faixa desejada');
  if(negHits.length) reasons.push(`Atenção: termos negativos encontrados: ${negHits.join(', ')}`);
  if(!reasons.length) reasons.push('Poucos sinais de aderência foram encontrados no objeto informado.');
  return {compatibility,viability,urgency,reasons};
}
function badge(score){const c=score>=80?'success':score>=60?'warning':'danger';return `<span class="badge bg-${c}-subtle text-${c}">${score}%</span>`}
function render(r){
  const urgent=r.urgency>=80?'Alta':r.urgency>=55?'Média':'Baixa';
  $('#resultado').innerHTML=`<div class="row g-3"><div class="col-md-4"><div class="card bg-primary-subtle shadow-none mb-0"><div class="card-body"><small class="text-muted">Compatibilidade</small><h2 class="mb-0 mt-1">${badge(r.compatibility)}</h2></div></div></div><div class="col-md-4"><div class="card bg-success-subtle shadow-none mb-0"><div class="card-body"><small class="text-muted">Viabilidade</small><h2 class="mb-0 mt-1">${badge(r.viability)}</h2></div></div></div><div class="col-md-4"><div class="card bg-warning-subtle shadow-none mb-0"><div class="card-body"><small class="text-muted">Urgência</small><h4 class="mb-0 mt-2">${urgent} · ${r.urgency}%</h4></div></div></div></div><div class="card mt-3 mb-0"><div class="card-body"><h6 class="fw-semibold">Por que apareceu para mim?</h6><ul class="mb-3">${r.reasons.map(x=>`<li class="mb-1">${x}</li>`).join('')}</ul><div class="d-flex gap-2 flex-wrap"><button class="btn btn-sm btn-success feedback" data-value="interesse">Tenho interesse</button><button class="btn btn-sm btn-outline-danger feedback" data-value="sem-relacao">Não tem relação</button><button class="btn btn-sm btn-outline-secondary feedback" data-value="nao-posso">Não consigo participar</button></div><div id="feedbackMsg" class="small text-muted mt-2"></div></div></div>`;
  document.querySelectorAll('.feedback').forEach(b=>b.addEventListener('click',()=>{const history=JSON.parse(localStorage.getItem('licitaradar_feedback')||'[]');history.push({value:b.dataset.value,objeto:$('#objeto').value,date:new Date().toISOString()});localStorage.setItem('licitaradar_feedback',JSON.stringify(history.slice(-100)));$('#feedbackMsg').textContent='Feedback salvo. Ele poderá ser usado para ajustar o perfil quando conectarmos o backend.';}));
}

$('#salvarPerfil').addEventListener('click',()=>{setProfile(readProfile());const btn=$('#salvarPerfil');const old=btn.textContent;btn.textContent='Perfil salvo';btn.classList.add('btn-success');setTimeout(()=>{btn.textContent=old;btn.classList.remove('btn-success')},1400)});
$('#exemplo').addEventListener('click',()=>{$('#objeto').value='Contratação de empresa especializada para suporte técnico, manutenção preventiva e corretiva de computadores, notebooks e infraestrutura de redes.';$('#oppUf').value='SP';$('#oppValor').value='184000';$('#dias').value='4';});
$('#analisar').addEventListener('click',()=>{const p=readProfile();setProfile(p);render(analyse({objeto:$('#objeto').value,uf:$('#oppUf').value.trim().toUpperCase(),valor:Number($('#oppValor').value||0),dias:Number($('#dias').value||99)},p));});
fillProfile();