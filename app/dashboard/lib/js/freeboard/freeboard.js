// ┌────────────────────────────────────────────────────────────────────┐ \\
// │ F R E E B O A R D                                                  │ \\
// ├────────────────────────────────────────────────────────────────────┤ \\
// │ Copyright © 2013 Jim Heising (https://github.com/jheising)         │ \\
// │ Copyright © 2013 Bug Labs, Inc. (http://buglabs.net)               │ \\
// ├────────────────────────────────────────────────────────────────────┤ \\
// │ Licensed under the MIT license.                                    │ \\
// └────────────────────────────────────────────────────────────────────┘ \\

// Jquery plugin to watch for attribute changes
(function($)
{
	function isDOMAttrModifiedSupported()
	{
		var p = document.createElement('p');
		var flag = false;

		if(p.addEventListener)
		{
			p.addEventListener('DOMAttrModified', function()
			{
				flag = true
			}, false);
		}
		else if(p.attachEvent)
		{
			p.attachEvent('onDOMAttrModified', function()
			{
				flag = true
			});
		}
		else
		{
			return false;
		}

		p.setAttribute('id', 'target');

		return flag;
	}

	function checkAttributes(chkAttr, e)
	{
		if(chkAttr)
		{
			var attributes = this.data('attr-old-value');

			if(e.attributeName.indexOf('style') >= 0)
			{
				if(!attributes['style'])
				{
					attributes['style'] = {};
				} //initialize
				var keys = e.attributeName.split('.');
				e.attributeName = keys[0];
				e.oldValue = attributes['style'][keys[1]]; //old value
				e.newValue = keys[1] + ':' + this.prop("style")[$.camelCase(keys[1])]; //new value
				attributes['style'][keys[1]] = e.newValue;
			}
			else
			{
				e.oldValue = attributes[e.attributeName];
				e.newValue = this.attr(e.attributeName);
				attributes[e.attributeName] = e.newValue;
			}

			this.data('attr-old-value', attributes); //update the old value object
		}
	}

	//initialize Mutation Observer
	var MutationObserver = window.MutationObserver || window.WebKitMutationObserver;

	$.fn.attrchange = function(o)
	{

		var cfg = {
			trackValues: false,
			callback   : $.noop
		};

		//for backward compatibility
		if(typeof o === "function")
		{
			cfg.callback = o;
		}
		else
		{
			$.extend(cfg, o);
		}

		if(cfg.trackValues)
		{ //get attributes old value
			$(this).each(function(i, el)
			{
				var attributes = {};
				for(var attr, i = 0, attrs = el.attributes, l = attrs.length; i < l; i++)
				{
					attr = attrs.item(i);
					attributes[attr.nodeName] = attr.value;
				}

				$(this).data('attr-old-value', attributes);
			});
		}

		if(MutationObserver)
		{ //Modern Browsers supporting MutationObserver
			/*
			 Mutation Observer is still new and not supported by all browsers.
			 http://lists.w3.org/Archives/Public/public-webapps/2011JulSep/1622.html
			 */
			var mOptions = {
				subtree          : false,
				attributes       : true,
				attributeOldValue: cfg.trackValues
			};

			var observer = new MutationObserver(function(mutations)
			{
				mutations.forEach(function(e)
				{
					var _this = e.target;

					//get new value if trackValues is true
					if(cfg.trackValues)
					{
						/**
						 * @KNOWN_ISSUE: The new value is buggy for STYLE attribute as we don't have
						 * any additional information on which style is getting updated.
						 * */
						e.newValue = $(_this).attr(e.attributeName);
					}

					cfg.callback.call(_this, e);
				});
			});

			return this.each(function()
			{
				observer.observe(this, mOptions);
			});
		}
		else if(isDOMAttrModifiedSupported())
		{ //Opera
			//Good old Mutation Events but the performance is no good
			//http://hacks.mozilla.org/2012/05/dom-mutationobserver-reacting-to-dom-changes-without-killing-browser-performance/
			return this.on('DOMAttrModified', function(event)
			{
				if(event.originalEvent)
				{
					event = event.originalEvent;
				} //jQuery normalization is not required for us
				event.attributeName = event.attrName; //property names to be consistent with MutationObserver
				event.oldValue = event.prevValue; //property names to be consistent with MutationObserver
				cfg.callback.call(this, event);
			});
		}
		else if('onpropertychange' in document.body)
		{ //works only in IE
			return this.on('propertychange', function(e)
			{
				e.attributeName = window.event.propertyName;
				//to set the attr old value
				checkAttributes.call($(this), cfg.trackValues, e);
				cfg.callback.call(this, e);
			});
		}

		return this;
	}
})(jQuery);

(function(jQuery) {

    jQuery.eventEmitter = {
        _JQInit: function() {
            this._JQ = jQuery(this);
        },
        emit: function(evt, data) {
            !this._JQ && this._JQInit();
            this._JQ.trigger(evt, data);
        },
        once: function(evt, handler) {
            !this._JQ && this._JQInit();
            this._JQ.one(evt, handler);
        },
        on: function(evt, handler) {
            !this._JQ && this._JQInit();
            this._JQ.bind(evt, handler);
        },
        off: function(evt, handler) {
            !this._JQ && this._JQInit();
            this._JQ.unbind(evt, handler);
        }
    };

}(jQuery));

var freeboard = (function()
{
	var datasourcePlugins = {};
	var widgetPlugins = {};

	var freeboardUI = new FreeboardUI();
	var theFreeboardModel = new FreeboardModel(datasourcePlugins, widgetPlugins, freeboardUI);

	var jsEditor = new JSEditor();
	var valueEditor = new ValueEditor(theFreeboardModel);
	var pluginEditor = new PluginEditor(jsEditor, valueEditor);

	var developerConsole = new DeveloperConsole(theFreeboardModel);

	var currentStyle = {
		values: {
			"font-family": '"HelveticaNeue-UltraLight", "Helvetica Neue Ultra Light", "Helvetica Neue", sans-serif',
			"color"      : "#d3d4d4",
			"font-weight": 100
		}
	};

	function getWidgetDefaultTitle(typeName)
	{
		var widgetType = widgetPlugins[typeName];
		if(!widgetType)
		{
			return String(typeName || "Widget");
		}

		var titleSetting = _.find(widgetType.settings || [], function(settingDef)
		{
			return settingDef.name === "title";
		});
		if(titleSetting && !_.isUndefined(titleSetting.default_value) && titleSetting.default_value !== "")
		{
			return String(titleSetting.default_value);
		}

		return String(widgetType.display_name || widgetType.type_name || typeName || "Widget");
	}

	function buildUniqueWidgetTitle(baseTitle, widgetToIgnore)
	{
		var base = String(baseTitle || "Widget").trim() || "Widget";
		var titles = [];

		_.each(theFreeboardModel.panes(), function(pane)
		{
			_.each(pane.widgets(), function(widget)
			{
				if(widgetToIgnore && widget === widgetToIgnore)
				{
					return;
				}

				var title = widget.settings && widget.settings().title;
				if(_.isFunction(title))
				{
					title = title();
				}
				title = String(title || "").trim();
				if(title)
				{
					titles.push(title);
				}
			});
		});

		if(!_.contains(titles, base))
		{
			return base;
		}

		var suffix = 2;
		while(_.contains(titles, base + " " + suffix))
		{
			suffix++;
		}

		return base + " " + suffix;
	}

	function ensureUniqueWidgetTitle(typeName, settings, widgetToIgnore)
	{
		var widgetType = widgetPlugins[typeName];
		if(!widgetType)
		{
			return settings;
		}

		var hasTitle = _.some(widgetType.settings || [], function(settingDef)
		{
			return settingDef.name === "title";
		});
		if(!hasTitle)
		{
			return settings;
		}

		var baseTitle = String(settings.title || "").trim() || getWidgetDefaultTitle(typeName);
		settings.title = buildUniqueWidgetTitle(baseTitle, widgetToIgnore);
		return settings;
	}

	function normalizeWidgetSettingsForType(typeName, settings)
	{
		var widgetType = widgetPlugins[typeName];
		var source = _.clone(settings || {});
		if(!widgetType || !_.isArray(widgetType.settings))
		{
			return source;
		}

		var normalized = {};
		_.each(widgetType.settings, function(settingDef)
		{
			if(!_.isUndefined(source[settingDef.name]))
			{
				normalized[settingDef.name] = source[settingDef.name];
			}
		});

		return normalized;
	}

	function isIntegratedPlotEditorType(typeName)
	{
		return typeName === "time_plot_uplot" || typeName === "xy_plot_uplot" || typeName === "fast_frame_plot" || typeName === "fft_spectrum_plot" || typeName === "vertical_gauge" || typeName === "horizontal_gauge" || typeName === "radial_arc_gauge" || typeName === "radial_needle_gauge" || typeName === "donut_gauge";
	}

	var plotEditorShared = (function()
	{
		function parseNumber(value)
		{
			var n = Number(value);
			return Number.isFinite(n) ? n : undefined;
		}

		function parseSeriesDefs(value)
		{
			if(Array.isArray(value)) return value.slice();
			if(typeof value === "string")
			{
				try { return JSON.parse(value); } catch(e) { return []; }
			}
			return [];
		}

		function getLiveModel()
		{
			return freeboard.getLiveModel ? freeboard.getLiveModel() : null;
		}

		function getDatasourceSettings(dsName)
		{
			return freeboard.getDatasourceSettings ? (freeboard.getDatasourceSettings(dsName) || {}) : {};
		}

		function listDatasources()
		{
			var live = getLiveModel();
			var out = [];
			if(!live || typeof live.datasources !== "function") return out;
			live.datasources().forEach(function(ds)
			{
				try
				{
					var name = ds.name && ds.name();
					var dsType = ds.type && ds.type();
					if(!name) return;
					if(["serialport_datasource", "fast_frame_datasource", "can_datasource", "signal_generator_datasource"].indexOf(dsType) >= 0)
					{
						out.push({ name: name, type: dsType });
					}
				}
				catch(e) {}
			});
			return out;
		}

		function getDatasourceType(dsName)
		{
			if(!dsName) return null;
			var live = getLiveModel();
			if(!live || typeof live.datasources !== "function") return null;
			var list = live.datasources();
			for(var i = 0; i < list.length; i++)
			{
				try
				{
					if(list[i].name && list[i].name() === dsName)
					{
						return list[i].type && list[i].type();
					}
				}
				catch(e) {}
			}
			return null;
		}

		async function invoke(channel, payload)
		{
			if(window.api && window.api.ipc && typeof window.api.ipc.invoke === "function")
			{
				try
				{
					return await window.api.ipc.invoke(channel, payload || {});
				}
				catch(e)
				{
					return null;
				}
			}
			if(window.api)
			{
				var serial = window.api.serial || null;
				var can = window.api.can || null;
				switch(channel)
				{
					case "get-serial-headers":
						return serial && serial.getHeaders ? serial.getHeaders(payload.path, payload.type) : null;
					case "get-fast-dataset":
						return serial && serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
					case "get-serial-buffer":
						return serial && serial.getBuffer ? serial.getBuffer(payload.path) : null;
					case "can-aggregate-start":
						return can && can.aggregateStart ? can.aggregateStart(payload) : null;
					case "can-aggregate-snapshot":
						return can && can.aggregateSnapshot ? can.aggregateSnapshot(payload) : null;
				}
			}
			return null;
		}

		async function fetchDatasourceHeaders(dsName)
		{
			var dsType = getDatasourceType(dsName);
			if(!dsName || !dsType) return [];
			var settings = getDatasourceSettings(dsName);
			var path = settings.portPath || dsName;
			var headers = await invoke("get-serial-headers", { path: path, type: dsType });
			return Array.isArray(headers) ? headers : [];
		}

		async function fetchDatasourceChannelCount(dsName, dsType)
		{
			if(!dsName || !dsType) return 0;
			var settings = getDatasourceSettings(dsName);
			var path = settings.portPath || dsName;
			try
			{
				if(dsType === "fast_frame_datasource")
				{
					var dataset = await invoke("get-fast-dataset", { path: path });
					if(dataset && Array.isArray(dataset.series)) return dataset.series.length;
				}
				else if(dsType === "serialport_datasource")
				{
					var arr = await invoke("get-serial-buffer", { path: path });
					if(Array.isArray(arr)) return arr.length;
				}
			}
			catch(e) {}
			return 0;
		}

		function formatIndexedChannelLabel(index, headers)
		{
			if(Array.isArray(headers) && headers[index]) return headers[index];
			var alpha = String.fromCharCode(65 + (index % 26));
			var suffix = index >= 26 ? " " + (Math.floor(index / 26) + 1) : "";
			return "Channel " + alpha + suffix;
		}

		function formatCanDeviceLabel(addr, meta)
		{
			if(!addr) return "";
			var uid = meta && meta.node_uid;
			return uid ? (addr + " (" + uid + ")") : addr;
		}

		async function fetchCanSnapshot(dsName)
		{
			if(!dsName) return null;
			var settings = getDatasourceSettings(dsName);
			var channel = settings.channel || "can0";
			try { await invoke("can-aggregate-start", { channel: channel }); } catch(e) {}
			return invoke("can-aggregate-snapshot", { channel: channel });
		}

		async function fetchCanDevices(dsName)
		{
			var snapshot = await fetchCanSnapshot(dsName);
			var nodes = snapshot && snapshot.nodes ? snapshot.nodes : {};
			return Object.keys(nodes).sort().map(function(addr)
			{
				var meta = nodes[addr] || {};
				return {
					value: addr,
					label: formatCanDeviceLabel(addr, meta),
					uid: meta.node_uid || null
				};
			});
		}

		async function fetchDatasourceVariableOptions(dsName, deviceVal)
		{
			var out = [];
			if(!dsName) return out;
			var dsType = getDatasourceType(dsName);
			if(dsType === "signal_generator_datasource")
			{
				out.push({ value: "0", label: "Signal" });
				return out;
			}
			if(dsType === "fast_frame_datasource" || dsType === "serialport_datasource")
			{
				var headers = await fetchDatasourceHeaders(dsName);
				var count = headers.length;
				if(!count)
				{
					count = await fetchDatasourceChannelCount(dsName, dsType);
				}
				for(var i = 0; i < count; i++)
				{
					out.push({ value: String(i), label: formatIndexedChannelLabel(i, headers) });
				}
				return out;
			}
			if(dsType === "can_datasource")
			{
				var snapshot = await fetchCanSnapshot(dsName);
				var nodes = snapshot && snapshot.nodes ? snapshot.nodes : {};
				var flat = deviceVal && nodes[deviceVal] ? (nodes[deviceVal].flat || {}) : {};
				Object.keys(flat).sort().forEach(function(path)
				{
					var leaf = path.indexOf("/") >= 0 ? path.split("/").pop() : path;
					var label = (leaf && leaf !== path) ? (leaf + " - " + path) : path;
					out.push({ value: path, label: label });
				});
			}
			return out;
		}

		function getColorThemes()
		{
			return {
				ColorBlind10: (typeof ColorBlind10 !== "undefined") ? ColorBlind10 : [],
				OfficeClassic6: (typeof OfficeClassic6 !== "undefined") ? OfficeClassic6 : [],
				HueCircle19: (typeof HueCircle19 !== "undefined") ? HueCircle19 : [],
				Tableau20: (typeof Tableau20 !== "undefined") ? Tableau20 : []
			};
		}

		function commitWidgetSettings(widget, settings)
		{
			if(!widget) return;
			widget.settings(settings);
			if(widget.widgetInstance && widget.widgetInstance.onSettingsChanged)
			{
				widget.widgetInstance.onSettingsChanged(settings);
			}
		}

		function updateWidgetSettings(widget, partial)
		{
			if(!widget) return;
			commitWidgetSettings(widget, _.extend({}, widget.settings(), partial));
		}

		function getFastFrameShared()
		{
			return window.FastFrameShared || null;
		}

		return {
			parseNumber: parseNumber,
			parseSeriesDefs: parseSeriesDefs,
			getLiveModel: getLiveModel,
			getDatasourceSettings: getDatasourceSettings,
			listDatasources: listDatasources,
			getDatasourceType: getDatasourceType,
			invoke: invoke,
			fetchDatasourceHeaders: fetchDatasourceHeaders,
			fetchDatasourceChannelCount: fetchDatasourceChannelCount,
			formatIndexedChannelLabel: formatIndexedChannelLabel,
			formatCanDeviceLabel: formatCanDeviceLabel,
			fetchCanSnapshot: fetchCanSnapshot,
			fetchCanDevices: fetchCanDevices,
			fetchDatasourceVariableOptions: fetchDatasourceVariableOptions,
			getColorThemes: getColorThemes,
			commitWidgetSettings: commitWidgetSettings,
			updateWidgetSettings: updateWidgetSettings,
			getFastFrameShared: getFastFrameShared
		};
	})();

	window.ModularPlotEditorShared = plotEditorShared;

	ko.bindingHandlers.pluginEditor = {
		init: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			var options = ko.unwrap(valueAccessor());

			var types = {};
			var settings = undefined;
			var title = "";

			if(options.type == 'datasource')
			{
				types = datasourcePlugins;
				title = "Datasource";
			}
			else if(options.type == 'widget')
			{
				types = widgetPlugins;
				title = "Widget";
			}
			else if(options.type == 'pane')
			{
				title = "Pane";
			}

			$(element).click(function(event)
			{
				if(options.operation == 'delete')
				{
					var phraseElement = $('<p>Are you sure you want to delete this ' + title + '?</p>');
					new DialogBox(phraseElement, "Confirm Delete", "Yes", "No", function()
					{

						if(options.type == 'datasource')
						{
							theFreeboardModel.deleteDatasource(viewModel);
						}
						else if(options.type == 'widget')
						{
							theFreeboardModel.deleteWidget(viewModel);
						}
						else if(options.type == 'pane')
						{
							theFreeboardModel.deletePane(viewModel);
						}

					});
				}
				else
				{
					var instanceType = undefined;
					var settings = undefined;

					if(options.type == 'datasource')
					{
						if(options.operation == 'add')
						{
							settings = {};
						}
						else
						{
							instanceType = viewModel.type();
							settings = viewModel.settings();
							settings.name = viewModel.name();
						}
					}
					else if(options.type == 'widget')
					{
						if(options.operation == 'add')
						{
							settings = {};
						}
						else
						{
							instanceType = viewModel.type();
							settings = normalizeWidgetSettingsForType(instanceType, viewModel.settings());
						}
					}
					else if(options.type == 'pane')
					{
						settings = {};

						if(options.operation == 'edit')
						{
							settings.title = viewModel.title();
							settings.col_width = viewModel.col_width();
							settings.row_height = viewModel.row_height();
						}

						types = {
							settings: {
								settings: [
									{
										name        : "title",
										display_name: "Title",
										type        : "text"
									},
									{
										name : "col_width",
										display_name : "Columns",
										type : "integer",
                                        default_value : 2,
										required : true
									},
									{
										name : "row_height",
										display_name : "Rows",
										type : "integer",
										description : "Leave blank to keep automatic pane height."
									}
								]
							}
						}
					}

					if(options.type == 'widget' && options.operation == 'edit' && isIntegratedPlotEditorType(instanceType))
					{
						freeboard.openIntegratedPlotEditor(viewModel, instanceType);
						return;
					}

					var integratedEditorTypes = ['time_plot_uplot', 'xy_plot_uplot', 'fast_frame_plot', 'fft_spectrum_plot',
						'vertical_gauge', 'horizontal_gauge', 'radial_arc_gauge', 'radial_needle_gauge', 'donut_gauge',
						'fast_frame_control'];
					pluginEditor.createPluginEditor(title, types, instanceType, settings, function(newSettings)
					{
						if(options.operation == 'add')
						{
							if(options.type == 'datasource')
							{
								var newViewModel = new DatasourceModel(theFreeboardModel, datasourcePlugins);
								theFreeboardModel.addDatasource(newViewModel);

								newViewModel.name(newSettings.settings.name);
								delete newSettings.settings.name;

								newViewModel.settings(newSettings.settings);
								newViewModel.type(newSettings.type);
							}
							else if(options.type == 'widget')
							{
								var newViewModel = new WidgetModel(theFreeboardModel, widgetPlugins);
								newSettings.settings = ensureUniqueWidgetTitle(newSettings.type, newSettings.settings, null);
								newViewModel.settings(newSettings.settings);
								newViewModel.type(newSettings.type);

								viewModel.widgets.push(newViewModel);

								freeboardUI.attachWidgetEditIcons(element);

								if(isIntegratedPlotEditorType(newSettings.type))
								{
									freeboard.openIntegratedPlotEditor(newViewModel, newSettings.type);
								}
							}
						}
						else if(options.operation == 'edit')
						{
							if(options.type == 'pane')
							{
								viewModel.title(newSettings.settings.title);
								viewModel.col_width(newSettings.settings.col_width);
								var paneRows = Number(newSettings.settings.row_height);
								viewModel.row_height(_.isFinite(paneRows) && paneRows > 0 ? Math.floor(paneRows) : null);
								freeboardUI.processResize(false);
							}
							else
							{
								if(options.type == 'datasource')
								{
									viewModel.name(newSettings.settings.name);
									delete newSettings.settings.name;
								}
								else if(options.type == 'widget')
								{
									newSettings.settings = ensureUniqueWidgetTitle(newSettings.type, newSettings.settings, viewModel);
								}

								viewModel.type(newSettings.type);
								viewModel.settings(newSettings.settings);
							}
						}
					}, options.type == 'widget', options.type == 'widget' ? integratedEditorTypes : null);
				}
			});
		}
	}

	ko.virtualElements.allowedBindings.datasourceTypeSettings = true;
	ko.bindingHandlers.datasourceTypeSettings = {
		update: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			processPluginSettings(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext);
		}
	}

	ko.bindingHandlers.pane = {
		init  : function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			if(theFreeboardModel.isEditing())
			{
				$(element).css({cursor: "pointer"});
			}

			freeboardUI.addPane(element, viewModel, bindingContext.$root.isEditing());
		},
		update: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			// If pane has been removed
			if(theFreeboardModel.panes.indexOf(viewModel) == -1)
			{
				freeboardUI.removePane(element);
			}
			freeboardUI.updatePane(element, viewModel);
		}
	}

	ko.bindingHandlers.widget = {
		init  : function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			if(theFreeboardModel.isEditing())
			{
				freeboardUI.attachWidgetEditIcons($(element).parent());
			}
		},
		update: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			if(viewModel.shouldRender())
			{
				$(element).empty();
				viewModel.render(element);
			}
		}
	}

	function openIntegratedPlotEditor(widgetModel, type)
	{
		if(window.ModularIntegratedPlotEditor && _.isFunction(window.ModularIntegratedPlotEditor.open))
		{
			var handled = window.ModularIntegratedPlotEditor.open(widgetModel, type, plotEditorShared);
			if(handled !== false)
			{
				return;
			}
		}
		var currentSettings = widgetModel.settings();
		var shared = plotEditorShared;
		var form = $('<div class="row g-3"></div>');

		var createInput = function(label, key, inputType, parent) {
			var row = $('<div class="input-group input-group-sm mb-1"></div>');
			var lbl = $('<span class="input-group-text">' + label + '</span>');
			var inp = $('<input type="' + inputType + '" class="form-control form-control-sm">');
			inp.val(currentSettings[key] || '');
			row.append(lbl).append(inp);
			parent.append(row);
			return inp;
		};

		var left = $('<div class="col-md-6"></div>');
		var right = $('<div class="col-md-6"></div>');
		form.append(left, right);

		var titleInput = createInput("Title", "title", "text", left);
		var historyInput = createInput("History Length", "historyLength", "number", left);
		var refreshInput = createInput("Refresh Rate (ms)", "refreshRate", "number", left);
		var xLabelInput = createInput("X Label", "xLabel", "text", left);
		var yLabelInput = createInput("Y Label", "yLabel", "text", left);
		var xMinInput = createInput("X Min", "xMin", "number", left);
		var xMaxInput = createInput("X Max", "xMax", "number", left);
		var yMinInput = createInput("Y Min", "yMin", "number", left);
		var yMaxInput = createInput("Y Max", "yMax", "number", left);

		var channelHeader = $('<div class="d-flex align-items-center justify-content-between mb-2"></div>');
		channelHeader.append('<div class="fw-semibold">Channel manager</div>');
		var addChannelButton = $('<button class="btn btn-sm btn-outline-primary">Add channel</button>');
		channelHeader.append(addChannelButton);
		var channelList = $('<div class="d-flex flex-column gap-2"></div>');
		right.append(channelHeader, channelList);

		var seriesDefs = shared.parseSeriesDefs(currentSettings.seriesDefs);

		var createChannelRow = function(def, index) {
			var row = $('<div class="border rounded p-2"></div>');
			var labelRow = $('<div class="input-group input-group-sm mb-1"></div>');
			var labelText = $('<span class="input-group-text">Label</span>');
			var labelInput = $('<input type="text" class="form-control form-control-sm">').val(def.label || '');
			labelRow.append(labelText, labelInput);

			var opRow = $('<div class="input-group input-group-sm mb-1"></div>');
			var opLabel = $('<span class="input-group-text">Operation</span>');
			var opSelect = $('<select class="form-select form-select-sm"></select>')
				.append('<option value="identity">x</option>')
				.append('<option value="negate">-x</option>')
				.append('<option value="abs">abs(x)</option>')
				.append('<option value="scale">x * k</option>')
				.append('<option value="offset">x + b</option>')
				.append('<option value="mulvar">x * y</option>');
			opSelect.val(def.op || "identity");
			var paramInput = $('<input type="number" step="any" class="form-control form-control-sm" placeholder="k or b">').val(def.param || 0);
			opRow.append(opLabel, opSelect, paramInput);

			var sourceARow = $('<div class="input-group input-group-sm mb-1"></div>');
			var sourceALabel = $('<span class="input-group-text">Source X</span>');
			var sourceASelect = $('<select class="form-select form-select-sm"></select>');
			var sourceADevice = $('<select class="form-select form-select-sm" style="max-width: 160px; display:none;"></select>');
			var sourceAVar = $('<select class="form-select form-select-sm" style="max-width: 220px;"></select>');
			sourceARow.append(sourceALabel, sourceASelect, sourceADevice, sourceAVar);

			var sourceBRow = $('<div class="input-group input-group-sm mb-1"></div>');
			var sourceBLabel = $('<span class="input-group-text">Source Y</span>');
			var sourceBSelect = $('<select class="form-select form-select-sm"></select>');
			var sourceBDevice = $('<select class="form-select form-select-sm" style="max-width: 160px; display:none;"></select>');
			var sourceBVar = $('<select class="form-select form-select-sm" style="max-width: 220px;"></select>');
			sourceBRow.append(sourceBLabel, sourceBSelect, sourceBDevice, sourceBVar);

			var removeBtn = $('<button class="btn btn-sm btn-outline-danger w-100">Remove channel</button>');
			removeBtn.on("click", function() {
				seriesDefs.splice(index, 1);
				renderChannelList();
			});

			var refreshDatasourceSelect = function(selectEl, selected) {
				selectEl.empty();
				selectEl.append('<option value="">Select datasource</option>');
				shared.listDatasources().forEach(function(ds) {
					selectEl.append($('<option>').val(ds.name).text(ds.name));
				});
				if(selected && selectEl.find('option[value="' + selected + '"]').length)
				{
					selectEl.val(selected);
				}
			};

			var populateVariables = async function(dsName, deviceVal, varEl, selectedVar) {
					varEl.empty();
					if(!dsName)
					{
						varEl.append('<option value="">No datasource</option>');
						return;
					}
					var dsType = shared.getDatasourceType(dsName);
					if(dsType === "signal_generator_datasource")
					{
						varEl.append('<option value="0">Signal</option>');
						if(selectedVar !== undefined && selectedVar !== null) varEl.val(selectedVar);
						return;
					}
					if(dsType === "fast_frame_datasource" || dsType === "serialport_datasource")
					{
						var headers = await shared.fetchDatasourceHeaders(dsName);
						var count = Array.isArray(headers) ? headers.length : 0;
						if(!count)
						{
							count = await shared.fetchDatasourceChannelCount(dsName, dsType);
						}
					if(!count)
					{
						count = 4;
					}
					for(var i = 0; i < count; i++)
					{
						var label = headers[i] || "Channel " + (i + 1);
						varEl.append($('<option>').val(i.toString()).text(label));
					}
				}
				else if(dsType === "can_datasource")
				{
					for(var j = 0; j < 4; j++)
					{
						varEl.append($('<option>').val("var" + j).text("Variable " + j));
					}
				}
				else
				{
					varEl.append('<option value="">Unknown datasource type</option>');
				}
				if(selectedVar !== undefined && selectedVar !== null && varEl.find('option[value="' + selectedVar + '"]').length)
				{
					varEl.val(selectedVar);
				}
			};

			var refreshDeviceSelect = function(dsName, deviceEl, selectedDevice) {
				var dsType = shared.getDatasourceType(dsName);
				deviceEl.empty();
				if(dsType === "can_datasource")
				{
					deviceEl.append('<option value="">Select device</option>');
					if(selectedDevice)
					{
						deviceEl.append($('<option>').val(selectedDevice).text(selectedDevice));
						deviceEl.val(selectedDevice);
					}
					deviceEl.show();
				}
				else
				{
					deviceEl.hide();
				}
			};

			opSelect.on("change", function() {
				sourceBRow.toggle(opSelect.val() === "mulvar");
				paramInput.toggle(opSelect.val() === "scale" || opSelect.val() === "offset");
			});

			sourceASelect.on("change", function() {
				refreshDeviceSelect(sourceASelect.val(), sourceADevice, def.a && def.a.device);
				populateVariables(sourceASelect.val(), sourceADevice.val(), sourceAVar, def.a && def.a.var).catch(function() {});
			});
			sourceADevice.on("change", function() {
				populateVariables(sourceASelect.val(), sourceADevice.val(), sourceAVar, sourceAVar.val()).catch(function() {});
			});
			sourceBSelect.on("change", function() {
				refreshDeviceSelect(sourceBSelect.val(), sourceBDevice, def.b && def.b.device);
				populateVariables(sourceBSelect.val(), sourceBDevice.val(), sourceBVar, def.b && def.b.var).catch(function() {});
			});
			sourceBDevice.on("change", function() {
				populateVariables(sourceBSelect.val(), sourceBDevice.val(), sourceBVar, sourceBVar.val()).catch(function() {});
			});

			refreshDatasourceSelect(sourceASelect, def.a && def.a.ds);
			refreshDatasourceSelect(sourceBSelect, def.b && def.b.ds);
			refreshDeviceSelect(sourceASelect.val(), sourceADevice, def.a && def.a.device);
			refreshDeviceSelect(sourceBSelect.val(), sourceBDevice, def.b && def.b.device);
			populateVariables(sourceASelect.val(), sourceADevice.val(), sourceAVar, def.a && def.a.var).catch(function() {});
			populateVariables(sourceBSelect.val(), sourceBDevice.val(), sourceBVar, def.b && def.b.var).catch(function() {});
			sourceBRow.toggle(opSelect.val() === "mulvar");
			paramInput.toggle(opSelect.val() === "scale" || opSelect.val() === "offset");

			row.append(labelRow, opRow, sourceARow, sourceBRow, removeBtn);
			return { row: row };
		};

		var renderChannelList = function() {
			channelList.empty();
			seriesDefs.forEach(function(def, idx) {
				var item = createChannelRow(def, idx);
				channelList.append(item.row);
			});
		};

		addChannelButton.on("click", function() {
			seriesDefs.push({ label: "", op: "identity", param: 0, a: { ds: "", type: "", device: null, var: null }, b: null });
			renderChannelList();
		});

		renderChannelList();

			new DialogBox(form, "Edit " + type, "Save", "Cancel", function() {
			var newDefs = [];
			channelList.children().each(function(index) {
				var rowEl = $(this);
				var label = rowEl.find('input[type="text"]').first().val();
				var op = rowEl.find("select").first().val();
				var param = parseFloat(rowEl.find('input[type="number"]').first().val()) || 0;
				var selects = rowEl.find("select");
				var aDs = selects.eq(1).val();
				var aDevice = selects.eq(2).val();
				var aVar = selects.eq(3).val();
				var bDs = selects.eq(4).val();
				var bDevice = selects.eq(5).val();
				var bVar = selects.eq(6).val();
				var def = {
					label: label || "",
					op: op,
					param: param,
					a: { ds: aDs, type: shared.getDatasourceType(aDs), device: aDevice || null, var: aVar }
				};
				if(op === "mulvar")
				{
					def.b = { ds: bDs, type: shared.getDatasourceType(bDs), device: bDevice || null, var: bVar };
				}
				else
				{
					def.b = null;
				}
				newDefs.push(def);
			});

				var newSettings = {
					title: titleInput.val(),
					historyLength: parseInt(historyInput.val(), 10) || 200,
					refreshRate: parseInt(refreshInput.val(), 10) || 1000,
					xLabel: xLabelInput.val(),
					yLabel: yLabelInput.val(),
					xMin: shared.parseNumber(xMinInput.val()),
					xMax: shared.parseNumber(xMaxInput.val()),
					yMin: shared.parseNumber(yMinInput.val()),
					yMax: shared.parseNumber(yMaxInput.val()),
					seriesDefs: newDefs
				};
			shared.commitWidgetSettings(widgetModel, newSettings);
		});
	}

	function getParameterByName(name)
	{
		name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
		var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"), results = regex.exec(location.search);
		return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
	}

	$(function()
	{ //DOM Ready
		// Show the loading indicator when we first load
		freeboardUI.showLoadingIndicator(true);

        var resizeTimer;

        function resizeEnd()
        {
            freeboardUI.processResize(true);
        }

        $(window).resize(function() {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(resizeEnd, 500);
        });

		$(document).on('keydown.freeboard-undo', function(e)
		{
			var activeElement = document.activeElement;
			var tag = activeElement && activeElement.tagName;
			if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
			if(activeElement && activeElement.isContentEditable) return;
			if((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key || '').toLowerCase() === 'z')
			{
				if(theFreeboardModel.isEditing())
				{
					e.preventDefault();
					freeboardUI.undoLastDrag();
				}
			}
		});

	});

	// PUBLIC FUNCTIONS
	return {
		initialize          : function(allowEdit, finishedCallback)
		{
			ko.applyBindings(theFreeboardModel);

			// Check to see if we have a query param called load. If so, we should load that dashboard initially
			var freeboardLocation = getParameterByName("load");

			if(freeboardLocation != "")
			{
				$.ajax({
					url    : freeboardLocation,
					success: function(data)
					{
						theFreeboardModel.loadDashboard(data);

						if(_.isFunction(finishedCallback))
						{
							finishedCallback();
						}
					}
				});
			}
			else
			{
				theFreeboardModel.allow_edit(allowEdit);
				theFreeboardModel.setEditing(allowEdit);

				freeboardUI.showLoadingIndicator(false);
				if(_.isFunction(finishedCallback))
				{
					finishedCallback();
				}

                freeboard.emit("initialized");
			}
		},
		newDashboard        : function()
		{
			theFreeboardModel.loadDashboard({allow_edit: true});
		},
		loadDashboard       : function(configuration, callback)
		{
			theFreeboardModel.loadDashboard(configuration, callback);
		},
		getCurrentConfig	: function()
		{
			return theFreeboardModel.getCurrentConfig();
		},
		getLiveModel: function() {
			return theFreeboardModel;
		},
		serialize           : function()
		{
			return theFreeboardModel.serialize();
		},
		setEditing          : function(editing, animate)
		{
			theFreeboardModel.setEditing(editing, animate);
		},
		isEditing           : function()
		{
			return theFreeboardModel.isEditing();
		},
		loadDatasourcePlugin: function(plugin)
		{
			if(_.isUndefined(plugin.display_name))
			{
				plugin.display_name = plugin.type_name;
			}

            // Add a required setting called name to the beginning
            plugin.settings.unshift({
                name : "name",
                display_name : "Name",
                type : "text",
                required : true
            });


			theFreeboardModel.addPluginSource(plugin.source);
			datasourcePlugins[plugin.type_name] = plugin;
			theFreeboardModel._datasourceTypes.valueHasMutated();
		},
        resize : function()
        {
            freeboardUI.processResize(true);
        },
		loadWidgetPlugin    : function(plugin)
		{
			if(_.isUndefined(plugin.display_name))
			{
				plugin.display_name = plugin.type_name;
			}

			theFreeboardModel.addPluginSource(plugin.source);
			widgetPlugins[plugin.type_name] = plugin;
			theFreeboardModel._widgetTypes.valueHasMutated();
		},
		// To be used if freeboard is going to load dynamic assets from a different root URL
		setAssetRoot        : function(assetRoot)
		{
			jsEditor.setAssetRoot(assetRoot);
		},
		addStyle            : function(selector, rules)
		{
			var styleString = selector + "{" + rules + "}";

			var styleElement = $("style#fb-styles");

			if(styleElement.length == 0)
			{
				styleElement = $('<style id="fb-styles" type="text/css"></style>');
				$("head").append(styleElement);
			}

			if(styleElement[0].styleSheet)
			{
				styleElement[0].styleSheet.cssText += styleString;
			}
			else
			{
				styleElement.text(styleElement.text() + styleString);
			}
		},
		showLoadingIndicator: function(show)
		{
			freeboardUI.showLoadingIndicator(show);
		},
		showDialog          : function(contentElement, title, okTitle, cancelTitle, okCallback)
		{
			new DialogBox(contentElement, title, okTitle, cancelTitle, okCallback);
		},
        getDatasourceSettings : function(datasourceName)
        {
            var datasources = theFreeboardModel.datasources();

            // Find the datasource with the name specified
            var datasource = _.find(datasources, function(datasourceModel){
                return (datasourceModel.name() === datasourceName);
            });

            if(datasource)
            {
                return datasource.settings();
            }
            else
            {
                return null;
            }
        },
        setDatasourceSettings : function(datasourceName, settings)
        {
            var datasources = theFreeboardModel.datasources();

            // Find the datasource with the name specified
            var datasource = _.find(datasources, function(datasourceModel){
                return (datasourceModel.name() === datasourceName);
            });

            if(!datasource)
            {
                console.log("Datasource not found");
                return;
            }

            var combinedSettings = _.defaults(settings, datasource.settings());
            datasource.settings(combinedSettings);
        },
		getStyleString      : function(name)
		{
			var returnString = "";

			_.each(currentStyle[name], function(value, name)
			{
				returnString = returnString + name + ":" + value + ";";
			});

			return returnString;
		},
		getStyleObject      : function(name)
		{
			return currentStyle[name];
		},
		showDeveloperConsole : function()
		{
			developerConsole.showDeveloperConsole();
		},
		getPlotEditorShared: function()
		{
			return plotEditorShared;
		},
		openIntegratedPlotEditor: function(widgetModel, type)
		{
			openIntegratedPlotEditor(widgetModel, type);
		}
	};
}());

$.extend(freeboard, jQuery.eventEmitter);
