document.addEventListener('DOMContentLoaded',()=>{
  const nav=document.querySelector('#sidebarnav');
  if(!nav || nav.querySelector('a[href="./copiloto.html"]')) return;
  const analysisLink=[...nav.querySelectorAll('a.sidebar-link')].find(a=>a.getAttribute('href')==='./analise.html');
  const li=document.createElement('li');
  li.className='sidebar-item';
  li.innerHTML='<a class="sidebar-link" href="./copiloto.html" aria-expanded="false"><iconify-icon icon="solar:magic-stick-3-line-duotone"></iconify-icon><span class="hide-menu">Copiloto IA</span></a>';
  if(analysisLink?.parentElement) analysisLink.parentElement.before(li); else nav.appendChild(li);
});
