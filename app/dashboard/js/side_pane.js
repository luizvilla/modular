(function () {
    var STORAGE_KEY  = 'sidePaneListHeight';
    var COLLAPSE_KEY = 'sidePaneCollapsed';
    var MIN_HEIGHT   = 80;
    var MAX_RATIO    = 0.70;
    var DEFAULT_RATIO = 0.45;

    var resizer = document.getElementById('side-pane-resizer');
    var list    = document.getElementById('side-pane-list');
    var pane    = document.getElementById('side-pane');
    var toggle  = document.getElementById('side-pane-toggle');
    var chevron = document.getElementById('side-pane-chevron');

    if (!resizer || !list || !pane) return;

    function setListHeight(px) {
        list.style.flex   = 'none';
        list.style.height = px + 'px';
    }

    // Restore or set initial list height
    var saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (saved && saved >= MIN_HEIGHT) {
        setListHeight(saved);
    } else {
        requestAnimationFrame(function () {
            setListHeight(Math.max(MIN_HEIGHT, Math.floor(pane.offsetHeight * DEFAULT_RATIO)));
        });
    }

    // Collapse toggle
    if (toggle) {
        var collapsed = localStorage.getItem(COLLAPSE_KEY) === 'true';
        if (collapsed) {
            pane.classList.add('collapsed');
        }

        toggle.addEventListener('click', function () {
            collapsed = !collapsed;
            pane.classList.toggle('collapsed', collapsed);
            localStorage.setItem(COLLAPSE_KEY, String(collapsed));
        });
    }

    // Resizer drag
    var startY = 0;
    var startH = 0;

    function onMouseMove(e) {
        var maxH = pane.offsetHeight * MAX_RATIO;
        var newH = Math.max(MIN_HEIGHT, Math.min(maxH, startH + (e.clientY - startY)));
        setListHeight(newH);
    }

    function onMouseUp() {
        resizer.classList.remove('dragging');
        localStorage.setItem(STORAGE_KEY, parseInt(list.style.height, 10));
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup',   onMouseUp);
    }

    resizer.addEventListener('mousedown', function (e) {
        e.preventDefault();
        startY = e.clientY;
        startH = list.offsetHeight;
        resizer.classList.add('dragging');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup',   onMouseUp);
    });
}());

// Side pane tab switching
(function () {
    var TAB_KEY = 'sidePaneActiveTab';
    var tabs = document.querySelectorAll('#side-pane-tabs .side-tab');
    var panels = {
        datasources: document.getElementById('side-tab-datasources'),
        widgets:     document.getElementById('side-tab-widgets')
    };

    function activateTab(tabId) {
        if (!panels[tabId]) return;
        tabs.forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
        Object.keys(panels).forEach(function (key) {
            panels[key].style.display = key === tabId ? '' : 'none';
        });
        localStorage.setItem(TAB_KEY, tabId);
    }

    tabs.forEach(function (btn) {
        btn.addEventListener('click', function () { activateTab(btn.dataset.tab); });
    });

    activateTab(localStorage.getItem(TAB_KEY) || 'datasources');
}());
