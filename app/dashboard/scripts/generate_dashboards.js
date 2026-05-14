#!/usr/bin/env node
/*
 * Generate dashboard JSON files from example main.cpp sources.
 * - Scans app/dashboard/docs/examples/.../main.cpp
 * - Extracts communication commands from loop_communication_task
 * - Extracts application task numeric outputs from loop_application_task
 * - Builds dashboards with serial terminal, plot, separate plot UI + series manager, serial command buttons
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const examplesRoot = path.join(repoRoot, 'app', 'dashboard', 'docs', 'examples');
const dashboardsRoot = path.join(repoRoot, 'app', 'dashboard', 'dashboards');

function walk(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.isFile() && entry.name === 'main.cpp') {
      acc.push(full);
    }
  }
  return acc;
}

function extractFunctionBody(source, name) {
  const re = new RegExp(`void\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'g');
  const match = re.exec(source);
  if (!match) return null;
  const braceIdx = match.index + match[0].lastIndexOf('{');
  let i = braceIdx + 1;
  let depth = 1;
  let inStr = false;
  let strChar = '';
  let escape = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === strChar) {
        inStr = false;
        strChar = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  return source.slice(braceIdx + 1, i);
}

function extractCalls(body, fnName) {
  const calls = [];
  let idx = 0;
  while (idx < body.length) {
    const hit = body.indexOf(fnName, idx);
    if (hit < 0) break;
    const open = body.indexOf('(', hit + fnName.length);
    if (open < 0) break;
    let i = open + 1;
    let depth = 1;
    let inStr = false;
    let strChar = '';
    let escape = false;
    for (; i < body.length; i++) {
      const ch = body[i];
      if (inStr) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === strChar) {
          inStr = false;
          strChar = '';
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        strChar = ch;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;
    const args = body.slice(open + 1, i);
    calls.push({ start: hit, end: i, args });
    idx = i + 1;
  }
  return calls;
}

function extractFirstStringLiteral(args) {
  const firstQuote = args.indexOf('"');
  if (firstQuote < 0) return null;
  let i = firstQuote + 1;
  let out = '';
  let escape = false;
  for (; i < args.length; i++) {
    const ch = args[i];
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      return { text: out, endIdx: i };
    }
    out += ch;
  }
  return null;
}

function extractAllStringLiterals(args) {
  const out = [];
  let i = 0;
  while (i < args.length) {
    const quoteIdx = args.indexOf('"', i);
    if (quoteIdx < 0) break;
    i = quoteIdx + 1;
    let text = '';
    let escape = false;
    for (; i < args.length; i++) {
      const ch = args[i];
      if (escape) {
        text += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        out.push(text);
        i += 1;
        break;
      }
      text += ch;
    }
  }
  return out;
}

function splitTopLevelCommas(text) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let inStr = false;
  let strChar = '';
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      buf += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === strChar) {
        inStr = false;
        strChar = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function normalizeLabel(label) {
  return label.replace(/\s+/g, ' ').trim();
}

function parseMenuLabels(menuBlock) {
  if (!menuBlock) return {};
  const calls = extractCalls(menuBlock, 'printk');
  const strings = [];
  for (const call of calls) {
    const lits = extractAllStringLiterals(call.args);
    if (lits.length) strings.push(lits.join(''));
  }
  const joined = strings.join('\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
  const map = {};
  const re = /press\s+([a-zA-Z0-9])\s*:\s*([^\n\r|]+)/g;
  let m;
  while ((m = re.exec(joined)) !== null) {
    map[m[1]] = normalizeLabel(m[2]);
  }
  return map;
}

function parseCommentLabel(caseBlock) {
  if (!caseBlock) return null;
  const lines = caseBlock.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      const text = trimmed.replace(/^\/\/\s*/, '');
      if (text) return normalizeLabel(text);
    }
  }
  const blockMatch = caseBlock.match(/\/\*([\s\S]*?)\*\//);
  if (blockMatch && blockMatch[1]) {
    const text = blockMatch[1]
      .split('\n')
      .map(l => l.replace(/^\s*\*\s?/, ''))
      .map(l => l.trim())
      .filter(Boolean)[0];
    if (text) return normalizeLabel(text);
  }
  return null;
}

function parseCommunicationCommands(body) {
  if (!body) return [];
  const menuLabels = parseMenuLabels(extractCaseBlock(body, ['h', 'H']));
  const commands = [];
  const seen = new Set();
  const caseRe = /case\s+'([^'])'\s*:/g;
  let m;
  while ((m = caseRe.exec(body)) !== null) {
    const key = m[1];
    if (key === 'h' || key === 'H') continue;
    if (!/[a-zA-Z0-9]/.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const block = extractCaseBlock(body, [key]);
    const commentLabel = parseCommentLabel(block);
    const label = menuLabels[key] || commentLabel || `Command ${key}`;
    commands.push({ label, command: key });
  }
  return commands;
}

function extractCaseBlock(body, keys) {
  if (!body) return null;
  const keySet = new Set(keys);
  const caseRe = /case\s+'([^'])'\s*:/g;
  let m;
  while ((m = caseRe.exec(body)) !== null) {
    const key = m[1];
    if (!keySet.has(key)) continue;
    const start = m.index + m[0].length;
    // find next case/default or end
    const rest = body.slice(start);
    const next = rest.search(/\n\s*(case\s+'[^']'\s*:|default\s*:)/);
    if (next < 0) return rest;
    return rest.slice(0, next);
  }
  return null;
}

function parseApplicationChannels(body) {
  if (!body) return [];
  const calls = extractCalls(body, 'printk');
  const channels = [];
  for (const call of calls) {
    const lit = extractFirstStringLiteral(call.args);
    if (!lit) continue;
    const fmt = lit.text || '';
    if (!fmt.includes('%')) {
      if (fmt.includes('\\n') || fmt.includes('\n')) {
        // end-of-line marker even if no numeric content
        // no-op
      }
      continue;
    }
    const after = call.args.slice(lit.endIdx + 1);
    const parts = splitTopLevelCommas(after.replace(/^\s*,/, ''));
    if (!parts.length) continue;
    const expr = parts[0];
    const cleaned = expr
      .replace(/^\s*\([^)]*\)\s*/g, '')
      .replace(/^\s*[&*]+\s*/, '');
    const matches = cleaned.match(/([A-Za-z_][A-Za-z0-9_]*)/g);
    if (!matches || !matches.length) continue;
    const name = matches[matches.length - 1];
    channels.push(name);
    if (fmt.includes('\\n') || fmt.includes('\n')) break;
  }
  return channels;
}

function filterVoltageCurrentChannels(channels) {
  if (!channels.length) return channels.map((label, index) => ({ label, index }));
  const indexed = channels.map((label, index) => ({ label, index }));
  const filtered = indexed.filter((item) => /(^[VI])|(_V)|(_I)|voltage|current/i.test(item.label));
  return filtered.length ? filtered : indexed;
}

function buildDashboard(exampleName, commands, channels) {
  const serialName = 'Serial';
  const selected = filterVoltageCurrentChannels(channels);
  const normalized = selected.length
    ? selected
    : [{ label: 'Channel 1', index: 0 }];
  const seriesDefs = normalized.map((item) => ({
    label: item.label,
    op: 'identity',
    param: 0,
    a: {
      ds: serialName,
      type: 'serialport_datasource',
      device: null,
      device_uid: null,
      var: item.index
    }
  }));

  const plotWidget = {
    type: 'time_plot_uplot',
    settings: {
      title: `${exampleName} Plot`,
      refreshRate: 100,
      duration: 20000,
      showLegend: true,
      yLabel: 'Value',
      helperWidgets: 'none',
      seriesDefs
    }
  };

  const terminalWidget = {
    type: 'serial_terminal',
    settings: {
      title: 'Serial Port',
      datasourceName: serialName,
      refresh: 250,
      maxLines: 200,
      autoScroll: true,
      colorize: true
    }
  };

  const commandWidget = {
    type: 'serial_command_buttons',
    settings: {
      buttons: commands,
      layout: 'vertical',
      datasource: serialName
    }
  };

  const uiWidget = { type: 'uplot_config_panel', settings: { title: 'Plot UI controller' } };
  const seriesWidget = { type: 'uplot_series_manager', settings: { title: 'Plot Series Manager' } };

  return {
    version: 1,
    allow_edit: true,
    plugins: [],
    panes: [
      {
        width: 1,
        row: { 3: 1 },
        col: { 3: 1 },
        col_width: 2,
        widgets: [plotWidget]
      },
      {
        width: 1,
        row: { 3: 5 },
        col: { 3: 1 },
        col_width: 2,
        widgets: [uiWidget, seriesWidget]
      },
      {
        width: 1,
        row: { 3: 1 },
        col: { 3: 3 },
        col_width: 1,
        widgets: [terminalWidget, commandWidget]
      }
    ],
    datasources: [
      {
        name: serialName,
        type: 'serialport_datasource',
        settings: {
          portPath: '',
          baudRate: 115200,
          separator: ':',
          eol: '\\n',
          refresh: 250,
          paused: true
        }
      }
    ],
    columns: 3
  };
}

function writeDashboard(exampleName, dashboard) {
  const dir = path.join(dashboardsRoot, exampleName);
  const filePath = path.join(dir, `${exampleName}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(dashboard, null, 2));
  return filePath;
}

function main() {
  if (!fs.existsSync(examplesRoot)) {
    console.error(`Examples root not found: ${examplesRoot}`);
    process.exit(1);
  }

  const mainFiles = walk(examplesRoot);
  if (!mainFiles.length) {
    console.error('No main.cpp files found.');
    process.exit(1);
  }

  const written = [];
  const warnings = [];
  for (const file of mainFiles) {
    const exampleName = path.basename(path.dirname(file));
    const src = fs.readFileSync(file, 'utf8');
    const commBody = extractFunctionBody(src, 'loop_communication_task');
    const appBody = extractFunctionBody(src, 'loop_application_task');

    const commands = parseCommunicationCommands(commBody);
    const channels = parseApplicationChannels(appBody);
    if (!commands.length) warnings.push(`${exampleName}: no communication commands found`);
    if (!channels.length) warnings.push(`${exampleName}: no application channels found`);

    const dashboard = buildDashboard(exampleName, commands, channels);
    const outPath = writeDashboard(exampleName, dashboard);
    written.push(outPath);
  }

  console.log(`Generated ${written.length} dashboards.`);
  if (warnings.length) {
    console.warn('Warnings:');
    warnings.forEach(msg => console.warn(`- ${msg}`));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  extractFunctionBody,
  parseCommunicationCommands,
  parseApplicationChannels,
  filterVoltageCurrentChannels
};
