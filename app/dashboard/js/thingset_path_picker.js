// Nested ThingSet path picker for widget editors.
//
// Replaces a flat <select> of every path (the Variable dropdown) or a
// free-text "ThingSet Write Path" input with a field that opens the board's
// tree: groups expand/collapse, search narrows it, each variable shows its
// unit, live value and access, and a write picker only offers writable
// variables. The original <select>/<input> stays in the DOM (hidden) and is
// kept in sync, so the editors' save code doesn't change.
//
//   ThingSetPathPicker.attach($selectOrInput, {
//     mode: 'read' | 'write',
//     getDatasource: () => datasourceName,
//   }) -> { refresh(), destroy() }
(function () {
  const Model = () => window.OwntechVariableTableModel || null;
  const PANEL_Z = 2000; // above #modal_overlay (100)

  let stylesAdded = false;
  function addStyles() {
    if (stylesAdded || !window.freeboard || typeof freeboard.addStyle !== 'function') return;
    stylesAdded = true;
    const s = (sel, css) => freeboard.addStyle(sel, css);
    s('.tsp-field', 'display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;cursor:pointer;padding:4px 10px;background:var(--bs-body-bg);color:var(--bs-body-color);border:1px solid var(--bs-border-color);border-radius:0 6px 6px 0;font-size:14px;line-height:1.5;user-select:none;');
    s('.tsp-field:hover', 'border-color:var(--bs-primary);');
    s('.tsp-field.tsp-open', 'border-color:var(--bs-primary);box-shadow:0 0 0 2px rgba(var(--bs-primary-rgb),.25);');
    s('.tsp-field-text', 'flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
    s('.tsp-crumb', 'color:var(--bs-secondary-color);');
    s('.tsp-field-placeholder', 'color:var(--bs-secondary-color);font-style:italic;');
    s('.tsp-field i.tsp-caret', 'color:var(--bs-secondary-color);font-size:11px;');
    s('.tsp-panel', `position:fixed;z-index:${PANEL_Z};display:flex;flex-direction:column;background:var(--bs-body-bg);color:var(--bs-body-color);border:1px solid var(--bs-border-color);border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:13px;overflow:hidden;`);
    s('.tsp-search', 'margin:6px;padding:4px 8px;font-size:13px;background:var(--bs-tertiary-bg);color:var(--bs-body-color);border:1px solid var(--bs-border-color);border-radius:4px;outline:none;');
    s('.tsp-search:focus', 'border-color:var(--bs-primary);');
    s('.tsp-list', 'flex:1 1 auto;overflow:auto;padding:2px 0 6px;');
    s('.tsp-row', 'display:flex;align-items:center;gap:8px;padding:3px 10px;white-space:nowrap;cursor:pointer;');
    s('.tsp-row:hover', 'background:var(--bs-secondary-bg);');
    s('.tsp-group .tsp-name', 'font-weight:600;color:var(--bs-emphasis-color);');
    s('.tsp-group .tsp-count', 'color:var(--bs-secondary-color);font-size:11px;');
    s('.tsp-chevron', 'width:12px;color:var(--bs-secondary-color);font-size:10px;transition:transform .12s;');
    s('.tsp-group.tsp-collapsed .tsp-chevron', 'transform:rotate(-90deg);');
    s('.tsp-var .tsp-name', 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;');
    s('.tsp-var .tsp-value', 'color:var(--bs-secondary-color);font-family:var(--bs-font-monospace);font-size:12px;max-width:110px;overflow:hidden;text-overflow:ellipsis;');
    s('.tsp-var .tsp-unit', 'color:var(--bs-secondary-color);font-size:11px;min-width:22px;');
    s('.tsp-var .tsp-access', 'font-size:10px;padding:0 5px;border-radius:3px;border:1px solid var(--bs-border-color);color:var(--bs-secondary-color);');
    s('.tsp-var .tsp-access-w', 'color:var(--bs-primary-text-emphasis);border-color:rgba(var(--bs-primary-rgb),.45);');
    s('.tsp-var.tsp-active', 'background:rgba(var(--bs-primary-rgb),.25);');
    s('.tsp-var.tsp-selected .tsp-name', 'color:var(--bs-primary-text-emphasis);font-weight:600;');
    s('.tsp-path-hint', 'color:var(--bs-secondary-color);font-size:11px;');
    s('.tsp-empty', 'padding:10px 12px;color:var(--bs-secondary-color);');
    s('.tsp-typed', 'padding:6px 10px;border-top:1px solid var(--bs-border-color);color:var(--bs-secondary-color);font-size:12px;cursor:pointer;');
    s('.tsp-typed:hover', 'background:var(--bs-secondary-bg);');
  }

  function datasourceData(name) {
    const live = window.freeboard && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
    const model = live && live.datasources().find((d) => { try { return d.name() === name; } catch (e) { return false; } });
    return model && model.latestData ? (model.latestData() || null) : null;
  }

  // Rows from the datasource's walked tree, values from its values map.
  function rowsFor(dsName) {
    const M = Model();
    const data = datasourceData(dsName);
    if (!M || !data || !data.tree) return null;
    const rows = M.buildRows(data.tree);
    const values = data.values || {};
    rows.forEach((r) => { if (r.kind === 'variable' && Object.prototype.hasOwnProperty.call(values, r.path)) r.value = values[r.path]; });
    return rows;
  }

  function crumbsFor(path) {
    const M = Model();
    const parts = String(path || '').split('/').filter(Boolean);
    if (!parts.length) return { groups: [], leaf: '' };
    const leaf = parts.pop();
    return { groups: parts, leaf: M ? M.displayName(leaf) : leaf, unit: M ? M.parseUnit(leaf).unit : '' };
  }

  function attach(element, opts) {
    const $el = $(element);
    if (!$el.length) return null;
    const existing = $el.data('tspPicker');
    if (existing) { existing.setOptions(opts); existing.refresh(); return existing; }
    addStyles();
    const options = Object.assign({ mode: 'read', getDatasource: () => '' }, opts || {});
    const isSelect = $el.is('select');
    const field = $('<div class="tsp-field" tabindex="0" role="combobox" aria-haspopup="tree" aria-expanded="false"></div>');
    const fieldText = $('<span class="tsp-field-text"></span>');
    field.append(fieldText, '<i class="fa-solid fa-chevron-down tsp-caret"></i>');
    $el.hide().after(field);

    let panel = null;
    let expanded = new Map(); // group path -> bool, per open
    let active = -1; // index into the visible variable rows
    let query = '';

    function value() { return String($el.val() || ''); }

    function setValue(path) {
      if (isSelect && !$el.find('option').filter(function () { return this.value === path; }).length) {
        $el.append($('<option></option>').attr('value', path).text(path));
      }
      $el.val(path).trigger('input').trigger('change');
      renderField();
    }

    function renderField() {
      const v = value();
      fieldText.empty();
      if (!v) {
        fieldText.append($('<span class="tsp-field-placeholder"></span>').text(options.mode === 'write' ? 'Select a writable variable…' : 'Select a variable…'));
        return;
      }
      const c = crumbsFor(v);
      if (c.groups.length) fieldText.append($('<span class="tsp-crumb"></span>').text(c.groups.join(' › ') + ' › '));
      fieldText.append(document.createTextNode(c.leaf + (c.unit ? ` (${c.unit})` : '')));
      field.attr('title', v);
    }

    function eligible(row) {
      return row.kind !== 'variable' || options.mode !== 'write' || row.access.editable;
    }

    function open() {
      if (panel) return;
      const rows = rowsFor(options.getDatasource());
      panel = $('<div class="tsp-panel" role="tree"></div>');
      const search = $('<input type="text" class="tsp-search" placeholder="Search name or path…" spellcheck="false" autocomplete="off">');
      const list = $('<div class="tsp-list"></div>');
      const typed = $('<div class="tsp-typed"></div>').hide();
      panel.append(search, list, typed);
      $(document.body).append(panel);
      field.addClass('tsp-open').attr('aria-expanded', 'true');
      // Open the current value's groups, plus the top level.
      expanded = new Map();
      const cur = value();
      if (cur) {
        const parts = cur.split('/').filter(Boolean);
        for (let i = 1; i < parts.length; i += 1) expanded.set('/' + parts.slice(0, i).join('/'), true);
      }
      query = '';
      position();
      draw(rows, list, typed);
      search.on('input', () => { query = search.val(); active = -1; draw(rows, list, typed); });
      search.on('keydown', (e) => onKey(e, rows, list, typed));
      // Clicks inside the panel never reach the document's outside-click
      // close: redrawing removes the clicked row from the DOM, which would
      // otherwise make it look like a click outside.
      panel.on('mousedown', (e) => e.stopPropagation());
      list.on('mousedown', '.tsp-row', (e) => {
        e.preventDefault();
        const row = $(e.currentTarget);
        if (row.hasClass('tsp-group')) {
          const path = row.attr('data-path');
          expanded.set(path, !isOpen(path, Number(row.attr('data-depth'))));
          draw(rows, list, typed);
        } else {
          setValue(row.attr('data-path'));
          close();
        }
      });
      typed.on('mousedown', (e) => { e.preventDefault(); setValue(typed.data('path')); close(); });
      setTimeout(() => {
        $(document).on('mousedown.tsp', (e) => {
          if (!panel || !document.contains(e.target)) return;
          if (!$(e.target).closest(panel).length && !$(e.target).closest(field).length) close();
        });
        $(window).on('resize.tsp', position);
      }, 0);
      search.trigger('focus');
      const sel = list.find('.tsp-selected');
      if (sel.length) sel[0].scrollIntoView({ block: 'center' });
    }

    function close() {
      if (!panel) return;
      panel.remove();
      panel = null;
      field.removeClass('tsp-open').attr('aria-expanded', 'false');
      $(document).off('mousedown.tsp');
      $(window).off('resize.tsp');
    }

    function position() {
      if (!panel) return;
      const r = field[0].getBoundingClientRect();
      const width = Math.max(r.width, 380);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const height = Math.min(380, Math.max(below, above));
      const left = Math.min(r.left, window.innerWidth - width - 8);
      const css = { left: Math.max(8, left), width, maxHeight: height };
      if (below >= Math.min(260, above)) Object.assign(css, { top: r.bottom + 4, bottom: '' });
      else Object.assign(css, { bottom: window.innerHeight - r.top + 4, top: '' });
      panel.css(css);
    }

    function isOpen(path, depth) {
      return expanded.has(path) ? expanded.get(path) : depth === 0;
    }

    function visible(rows) {
      const M = Model();
      let list = rows.filter(eligible);
      // Drop groups with nothing eligible under them (write mode).
      const keep = new Set(list.filter((r) => r.kind === 'variable').map((r) => r.parentPath));
      keep.forEach((p) => { let q = p; while (q && q !== '/') { keep.add(q); q = q.slice(0, q.lastIndexOf('/')) || '/'; } });
      list = list.filter((r) => r.kind === 'variable' || keep.has(r.path));
      if (String(query).trim() && M) list = M.visibleRows(list, { query });
      return list;
    }

    function draw(rows, list, typed) {
      list.empty();
      typed.hide();
      if (!rows) {
        list.append('<div class="tsp-empty">No tree yet — connect the datasource, or type a path above.</div>');
        offerTyped(typed);
        return;
      }
      const searching = !!String(query).trim();
      const shown = visible(rows);
      const collapsed = [];
      const cur = value();
      const frag = document.createDocumentFragment();
      let varIndex = 0;
      for (const row of shown) {
        while (collapsed.length && !row.path.startsWith(collapsed[collapsed.length - 1] + '/')) collapsed.pop();
        if (collapsed.length && !searching) continue;
        const pad = `${10 + row.depth * 14}px`;
        if (row.kind === 'group') {
          const openNow = searching || isOpen(row.path, row.depth);
          const count = shown.filter((r) => r.kind === 'variable' && r.path.startsWith(row.path + '/')).length;
          const el = $('<div class="tsp-row tsp-group" role="treeitem"></div>').attr({ 'data-path': row.path, 'data-depth': row.depth, 'aria-expanded': openNow }).css('padding-left', pad).toggleClass('tsp-collapsed', !openNow);
          el.append('<i class="fa-solid fa-chevron-down tsp-chevron"></i>', $('<span class="tsp-name"></span>').text(row.label), $('<span class="tsp-count"></span>').text(count));
          frag.appendChild(el[0]);
          if (!openNow) collapsed.push(row.path);
        } else {
          const M = Model();
          const el = $('<div class="tsp-row tsp-var" role="treeitem"></div>').attr({ 'data-path': row.path, 'data-index': varIndex, title: row.path }).css('padding-left', `calc(${pad} + 20px)`);
          el.toggleClass('tsp-selected', row.path === cur).toggleClass('tsp-active', varIndex === active);
          el.append($('<span class="tsp-name"></span>').text(row.label));
          if (searching) el.find('.tsp-name').append($('<span class="tsp-path-hint"></span>').text('  ' + row.parentPath));
          el.append($('<span class="tsp-value"></span>').text(M ? M.formatValue(row.value).text : ''));
          el.append($('<span class="tsp-unit"></span>').text(row.unit || ''));
          el.append($(`<span class="tsp-access ${row.access.editable ? 'tsp-access-w' : ''}"></span>`).text(row.access.editable ? 'W' : 'R').attr('title', row.access.label));
          frag.appendChild(el[0]);
          varIndex += 1;
        }
      }
      list[0].appendChild(frag);
      if (!varIndex) list.append(`<div class="tsp-empty">${searching ? 'No variable matches.' : 'No variables.'}</div>`);
      offerTyped(typed);
    }

    // A typed full path stays possible (a node not walked yet, or no tree).
    function offerTyped(typed) {
      const q = String(query).trim();
      if (!q.startsWith('/') || q.length < 2) return;
      typed.data('path', q).text(`Use “${q}” as typed`).show();
    }

    function onKey(e, rows, list, typed) {
      const items = list.find('.tsp-var');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); field.trigger('focus'); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        active = e.key === 'ArrowDown' ? Math.min(items.length - 1, active + 1) : Math.max(0, active - 1);
        items.removeClass('tsp-active').eq(active).addClass('tsp-active')[0].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        // Stop it here: DialogBox binds Enter on the document to Save.
        e.preventDefault(); e.stopPropagation();
        const pick = active >= 0 ? items.eq(active) : (items.length === 1 ? items.eq(0) : null);
        if (pick && pick.length) { setValue(pick.attr('data-path')); close(); field.trigger('focus'); return; }
        if (typed.is(':visible')) { setValue(typed.data('path')); close(); field.trigger('focus'); }
      }
    }

    field.on('click', () => (panel ? close() : open()));
    field.on('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); open(); }
    });
    $el.on('change.tspField', renderField);
    renderField();

    const api = {
      refresh: renderField,
      setOptions(next) { Object.assign(options, next || {}); },
      destroy() {
        close();
        field.remove();
        $el.off('change.tspField').removeData('tspPicker').show();
      },
    };
    $el.data('tspPicker', api);
    return api;
  }

  function detach(element) {
    const api = $(element).data('tspPicker');
    if (api) api.destroy();
  }

  window.ThingSetPathPicker = { attach, detach };
}());
