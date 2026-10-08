/* Applies the saved colour theme before the first paint, so a dark-theme user never sees a white flash.
   Kept as a separate file (not an inline script) because the site's security policy only allows scripts from its own origin. */
(function () {
  try {
    var choice = localStorage.getItem('tinker_theme') || 'system';
    var dark = choice === 'dark' || (choice === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage unavailable: the light theme */
  }
})();
