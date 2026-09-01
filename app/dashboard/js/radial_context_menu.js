(function () {
    // Generic two-level radial ("pie") context menu: an outer ring of arc
    // segments for categories, and -- once a category is picked -- a ring of
    // circular buttons for that category's leaf actions. Pilot component,
    // first wired up on the time_plot_uplot widget's right-click zones.
    const OUTER_R = 92;
    const INNER_R = 34;
    const LEAF_R = 110;
    const LEAF_BTN_SIZE = 64;
    const WEDGE_GAP_DEG = 4;

    let overlayEl = null;
    let stylesInjected = false;

    function injectStylesOnce() {
        if (stylesInjected || typeof freeboard === 'undefined' || typeof freeboard.addStyle !== 'function') return;
        stylesInjected = true;
        freeboard.addStyle('.radial-menu-overlay', 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.15);');
        freeboard.addStyle('.radial-menu', 'position:absolute;width:0;height:0;');
        freeboard.addStyle('.radial-menu-wedge', 'cursor:pointer;fill:#2b2f36;stroke:#454b55;stroke-width:1;transition:fill 0.12s;');
        freeboard.addStyle('.radial-menu-wedge:hover', 'fill:#3a3f48;');
        freeboard.addStyle('.radial-menu-wedge-label', 'fill:#e8e8e8;font-size:12px;font-weight:600;pointer-events:none;text-anchor:middle;dominant-baseline:middle;');
        freeboard.addStyle('.radial-menu-center', 'position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px;border-radius:50%;background:#20232a;border:1px solid #454b55;color:#c8c8c8;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;line-height:1;user-select:none;');
        freeboard.addStyle('.radial-menu-center:hover', 'background:#2b2f36;');
        freeboard.addStyle('.radial-menu-leaf', 'position:absolute;width:' + LEAF_BTN_SIZE + 'px;height:' + LEAF_BTN_SIZE + 'px;margin:-' + (LEAF_BTN_SIZE / 2) + 'px;border-radius:50%;background:#2b2f36;border:1px solid #454b55;color:#e8e8e8;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;line-height:1.15;padding:4px;cursor:pointer;transition:transform 0.12s,background 0.12s;');
        freeboard.addStyle('.radial-menu-leaf:hover', 'background:#3a3f48;transform:scale(1.08);');
        // Light theme overrides, matching the app's dark-default / html.theme-light convention.
        freeboard.addStyle('html.theme-light .radial-menu-overlay', 'background:rgba(0,0,0,0.08);');
        freeboard.addStyle('html.theme-light .radial-menu-wedge', 'fill:#f2f2f2;stroke:#c8c8c8;');
        freeboard.addStyle('html.theme-light .radial-menu-wedge:hover', 'fill:#e2e6ea;');
        freeboard.addStyle('html.theme-light .radial-menu-wedge-label', 'fill:#1a1a1a;');
        freeboard.addStyle('html.theme-light .radial-menu-center', 'background:#ffffff;border-color:#c8c8c8;color:#444;');
        freeboard.addStyle('html.theme-light .radial-menu-center:hover', 'background:#f2f2f2;');
        freeboard.addStyle('html.theme-light .radial-menu-leaf', 'background:#ffffff;border-color:#c8c8c8;color:#1a1a1a;');
        freeboard.addStyle('html.theme-light .radial-menu-leaf:hover', 'background:#f2f2f2;');
    }

    function polarToCartesian(radius, angleDeg) {
        const rad = (angleDeg - 90) * Math.PI / 180;
        return { x: radius * Math.cos(rad), y: radius * Math.sin(rad) };
    }

    function donutSegmentPath(innerR, outerR, startAngle, endAngle) {
        const p1 = polarToCartesian(outerR, endAngle);
        const p2 = polarToCartesian(outerR, startAngle);
        const p3 = polarToCartesian(innerR, startAngle);
        const p4 = polarToCartesian(innerR, endAngle);
        const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
        return [
            'M', p1.x, p1.y,
            'A', outerR, outerR, 0, largeArc, 0, p2.x, p2.y,
            'L', p3.x, p3.y,
            'A', innerR, innerR, 0, largeArc, 1, p4.x, p4.y,
            'Z'
        ].join(' ');
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs) {
        const el = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
        return el;
    }

    function close() {
        if (overlayEl) {
            overlayEl.remove();
            overlayEl = null;
            document.removeEventListener('keydown', onKeyDown, true);
        }
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') close();
    }

    function clampToViewport(x, y, margin) {
        const maxX = window.innerWidth - margin;
        const maxY = window.innerHeight - margin;
        return {
            x: Math.min(Math.max(x, margin), maxX),
            y: Math.min(Math.max(y, margin), maxY)
        };
    }

    // categories: [{ id, label, items: [{ id, label, onSelect }] }]
    function show({ x, y, categories }) {
        injectStylesOnce();
        close();
        if (!Array.isArray(categories) || !categories.length) return;

        const margin = OUTER_R + LEAF_R - OUTER_R + 40; // enough room for the leaf ring too
        const pos = clampToViewport(x, y, margin);

        overlayEl = document.createElement('div');
        overlayEl.className = 'radial-menu-overlay';
        overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
        overlayEl.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });

        const menu = document.createElement('div');
        menu.className = 'radial-menu';
        menu.style.left = pos.x + 'px';
        menu.style.top = pos.y + 'px';
        overlayEl.appendChild(menu);

        const svg = svgEl('svg', {
            width: (OUTER_R * 2), height: (OUTER_R * 2),
            style: `position:absolute;left:${-OUTER_R}px;top:${-OUTER_R}px;overflow:visible;`
        });
        const svgGroup = svgEl('g', { transform: `translate(${OUTER_R},${OUTER_R})` });
        svg.appendChild(svgGroup);
        menu.appendChild(svg);

        const leafLayer = document.createElement('div');
        leafLayer.style.position = 'absolute';
        leafLayer.style.left = '0';
        leafLayer.style.top = '0';
        menu.appendChild(leafLayer);

        const centerBtn = document.createElement('div');
        centerBtn.className = 'radial-menu-center';
        centerBtn.textContent = '✕';
        centerBtn.title = 'Close';
        menu.appendChild(centerBtn);

        function renderLeaves(category) {
            svg.style.display = 'none';
            leafLayer.innerHTML = '';
            const items = category.items || [];
            const step = 360 / items.length;
            items.forEach((item, i) => {
                const angle = step * i;
                const { x: lx, y: ly } = polarToCartesian(LEAF_R, angle);
                const btn = document.createElement('div');
                btn.className = 'radial-menu-leaf';
                btn.style.left = lx + 'px';
                btn.style.top = ly + 'px';
                btn.textContent = item.label;
                btn.title = item.label;
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    close();
                    if (typeof item.onSelect === 'function') item.onSelect();
                });
                leafLayer.appendChild(btn);
            });
            centerBtn.textContent = '←';
            centerBtn.title = 'Back';
            centerBtn.onclick = (e) => { e.stopPropagation(); renderCategories(); };
        }

        function renderCategories() {
            svg.style.display = '';
            svgGroup.innerHTML = '';
            leafLayer.innerHTML = '';
            const n = categories.length;
            const step = 360 / n;
            categories.forEach((cat, i) => {
                const start = step * i + WEDGE_GAP_DEG / 2;
                const end = step * (i + 1) - WEDGE_GAP_DEG / 2;
                const path = svgEl('path', { d: donutSegmentPath(INNER_R, OUTER_R, start, end), class: 'radial-menu-wedge' });
                path.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (cat.items && cat.items.length) renderLeaves(cat);
                });
                svgGroup.appendChild(path);
                const midAngle = (start + end) / 2;
                const labelPos = polarToCartesian((INNER_R + OUTER_R) / 2, midAngle);
                const text = svgEl('text', { x: labelPos.x, y: labelPos.y, class: 'radial-menu-wedge-label' });
                text.textContent = cat.label;
                text.style.pointerEvents = 'none';
                svgGroup.appendChild(text);
            });
            centerBtn.textContent = '✕';
            centerBtn.title = 'Close';
            centerBtn.onclick = (e) => { e.stopPropagation(); close(); };
        }

        renderCategories();
        document.body.appendChild(overlayEl);
        document.addEventListener('keydown', onKeyDown, true);
    }

    window.RadialContextMenu = { show, close };
})();
