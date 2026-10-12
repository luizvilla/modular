(function () {
  const ThingSetSerialDatasource = window.ThingSetSerialDatasourceCore;

  async function registerPlugin() {
    const portOptions = await ThingSetSerialDatasource.fetchSerialPortOptions();
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
          description: 'Only used when auto-detect is off; ignored otherwise. On OwnTech boards pick the if02 port -- if00 is the scope data port.',
        },
        { name: 'baudRate', display_name: 'Baud Rate', type: 'number', default_value: 115200 },
        { name: 'usePrefix', display_name: 'Use "thingset" command prefix', type: 'boolean', default_value: false },
        {
          name: 'autoRefresh',
          display_name: 'Auto Refresh',
          type: 'boolean',
          default_value: false,
          description: 'Automatically re-fetch the ThingSet tree on a timer. Each refresh walks the whole tree (many round-trip commands), so this is off by default -- use the Refresh button for on-demand updates.',
        },
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
