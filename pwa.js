(() => {
  const hint = document.getElementById('ios-install-hint');
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isIos && !isStandalone && !localStorage.getItem('razvantv.install-hint-dismissed')) {
    hint?.classList.add('visible');
  }
  hint?.querySelector('.dismiss')?.addEventListener('click', () => {
    hint.classList.remove('visible');
    localStorage.setItem('razvantv.install-hint-dismissed', '1');
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .catch(error => console.error('Nu s-a putut înregistra aplicația offline:', error));
    });
  }
})();
