(function () {
    var THEME_KEY = 'modular-theme';

    function applyTheme(theme) {
        var isLight = theme === 'light';
        document.documentElement.classList.toggle('theme-light', isLight);
        document.documentElement.setAttribute('data-bs-theme', isLight ? 'light' : 'dark');
        var icon = document.getElementById('theme-icon');
        if (icon) icon.className = isLight ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
        if (window.api && window.api.theme && typeof window.api.theme.setTheme === 'function') {
            window.api.theme.setTheme(theme);
        }
    }

    function toggleTheme() {
        var current = localStorage.getItem(THEME_KEY) || 'dark';
        var next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
    }

    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);

    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
}());
