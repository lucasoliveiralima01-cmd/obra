/* =====================================================================
   App instalável: registra o sw.js (funcionamento sem sinal e
   notificações) e mostra o botão "Instalar app" quando o navegador
   permite (Chrome e Edge, no celular e no computador).
   No iPhone a instalação é pelo Safari: Compartilhar > Adicionar à Tela
   de Início (a tela de Avisos explica isso).
   ===================================================================== */
(function () {
  'use strict';
  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let pedido = null;
  window.AppObra = { ehIOS, instalado, registro: null };
  if ('serviceWorker' in navigator) {
    window.AppObra.registro = navigator.serviceWorker.register('sw.js').catch(e => { console.warn('sw', e); return null; });
  }
  function botao() {
    if (!pedido || instalado() || document.getElementById('bInstalar')) return;
    const h = document.querySelector('.hctl'); if (!h) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'hbtn'; b.id = 'bInstalar';
    b.textContent = '⬇ Instalar app'; b.title = 'Instala o painel como um aplicativo neste aparelho';
    b.onclick = async () => { const p = pedido; pedido = null; b.remove(); try { p.prompt(); await p.userChoice; } catch (e) {} };
    h.insertBefore(b, h.firstChild);
  }
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); pedido = ev; botao(); });
  window.addEventListener('appinstalled', () => { pedido = null; const b = document.getElementById('bInstalar'); if (b) b.remove(); });
  document.addEventListener('DOMContentLoaded', botao);
})();
