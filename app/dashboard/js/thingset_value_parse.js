(function () {
  function parseInputValue(raw) {
    if (raw == null) return '';
    const txt = String(raw).trim();
    if (txt === '') return '';
    const lowered = txt.toLowerCase();
    if (lowered === 'true' || lowered === 'false' || lowered === 'null') {
      try { return JSON.parse(lowered); } catch (e) { return txt; }
    }
    if ((txt.startsWith('{') && txt.endsWith('}')) || (txt.startsWith('[') && txt.endsWith(']')) || (txt.startsWith('"') && txt.endsWith('"'))) {
      try { return JSON.parse(txt); } catch (e) { return txt; }
    }
    if (/^0x[0-9a-f]+$/i.test(txt)) {
      try { return Number.parseInt(txt, 16); } catch (e) { return txt; }
    }
    const num = Number(txt);
    if (!Number.isNaN(num)) return num;
    return txt;
  }

  window.ThingSetValueParse = { parseInputValue: parseInputValue };
}());
