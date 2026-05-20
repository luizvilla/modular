(function () {
    var STORAGE_KEY = 'sidePaneListHeight';
    var MIN_HEIGHT  = 80;
    var MAX_RATIO   = 0.85;

    var resizer = document.getElementById('side-pane-resizer');
    var list    = document.getElementById('side-pane-list');
    var pane    = document.getElementById('side-pane');

    if (!resizer || !list || !pane) return;

    function setListHeight(px) {
        list.style.flex   = 'none';
        list.style.height = px + 'px';
    }

    var saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    if (saved && saved >= MIN_HEIGHT) setListHeight(saved);

    var startY = 0;
    var startH = 0;

    function onMouseMove(e) {
        var maxH  = pane.offsetHeight * MAX_RATIO;
        var newH  = Math.max(MIN_HEIGHT, Math.min(maxH, startH + (e.clientY - startY)));
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
