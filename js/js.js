(function () {
  const THEME_KEY = 'bioenergy-theme';

  function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
      btn.setAttribute('title', isDark ? 'Ativar modo claro' : 'Ativar modo escuro');
      const sunIcon = btn.querySelector('.icon-sun');
      const moonIcon = btn.querySelector('.icon-moon');
      if (sunIcon && moonIcon) {
        sunIcon.style.display = isDark ? 'block' : 'none';
        moonIcon.style.display = isDark ? 'none' : 'block';
      }
    }
  }

  window.darkmode = function () {
    const isDark = !document.body.classList.contains('dark-mode');
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    applyTheme(isDark);
    if (typeof window.redrawSolarChart === 'function') {
      window.redrawSolarChart();
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') {
      applyTheme(true);
    } else {
      applyTheme(false);
    }

    const mobileBtn = document.getElementById('nav-mobile-btn');
    const navLinks = document.getElementById('nav-links');
    if (mobileBtn && navLinks) {
      mobileBtn.addEventListener('click', function () {
        const expanded = navLinks.classList.toggle('open');
        mobileBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
    }

    // FAQ Accordion
    const faqQuestions = document.querySelectorAll('.faq-question');
    faqQuestions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const item = btn.closest('.faq-item');
        if (!item) return;
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function (openItem) {
          openItem.classList.remove('open');
        });
        if (!wasOpen) {
          item.classList.add('open');
        }
      });
    });
  });
})();