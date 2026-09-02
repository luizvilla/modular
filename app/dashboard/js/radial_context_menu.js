(function () {
    // Generic N-level radial ("pie") context menu: rings of arc segments to
    // drill into nested categories, terminating in a ring of circular leaf
    // buttons. A node (wedge) is a branch ({ id, label, children }), a leaf
    // group ({ id, label, items }), or a direct action ({ id, label,
    // onSelect }) -- children/items may be a plain array or a function
    // returning one (sync or async, for data that needs a live read before
    // it's known, e.g. a datasource's current tree). The direct-action form
    // fires immediately on click instead of drilling, for a category that's
    // really just one option -- no point in a leaf ring with a single circle
    // in it. A leaf item is either an action ({ id, label, onSelect }) or an
    // inline editable value ({ id, label, inlineEdit: { type, getValue,
    // onSubmit } }), which swaps the circle for a small input instead of
    // navigating away. Any wedge node may also carry a `description` --
    // its native hover tooltip, falling back to the visible `label` when
    // absent.
    const OUTER_R = 92;
    const INNER_R = 34;
    const LEAF_R_BASE = 110;
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
        freeboard.addStyle('.radial-menu-leaf', 'position:absolute;width:' + LEAF_BTN_SIZE + 'px;height:' + LEAF_BTN_SIZE + 'px;margin:-' + (LEAF_BTN_SIZE / 2) + 'px;border-radius:50%;background:#2b2f36;border:1px solid #454b55;color:#e8e8e8;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;line-height:1.15;padding:4px;cursor:pointer;transition:transform 0.12s,background 0.12s;overflow:hidden;');
        freeboard.addStyle('.radial-menu-leaf:hover', 'background:#3a3f48;transform:scale(1.08);');
        freeboard.addStyle('.radial-menu-leaf i', 'font-size:20px;pointer-events:none;');
        freeboard.addStyle('.radial-menu-leaf-icon-text', 'flex-direction:column;gap:3px;');
        freeboard.addStyle('.radial-menu-leaf-icon-text i', 'font-size:16px;');
        freeboard.addStyle('.radial-menu-leaf-text', 'font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.02em;line-height:1.15;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;pointer-events:none;max-width:100%;');
        freeboard.addStyle('.radial-menu-leaf-input', 'width:100%;background:#141619;border:1px solid #6a90ff;border-radius:4px;color:#e8e8e8;font-size:11px;text-align:center;padding:2px;');
        freeboard.addStyle('.radial-menu-loading', 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#c8c8c8;font-size:11px;white-space:nowrap;');
        // Light theme overrides, matching the app's dark-default / html.theme-light convention.
        freeboard.addStyle('html.theme-light .radial-menu-overlay', 'background:rgba(0,0,0,0.08);');
        freeboard.addStyle('html.theme-light .radial-menu-wedge', 'fill:#f2f2f2;stroke:#c8c8c8;');
        freeboard.addStyle('html.theme-light .radial-menu-wedge:hover', 'fill:#e2e6ea;');
        freeboard.addStyle('html.theme-light .radial-menu-wedge-label', 'fill:#1a1a1a;');
        freeboard.addStyle('html.theme-light .radial-menu-center', 'background:#ffffff;border-color:#c8c8c8;color:#444;');
        freeboard.addStyle('html.theme-light .radial-menu-center:hover', 'background:#f2f2f2;');
        freeboard.addStyle('html.theme-light .radial-menu-leaf', 'background:#ffffff;border-color:#c8c8c8;color:#1a1a1a;');
        freeboard.addStyle('html.theme-light .radial-menu-leaf:hover', 'background:#f2f2f2;');
        freeboard.addStyle('html.theme-light .radial-menu-leaf-input', 'background:#ffffff;color:#1a1a1a;');
        freeboard.addStyle('html.theme-light .radial-menu-loading', 'color:#444;');
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

    async function resolveMaybeAsync(source) {
        const value = typeof source === 'function' ? source() : source;
        return Array.isArray(value) ? value : (value && typeof value.then === 'function' ? (await value) || [] : []);
    }

    function leafRingRadius(count) {
        const circumference = count * (LEAF_BTN_SIZE + 8);
        return Math.max(LEAF_R_BASE, circumference / (2 * Math.PI));
    }

    // root: array of top-level nodes (see file header for node shape), shown
    // as category arcs first. items: array of leaf items shown directly as
    // a circle ring with no arc/category step -- for menus with nothing to
    // categorize (e.g. a straight color picker). Pass exactly one of the two.
    function show({ x, y, root, items }) {
        injectStylesOnce();
        close();
        const startAsLeaves = !root && Array.isArray(items);
        if (!startAsLeaves && (!Array.isArray(root) || !root.length)) return;
        if (startAsLeaves && !items.length) return;

        const margin = LEAF_R_BASE + LEAF_BTN_SIZE + 40;
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
        menu.appendChild(centerBtn);

        // view stack: entries are { type: 'branch', nodes } | { type: 'leaves', items }
        const viewStack = [startAsLeaves ? { type: 'leaves', items } : { type: 'branch', nodes: root }];

        function goBack() {
            if (viewStack.length <= 1) { close(); return; }
            viewStack.pop();
            render();
        }

        function showLoading() {
            svg.style.display = 'none';
            leafLayer.innerHTML = '<div class="radial-menu-loading">Loading…</div>';
        }

        async function enterNode(node) {
            if (node.items !== undefined) {
                showLoading();
                const items = await resolveMaybeAsync(node.items);
                viewStack.push({ type: 'leaves', items });
                render();
            } else if (node.children !== undefined) {
                showLoading();
                const nodes = await resolveMaybeAsync(node.children);
                viewStack.push({ type: 'branch', nodes });
                render();
            } else if (typeof node.onSelect === 'function') {
                // A wedge with nothing to categorize -- e.g. a category
                // that's really just one action -- fires directly instead
                // of drilling into a leaf ring with a single circle in it.
                close();
                node.onSelect();
            }
        }

        function renderLeaves(items) {
            svg.style.display = 'none';
            leafLayer.innerHTML = '';
            if (!items.length) {
                leafLayer.innerHTML = '<div class="radial-menu-loading">(nothing here)</div>';
            }
            const radius = leafRingRadius(items.length);
            const step = 360 / items.length;
            items.forEach((item, i) => {
                const angle = step * i;
                const { x: lx, y: ly } = polarToCartesian(radius, angle);
                const btn = document.createElement('div');
                btn.className = 'radial-menu-leaf';
                btn.style.left = lx + 'px';
                btn.style.top = ly + 'px';
                // The Add-button modals show a plugin's own description as
                // the tile's tooltip (falling back to nothing if it has
                // none); this leaf ring only ever showed the plain name.
                // M10 (docs/GUI/02-navigation_overhaul.md): match the modal.
                btn.title = item.description || item.label;
                if (item.color) {
                    btn.style.background = item.color;
                    btn.style.borderColor = item.color;
                } else if (item.icon) {
                    // Icon above name, both visible -- an icon-only circle
                    // read as too sparse; this stacks them like the
                    // widget-picker modal's own tiles do.
                    btn.classList.add('radial-menu-leaf-icon-text');
                    const iconEl = document.createElement('i');
                    iconEl.className = `fa-solid fa-${item.icon}`;
                    btn.appendChild(iconEl);
                    const textEl = document.createElement('span');
                    textEl.className = 'radial-menu-leaf-text';
                    textEl.textContent = item.label;
                    btn.appendChild(textEl);
                } else {
                    btn.textContent = item.label;
                }
                if (item.inlineEdit) {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        startInlineEdit(btn, item);
                    });
                } else {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        close();
                        if (typeof item.onSelect === 'function') item.onSelect();
                    });
                }
                leafLayer.appendChild(btn);
            });
            const canGoBack = viewStack.length > 1;
            centerBtn.textContent = canGoBack ? '←' : '✕';
            centerBtn.title = canGoBack ? 'Back' : 'Close';
            centerBtn.onclick = (e) => { e.stopPropagation(); goBack(); };
        }

        function startInlineEdit(btn, item) {
            const { type, getValue, onSubmit } = item.inlineEdit;
            const current = (typeof getValue === 'function' ? getValue() : '');
            btn.innerHTML = '';
            const input = document.createElement('input');
            input.className = 'radial-menu-leaf-input';
            input.type = type === 'number' ? 'number' : 'text';
            if (current !== null && current !== undefined) input.value = current;
            btn.appendChild(input);
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    close();
                    if (typeof onSubmit === 'function') onSubmit(input.value);
                } else if (e.key === 'Escape') {
                    close();
                }
            });
            requestAnimationFrame(() => { input.focus(); input.select(); });
        }

        function renderBranch(nodes) {
            svg.style.display = '';
            svgGroup.innerHTML = '';
            leafLayer.innerHTML = '';
            const n = nodes.length;
            const step = 360 / n;
            nodes.forEach((node, i) => {
                const start = step * i + WEDGE_GAP_DEG / 2;
                const end = step * (i + 1) - WEDGE_GAP_DEG / 2;
                const path = svgEl('path', { d: donutSegmentPath(INNER_R, OUTER_R, start, end), class: 'radial-menu-wedge' });
                path.addEventListener('click', (e) => {
                    e.stopPropagation();
                    enterNode(node);
                });
                // Native hover tooltip, same idea as leaf items -- a wedge's
                // own description (e.g. "Add Pane") if it has one, otherwise
                // its visible label. An SVG <title> child, not an HTML title
                // attribute -- the correct way to get a native tooltip on an
                // SVG shape.
                const wedgeTitle = svgEl('title', {});
                wedgeTitle.textContent = node.description || node.label;
                path.appendChild(wedgeTitle);
                svgGroup.appendChild(path);
                const midAngle = (start + end) / 2;
                const labelPos = polarToCartesian((INNER_R + OUTER_R) / 2, midAngle);
                const text = svgEl('text', { x: labelPos.x, y: labelPos.y, class: 'radial-menu-wedge-label' });
                text.textContent = node.label;
                text.style.pointerEvents = 'none';
                svgGroup.appendChild(text);
            });
            centerBtn.textContent = viewStack.length > 1 ? '←' : '✕';
            centerBtn.title = viewStack.length > 1 ? 'Back' : 'Close';
            centerBtn.onclick = (e) => { e.stopPropagation(); if (viewStack.length > 1) goBack(); else close(); };
        }

        function render() {
            const top = viewStack[viewStack.length - 1];
            if (top.type === 'leaves') renderLeaves(top.items);
            else renderBranch(top.nodes);
        }

        render();
        document.body.appendChild(overlayEl);
        document.addEventListener('keydown', onKeyDown, true);
    }

    window.RadialContextMenu = { show, close };
})();
