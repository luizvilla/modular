(function () {
  const NEG_COLOR = 'rgba(220, 76, 70, 0.75)';   // consumption (positive): red-ish
  const POS_COLOR = 'rgba(40, 167, 69, 0.75)';   // production (negative): green-ish
  const BORDER_NEG = 'rgba(220, 76, 70, 1)';
  const BORDER_POS = 'rgba(40, 167, 69, 1)';

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function toArray(val) {
    if (val == null) return [];
    return Array.isArray(val) ? val : [val];
  }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  }

  function normalizeMatrix(input) {
    // Accept multiple shapes and normalize to { nodes: [{ name, legs: [{ name, V, I }] }] }
    if (!input) return null;

    // Case: already in structured form
    if (input && Array.isArray(input.nodes)) {
      return { nodes: input.nodes.map(n => ({
        name: n?.name ?? '',
        legs: Array.isArray(n?.legs) ? n.legs.map(l => ({
          name: l?.name ?? '',
          V: Number.isFinite(l?.voltage) ? l.voltage : (Number.isFinite(l?.V) ? l.V : null),
          I: Number.isFinite(l?.current) ? l.current : (Number.isFinite(l?.I) ? l.I : null)
        })) : []
      })) };
    }

    // Case: power matrix with labels
    if (Array.isArray(input.power)) {
      const nodes = [];
      const nodeLabels = toArray(input.nodeLabels);
      const legLabels = toArray(input.legLabels);
      for (let ni = 0; ni < input.power.length; ni++) {
        const row = toArray(input.power[ni]);
        nodes.push({
          name: nodeLabels[ni] ?? `Node ${ni + 1}`,
          legs: row.map((p, li) => ({ name: legLabels[li] ?? `L${li + 1}`, V: null, I: null, P: Number(p) }))
        });
      }
      return { nodes };
    }

    return null;
  }

  function buildFromVI(voltages, currents, nodeLabels, legLabels) {
    const nodes = [];
    const V = Array.isArray(voltages) ? voltages : [];
    const I = Array.isArray(currents) ? currents : [];
    const rows = Math.max(V.length, I.length);
    for (let ni = 0; ni < rows; ni++) {
      const vrow = toArray(V[ni]);
      const irow = toArray(I[ni]);
      const cols = Math.max(vrow.length, irow.length);
      const legs = [];
      for (let li = 0; li < cols; li++) {
        const v = Number(vrow[li]);
        const c = Number(irow[li]);
        legs.push({
          name: (Array.isArray(legLabels) && legLabels[li]) ? String(legLabels[li]) : `L${li + 1}`,
          V: Number.isFinite(v) ? v : null,
          I: Number.isFinite(c) ? c : null
        });
      }
      nodes.push({
        name: (Array.isArray(nodeLabels) && nodeLabels[ni]) ? String(nodeLabels[ni]) : `Node ${ni + 1}`,
        legs
      });
    }
    return { nodes };
  }

  function computePowerMatrix(model, invertSign = false) {
    // Returns { nodeNames: [], legNames: [], power: number[][], meta: { V, I } }
    const nodeNames = [];
    const legNames = [];
    const power = [];
    const metaV = [];
    const metaI = [];
    const nodes = model?.nodes || [];

    // Discover max legs and leg names from first node with legs
    let maxLegs = 0;
    for (const n of nodes) { maxLegs = Math.max(maxLegs, Array.isArray(n.legs) ? n.legs.length : 0); }
    for (let li = 0; li < maxLegs; li++) {
      const name = nodes.find(n => n.legs?.[li]?.name)?.legs?.[li]?.name;
      legNames.push(name || `L${li + 1}`);
    }

    nodes.forEach((node, ni) => {
      nodeNames.push(node?.name || `Node ${ni + 1}`);
      const prow = [];
      const vrow = [];
      const irow = [];
      for (let li = 0; li < maxLegs; li++) {
        const leg = node?.legs?.[li] || {};
        const V = Number(leg.V);
        const I = Number(leg.I);
        const hasP = Number.isFinite(leg.P);
        const pVal = hasP ? Number(leg.P) : (Number.isFinite(V) && Number.isFinite(I) ? V * I : null);
        const P = Number.isFinite(pVal) ? (invertSign ? -pVal : pVal) : null;
        prow.push(Number.isFinite(P) ? P : 0);
        vrow.push(Number.isFinite(V) ? V : null);
        irow.push(Number.isFinite(I) ? I : null);
      }
      power.push(prow);
      metaV.push(vrow);
      metaI.push(irow);
    });

    return { nodeNames, legNames, power, meta: { V: metaV, I: metaI } };
  }

  class PowerBarsWidget {
    constructor(settings) {
      this.settings = settings;
      this.$root = $('<div class="w-100 h-100 d-flex flex-column"></div>');
      this.$canvasWrap = $('<div class="flex-fill position-relative"></div>');
      this.$canvas = $('<canvas></canvas>');
      this.$canvasWrap.append(this.$canvas);
      this.$root.append(this.$canvasWrap);
      this.chart = null;
      this.model = null; // normalized nodes/legs
      this.invertSign = !!settings.invertSign;
      this.stacked = settings.stacked !== false; // default true
      this._resizeObs = null;
      this._updateRAF = 0;
      this._lastUpdate = 0;
    }

    render(container) {
      $(container).append(this.$root);
      this._ensureChart();
      this._bindResize();
    }

    onSettingsChanged(newSettings) {
      const mustRebuild = (newSettings.stacked !== this.settings.stacked);
      const titleChanged = (newSettings.title !== this.settings.title);
      this.settings = newSettings;
      this.invertSign = !!newSettings.invertSign;
      this.stacked = newSettings.stacked !== false;
      if (mustRebuild) {
        this._destroyChart();
        this._ensureChart();
        this._scheduleUpdate(0);
      } else if (titleChanged && this.chart) {
        this.chart.options.plugins.title.text = newSettings.title || '';
        this.chart.update('none');
      }
    }

    onCalculatedValueChanged(settingName, newValue) {
      // Accept: matrix (structured), or voltages/currents + labels
      if (settingName === 'matrix') {
        const m = normalizeMatrix(newValue);
        if (m) this.model = m; // replace
      } else if (settingName === 'voltages') {
        this._lastVoltages = deepClone(newValue);
      } else if (settingName === 'currents') {
        this._lastCurrents = deepClone(newValue);
      } else if (settingName === 'nodeLabels') {
        this._lastNodeLabels = Array.isArray(newValue) ? newValue : null;
      } else if (settingName === 'legLabels') {
        this._lastLegLabels = Array.isArray(newValue) ? newValue : null;
      }

      if (!this.model) {
        if (this._lastVoltages || this._lastCurrents) {
          this.model = buildFromVI(this._lastVoltages, this._lastCurrents, this._lastNodeLabels, this._lastLegLabels);
        }
      }
      this._scheduleUpdate();
    }

    onDispose() {
      this._destroyChart();
      if (this._resizeObs) {
        try { this._resizeObs.disconnect(); } catch {}
        this._resizeObs = null;
      }
      if (this._updateRAF) {
        cancelAnimationFrame(this._updateRAF);
        this._updateRAF = 0;
      }
    }

    getHeight() {
      const blocks = parseInt(this.settings.height, 10);
      return Number.isFinite(blocks) && blocks > 0 ? blocks : 5;
    }

    _bindResize() {
      if (typeof ResizeObserver !== 'undefined') {
        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(this.$root[0]);
      } else {
        $(window).on('resize.powerbars', () => this._resize());
      }
    }

    _resize() {
      if (this.chart) {
        try { this.chart.resize(); } catch {}
      }
    }

    _ensureChart() {
      if (this.chart) return;
      const ctx = this.$canvas[0].getContext('2d');
      const stacked = this.stacked;
      const title = this.settings.title || '';
      const self = this;

      this.chart = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'bottom' },
            title: { display: !!title, text: title },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const dsIndex = context.datasetIndex;
                  const nodeIndex = context.dataIndex;
                  const p = context.parsed.y;
                  const meta = self._lastMeta || {};
                  const v = meta.V?.[nodeIndex]?.[dsIndex];
                  const i = meta.I?.[nodeIndex]?.[dsIndex];
                  const leg = context.dataset?.label || `Leg ${dsIndex + 1}`;
                  const parts = [`${leg}: ${Number(p).toFixed(2)} W`];
                  if (Number.isFinite(v)) parts.push(`V=${v.toFixed(2)} V`);
                  if (Number.isFinite(i)) parts.push(`I=${i.toFixed(2)} A`);
                  return parts.join(' | ');
                }
              }
            }
          },
          scales: {
            x: { stacked: stacked, ticks: { autoSkip: false } },
            y: {
              stacked: stacked,
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.08)' },
              ticks: { callback: (v) => `${v} W` }
            }
          },
          elements: {
            bar: {
              borderWidth: 1,
              borderRadius: 4
            }
          },
          animation: false
        }
      });
    }

    _destroyChart() {
      if (this.chart) { try { this.chart.destroy(); } catch {} this.chart = null; }
    }

    _scheduleUpdate(minDelay = 100) {
      const now = Date.now();
      if (now - this._lastUpdate < minDelay) {
        if (!this._updateRAF) this._updateRAF = requestAnimationFrame(() => this._applyData());
      } else {
        this._applyData();
      }
    }

    _applyData() {
      this._updateRAF = 0;
      this._lastUpdate = Date.now();
      if (!this.chart) this._ensureChart();

      // Build a model if we only have V/I inputs
      if (!this.model && (this._lastVoltages || this._lastCurrents)) {
        this.model = buildFromVI(this._lastVoltages, this._lastCurrents, this._lastNodeLabels, this._lastLegLabels);
      }
      if (!this.model) return;

      const { nodeNames, legNames, power, meta } = computePowerMatrix(this.model, this.invertSign);
      this._lastMeta = meta;

      // Prepare datasets: one per leg (column across nodes)
      const datasets = [];
      const numLegs = legNames.length;
      for (let li = 0; li < numLegs; li++) {
        const data = power.map(row => Number(row?.[li]) || 0);
        datasets.push({
          label: legNames[li] || `Leg ${li + 1}`,
          data,
          backgroundColor: (ctx) => {
            const v = ctx?.raw;
            return Number(v) < 0 ? NEG_COLOR : POS_COLOR;
          },
          borderColor: (ctx) => {
            const v = ctx?.raw;
            return Number(v) < 0 ? BORDER_NEG : BORDER_POS;
          },
          borderWidth: 1
        });
      }

      this.chart.data.labels = nodeNames;
      this.chart.data.datasets = datasets;
      try { this.chart.update('none'); } catch {}
    }
  }

  freeboard.loadWidgetPlugin({
    type_name: 'owntech_power_bars',
    display_name: 'Power Bars (nodes × legs)',
    description: 'Stacked bar graph showing P = V × I per leg for each node; negative=production (green), positive=consumption (red).',
    external_scripts: [
      'plugins/thirdparty/chart.umd.js'
    ],
    fill_size: true,
    settings: [
      { name: 'title', display_name: 'Title', type: 'text' },
      { name: 'matrix', display_name: 'Structured data (object)', type: 'calculated', description: 'Optional: { nodes: [{ name, legs: [{ name, voltage|V, current|I }] }] } or { power: number[][], nodeLabels, legLabels }' },
      { name: 'voltages', display_name: 'Voltages (nodes×legs)', type: 'calculated' },
      { name: 'currents', display_name: 'Currents (nodes×legs)', type: 'calculated' },
      { name: 'nodeLabels', display_name: 'Node Labels (array)', type: 'calculated' },
      { name: 'legLabels', display_name: 'Leg Labels (array)', type: 'calculated' },
      { name: 'stacked', display_name: 'Stack Bars', type: 'boolean', default_value: true },
      { name: 'invertSign', display_name: 'Invert Sign (swap prod/cons)', type: 'boolean', default_value: false },
      { name: 'height', display_name: 'Height Blocks', type: 'number', default_value: 5 }
    ],
    newInstance: function (settings, newInstanceCallback) {
      newInstanceCallback(new PowerBarsWidget(settings));
    }
  });
})();

