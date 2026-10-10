document.addEventListener('DOMContentLoaded',()=>{
  const bodyWrapper=document.querySelector('.body-wrapper');
  if(bodyWrapper && !bodyWrapper.querySelector('.site-footer')){
    const footer=document.createElement('footer');
    footer.className='site-footer';
    footer.innerHTML=`<div class="footer-inner"><div>© ${new Date().getFullYear()} LicitaRadar</div><div><a href="./radar.html">Radar</a> · <a href="./empresas.html">Empresas</a> · <a href="./configuracoes.html">Configurações</a></div></div>`;
    bodyWrapper.appendChild(footer);
  }

  const header=document.querySelector('.app-header');
  if(header){
    header.style.removeProperty('top');
    header.style.removeProperty('left');
  }

  function normalizeMobile(){
    if(window.innerWidth<=767){
      document.body.classList.add('mobile-layout');
      const btn=document.querySelector('.app-header .navbar-nav .btn');
      if(btn) btn.setAttribute('aria-label','Buscar licitações');
    }else{
      document.body.classList.remove('mobile-layout');
    }
  }
  normalizeMobile();
  window.addEventListener('resize',normalizeMobile);
});
