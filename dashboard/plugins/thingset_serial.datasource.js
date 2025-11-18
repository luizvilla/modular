(function () {
  const ipc = window.require?.('electron')?.ipcRenderer;

  async function fetchSerialPortOptions() {
    if (!ipc) return [];
    try {
      const ports = await ipc.invoke('get-serial-ports');
      if (Array.isArray(ports) && ports.length) {
        return ports.map((p) => ({ name: p.name || p.value || p.path || String(p), value: p.value || p.name || p.path || String(p) }));
      }
    } catch (err) {
      console.warn('ThingSet Serial: failed to list serial ports', err);
    }
    return [];
  }

  function manualPort(settings) {
    if (!settings) return null;
    const txt = String(settings.portPath || '').trim();
    return txt.length ? txt : null;
  }

  function baseData() {
    const now = new Date();
    return {
      numeric_value: now.getTime(),
      full_string_value: now.toLocaleString(),
    };
  }

  function joinPath(parent, leaf) {
    if (!leaf) return parent || '/';
    if (!parent || parent === '/' || !parent.length) return `/${leaf}`;
    return `${parent}/${leaf}`;
  }

  function lastSegment(path) {
    if (!path) return '';
    const clean = String(path).replace(/^\/+|\/+$/g, '');
    if (!clean) return '';
    const parts = clean.split('/');
    return parts[parts.length - 1];
  }

  function flattenTree(root) {
    const values = {};
    const numericValues = [];
    const numericLabels = [];

    function record(path, value) {
      if (value === undefined) return;
      values[path] = value;
      if (typeof value === 'number' && Number.isFinite(value)) {
        numericValues.push(value);
        numericLabels.push(lastSegment(path) || path || `y${numericValues.length}`);
      }
    }

    function walk(node, path) {
      if (!node || typeof node !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(node, 'value')) {
        record(path, node.value);
      }
      if (node.values && typeof node.values === 'object') {
        for (const [key, val] of Object.entries(node.values)) {
          const childPath = joinPath(path, key);
          record(childPath, val);
        }
      }
      if (node.children && typeof node.children === 'object') {
        for (const [name, child] of Object.entries(node.children)) {
          const childPath = joinPath(path, name);
          walk(child, childPath);
        }
      }
    }

    walk(root, '/');
    return { values, numericValues, numericLabels };
  }

  function resolveDeviceLabel(meta, port) {
    if (!meta) return port || 'unknown';
    return meta.address_hex || meta.node_uid || meta.node_name || port || 'unknown';
  }

  function ThingSetSerialDatasource(settings, updateCallback) {
    const self = this;
    let currentSettings = settings || {};
    let timer = null;
    let detectPromise = null;
    let detectedPort = manualPort(currentSettings);
    let lastMeta = null;
    let lastError = null;
    let pollInFlight = null;

    function isAutoMode() {
      return currentSettings.autoDetect !== false;
    }

    function effectiveBaudRate() {
      const num = Number(currentSettings.baudRate);
      return Number.isFinite(num) && num > 0 ? num : 115200;
    }

    async function detectPort(force = false) {
      if (!ipc) return null;
      if (!isAutoMode()) {
        detectedPort = manualPort(currentSettings);
        return detectedPort;
      }
      if (detectedPort && !force) return detectedPort;
      if (detectPromise) return detectPromise;

      const opts = {
        port: manualPort(currentSettings) || null,
        baudRate: effectiveBaudRate(),
        usePrefix: !!currentSettings.usePrefix,
        verbose: !!currentSettings.debug,
      };

      detectPromise = (async () => {
        try {
          const res = await ipc.invoke('ts-serial-detect', opts);
          if (res?.port) {
            detectedPort = res.port;
            lastMeta = res;
            if (isAutoMode()) currentSettings.portPath = res.port;
          }
          lastError = null;
          return detectedPort;
        } catch (err) {
          lastError = err;
          detectedPort = null;
          if (isAutoMode()) currentSettings.portPath = '';
          return null;
        } finally {
          detectPromise = null;
        }
      })();

      return detectPromise;
    }

    async function ensurePort(forceDetect = false) {
      if (!ipc) return null;
      if (!isAutoMode()) {
        detectedPort = manualPort(currentSettings);
        return detectedPort;
      }
      if (!detectedPort || forceDetect) {
        await detectPort(forceDetect);
      }
      return detectedPort;
    }

    async function fetchTree(port) {
      if (!ipc || !port) return null;
      const res = await ipc.invoke('ts-serial-tree', {
        port,
        baudRate: effectiveBaudRate(),
        usePrefix: !!currentSettings.usePrefix,
        verbose: !!currentSettings.debug,
      });
      return res;
    }

    async function poll() {
      const base = baseData();
      if (!ipc) {
        updateCallback({ ...base, status: 'unavailable', error: 'Electron IPC unavailable' });
        return;
      }

      const port = await ensurePort(false);
      if (!port) {
        const errMsg = lastError?.message || lastError || 'ThingSet shell not detected';
        updateCallback({ ...base, status: 'no-port', error: errMsg });
        return;
      }

      try {
        const treeRes = await fetchTree(port);
        const root = treeRes?.root || null;
        lastMeta = {
          node_uid: treeRes?.node_uid ?? lastMeta?.node_uid ?? null,
          node_name: treeRes?.node_name ?? lastMeta?.node_name ?? null,
          node_addr: treeRes?.node_addr ?? lastMeta?.node_addr ?? null,
          address_hex: treeRes?.address_hex ?? lastMeta?.address_hex ?? null,
        };
        const { values, numericValues, numericLabels } = flattenTree(root);
        const data = {
          ...base,
          portPath: port,
          status: 'ok',
          device: resolveDeviceLabel(treeRes, port),
          node_uid: treeRes?.node_uid ?? lastMeta?.node_uid ?? null,
          node_name: treeRes?.node_name ?? lastMeta?.node_name ?? null,
          node_addr: treeRes?.node_addr ?? lastMeta?.node_addr ?? null,
          address_hex: treeRes?.address_hex ?? lastMeta?.address_hex ?? null,
          tree: root,
          values,
          y: numericValues,
          labels: numericLabels,
        };
        numericValues.forEach((val, idx) => { data[`y${idx + 1}`] = val; });
        updateCallback(data);
        lastError = null;
      } catch (err) {
        lastError = err;
        const detail = err?.message || String(err);
        const data = { ...base, portPath: port, status: 'error', error: detail };
        updateCallback(data);
        if (isAutoMode()) {
          detectedPort = null;
        }
      }
    }

    function stopTimer() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function updateTimer() {
      stopTimer();
      let interval = Number(currentSettings.refresh);
      if (!Number.isFinite(interval) || interval < 200) interval = 1000;
      timer = setInterval(() => { self.updateNow(); }, interval);
    }

    self.updateNow = () => {
      if (pollInFlight) return pollInFlight;
      pollInFlight = (async () => {
        try {
          await poll();
        } finally {
          pollInFlight = null;
        }
      })();
      return pollInFlight;
    };

    self.onDispose = () => {
      stopTimer();
    };

    self.onSettingsChanged = (newSettings) => {
      currentSettings = newSettings || {};
      if (!isAutoMode()) {
        detectedPort = manualPort(currentSettings);
      } else if (!detectedPort) {
        detectPort(true);
      }
      updateTimer();
      self.updateNow();
    };

    if (isAutoMode() && !detectedPort) detectPort(true);
    updateTimer();
  }

  async function registerPlugin() {
    const portOptions = await fetchSerialPortOptions();
    const manualOptions = [{ name: 'Select a port…', value: '' }, ...portOptions];
    freeboard.loadDatasourcePlugin({
      type_name: 'thingset_serial_datasource',
      display_name: 'ThingSet Serial',
      description: 'Auto-detect a ThingSet shell over serial and expose its tree + numeric leaves.',
      settings: [
        { name: 'autoDetect', display_name: 'Auto detect port', type: 'boolean', default_value: true },
        {
          name: 'portPath',
          display_name: 'Port (manual override)',
          type: 'option',
          options: manualOptions,
          default_value: manualOptions[0]?.value || '',
          description: 'Shown when auto-detect is disabled; pick a serial device to probe.',
        },
        { name: 'baudRate', display_name: 'Baud Rate', type: 'number', default_value: 115200 },
        { name: 'usePrefix', display_name: 'Use "thingset" command prefix', type: 'boolean', default_value: false },
        { name: 'refresh', display_name: 'Refresh Every', type: 'number', suffix: 'ms', default_value: 2000 },
        { name: 'debug', display_name: 'Verbose logging', type: 'boolean', default_value: false },
      ],
      newInstance(settings, newInstanceCallback, updateCallback) {
        newInstanceCallback(new ThingSetSerialDatasource(settings, updateCallback));
      },
    });
  }

  registerPlugin();
}());
