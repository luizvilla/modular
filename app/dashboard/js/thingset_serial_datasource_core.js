(function () {
  const api = window.api || null;
  const serialApi = api && api.serial ? api.serial : null;
  const tsSerialApi = api && api.thingsetSerial ? api.thingsetSerial : null;
  const ipc = !api && window.require ? window.require('electron')?.ipcRenderer : null;
  // Add a user-friendly tag for OwnTech devices without duplicating.
  function formatPortLabel(port) {
      if (port === null || port === undefined) return '';
      if (typeof port === 'string') return port;
      const base = String(port.name || port.value || port.path || '');
      if (!port.isOwntech) return base;
      return base.includes('OwnTech') ? base : `${base} (OwnTech)`;
  }

  async function fetchSerialPortOptions() {
    if (!serialApi && !ipc) return [];
    try {
      const ports = serialApi && serialApi.listPorts
        ? await serialApi.listPorts()
        : await ipc.invoke('get-serial-ports');
      if (Array.isArray(ports) && ports.length) {
        // A board's scope data port is never a ThingSet shell (the main
        // process refuses ThingSet operations on it), so it isn't offered.
        return ports
          .filter((p) => !(p && p.role === 'scope'))
          .map((p) => ({ name: formatPortLabel(p), value: p.value || p.name || p.path || String(p) }));
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
    // In auto mode portPath only records the last detected port; it must not
    // pin detection to it (a stale or mis-picked if00 would never be escaped).
    let detectedPort = currentSettings.autoDetect !== false ? null : manualPort(currentSettings);
    let lastMeta = null;
    let lastError = null;
    let pollInFlight = null;
    // A full walk discovers the tree; later polls only refresh its values
    // (mode:'values', ~20 group reads instead of ~2.5s of per-node walking).
    // A new port, an explicit rescan() or a failed refresh walks again.
    let walkedPort = null;
    let fullRequested = false;
    let lastData = null;

    function isAutoMode() {
      return currentSettings.autoDetect !== false;
    }

    // Pause handling to release the serial port on demand.
    function isPaused() {
      return !!(currentSettings && currentSettings.paused);
    }

    async function closePort() {
      if (!detectedPort) return;
      try {
        if (serialApi && serialApi.closePort) {
          await serialApi.closePort(detectedPort);
        } else if (ipc) {
          await ipc.invoke('close-serial-port', { path: detectedPort });
        }
      } catch (e) {
        console.warn('ThingSet Serial: close port failed', e?.message || e);
      }
    }

    function effectiveBaudRate() {
      const num = Number(currentSettings.baudRate);
      return Number.isFinite(num) && num > 0 ? num : 115200;
    }

    async function detectPort(force = false) {
      if (!tsSerialApi && !ipc) return null;
      if (!isAutoMode()) {
        detectedPort = manualPort(currentSettings);
        return detectedPort;
      }
      if (detectedPort && !force) return detectedPort;
      if (detectPromise) return detectPromise;

      const opts = {
        port: null,
        baudRate: effectiveBaudRate(),
        usePrefix: !!currentSettings.usePrefix,
        verbose: !!currentSettings.debug,
      };

      detectPromise = (async () => {
        try {
          const res = tsSerialApi && tsSerialApi.detect
            ? await tsSerialApi.detect(opts)
            : await ipc.invoke('ts-serial-detect', opts);
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
      if (!tsSerialApi && !ipc) return null;
      if (!isAutoMode()) {
        detectedPort = manualPort(currentSettings);
        return detectedPort;
      }
      if (!detectedPort || forceDetect) {
        await detectPort(forceDetect);
      }
      return detectedPort;
    }

    async function fetchTree(port, mode) {
      if (!port) return null;
      const payload = {
        port,
        mode,
        baudRate: effectiveBaudRate(),
        usePrefix: !!currentSettings.usePrefix,
        verbose: !!currentSettings.debug,
      };
      return tsSerialApi && tsSerialApi.tree
        ? tsSerialApi.tree(payload)
        : ipc.invoke('ts-serial-tree', payload);
    }

    async function poll() {
      if (isPaused()) return;
      const base = baseData();
      if (!tsSerialApi && !ipc) {
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
        const mode = (fullRequested || walkedPort !== port) ? 'full' : 'values';
        fullRequested = false;
        const treeRes = await fetchTree(port, mode);
        walkedPort = port;
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
        lastData = data;
        updateCallback(data);
        lastError = null;
      } catch (err) {
        lastError = err;
        const detail = err?.message || String(err);
        const data = { ...base, portPath: port, status: 'error', error: detail };
        walkedPort = null;
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
      if (isPaused()) return;
      // A ThingSet refresh is a full tree walk -- dozens of round-trip serial
      // commands, not a cheap buffer read -- so unlike a regular serial
      // datasource it does NOT poll on a timer unless explicitly enabled.
      // Undefined (e.g. dashboards saved before this setting existed) is
      // treated the same as off, matching the declared default.
      if (currentSettings.autoRefresh !== true) return;
      let interval = Number(currentSettings.refresh);
      if (!Number.isFinite(interval) || interval < 200) interval = 1000;
      timer = setInterval(() => { self.updateNow(); }, interval);
    }

    self.updateNow = () => {
      if (isPaused()) return Promise.resolve();
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

    // Full re-walk (discovers added/removed nodes), e.g. the Rescan button.
    self.rescan = () => {
      fullRequested = true;
      return self.updateNow();
    };

    // Shows a just-written value immediately, without waiting for the next
    // poll. `value` should be the device's readback, so one-shot flags the
    // firmware clears itself (e.g. /Debug/Scope/wArm) show their real state.
    self.applyWrite = (path, value) => {
      if (!lastData || !path || value === undefined || value === null) return;
      const key = String(path).startsWith('/') ? String(path) : `/${path}`;
      if (!(key in (lastData.values || {}))) return;
      lastData = { ...lastData, values: { ...lastData.values, [key]: value } };
      updateCallback(lastData);
    };

    self.onDispose = () => {
      stopTimer();
    };

    self.onSettingsChanged = (newSettings) => {
      currentSettings = newSettings || {};
      if (isPaused()) {
        stopTimer();
        closePort();
        return;
      }
      if (!isAutoMode()) {
        detectedPort = manualPort(currentSettings);
      } else {
        // Re-detect on every settings save in auto mode: a previously
        // detected port may be exactly what the user is trying to get away from.
        detectedPort = null;
        detectPort(true);
      }
      updateTimer();
      self.updateNow();
    };

    if (!isPaused()) {
      if (isAutoMode() && !detectedPort) detectPort(true);
      updateTimer();
    }
  }

  // Live port list for the datasource settings form: the form calls the
  // provider synchronously (and every optionsRefreshMs while open), so it
  // returns the last list and refreshes it in the background -- a port that
  // appears after startup (a board plugged in, the demo board switched on)
  // shows up without restarting the app.
  let portOptionsCache = [];
  function refreshPortOptions() {
    fetchSerialPortOptions().then((list) => { portOptionsCache = list; }).catch(() => {});
  }
  function portOptionsProvider() {
    refreshPortOptions();
    return [{ name: 'Select a port…', value: '' }, ...portOptionsCache];
  }
  refreshPortOptions();
  if (api && api.demoBoard && typeof api.demoBoard.onChanged === 'function') api.demoBoard.onChanged(refreshPortOptions);

  ThingSetSerialDatasource.fetchSerialPortOptions = fetchSerialPortOptions;
  ThingSetSerialDatasource.portOptionsProvider = portOptionsProvider;
  ThingSetSerialDatasource.formatPortLabel = formatPortLabel;

  window.ThingSetSerialDatasourceCore = ThingSetSerialDatasource;
}());
