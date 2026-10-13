// Shared ThingSet write for widgets bound to a ThingSet serial datasource.
//
// Every widget used to call thingsetSerial.setValue() on its own and treat
// "no exception" as success, so a write the board rejected ({ok:false})
// looked exactly like one it accepted. This checks the result, shows the
// device's readback in the datasource immediately (so a one-shot flag the
// firmware clears itself, e.g. /Debug/Scope/wArm, shows its real state), and
// returns the outcome for the widget to display.
(function () {
  function datasourceInstance(name) {
    const live = window.freeboard && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
    const model = live && live.datasources().find((d) => { try { return d.name() === name; } catch (e) { return false; } });
    return model ? model.datasourceInstance : null;
  }

  // Returns { ok, readBack, error }. Never throws.
  async function write({ datasource, path, value, refresh = false }) {
    const api = window.api && window.api.thingsetSerial ? window.api.thingsetSerial : null;
    const dsSettings = (window.freeboard && freeboard.getDatasourceSettings(datasource)) || {};
    if (!api || !api.setValue) return { ok: false, error: 'ThingSet API unavailable' };
    if (!path) return { ok: false, error: 'no ThingSet path configured' };
    if (!dsSettings.portPath) return { ok: false, error: 'datasource has no connected port' };
    let res;
    try {
      res = await api.setValue({
        port: dsSettings.portPath,
        path,
        value,
        baudRate: Number(dsSettings.baudRate) || 115200,
        usePrefix: !!dsSettings.usePrefix,
      });
    } catch (err) {
      console.error('ThingSet write failed:', err);
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
    if (!res || !res.ok) {
      console.warn(`ThingSet write rejected: ${path}=${JSON.stringify(value)}`, res);
      return { ok: false, readBack: res ? res.readBack : undefined, error: `board rejected ${path}` };
    }
    const instance = datasourceInstance(datasource);
    if (instance && typeof instance.applyWrite === 'function') instance.applyWrite(path, res.readBack);
    // Values that change as a consequence of the write (e.g. rState after
    // wArm) need a refresh; it's a cheap values-only one, not a tree walk.
    if (refresh && instance && typeof instance.updateNow === 'function') instance.updateNow();
    return { ok: true, readBack: res.readBack };
  }

  window.ThingSetWrite = { write };
}());
