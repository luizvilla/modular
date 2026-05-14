PluginEditor = function(jsEditor, valueEditor)
{
	function _displayValidationError(settingName, errorMessage)
	{
		var errorElement = $('<div class="validation-error"></div>').html(errorMessage);
		$("#setting-value-container-" + settingName).append(errorElement);
	}

	function _removeSettingsRows()
	{
		if($("#setting-row-instance-name").length)
		{
			$("#setting-row-instance-name").nextAll().remove();
		}
		else
		{
			$("#setting-row-plugin-types").nextAll().remove();
		}
	}

	function _isNumerical(n)
	{
		return !isNaN(parseFloat(n)) && isFinite(n);
	}

	function _getWidgetCategoryConfig()
	{
		if(typeof freeboard !== "undefined" && _.isFunction(freeboard.getWidgetCategoryConfig))
		{
			return freeboard.getWidgetCategoryConfig();
		}
		return {
			categories: ["OwnTech", "Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Other"],
			widgetCategories: {}
		};
	}

	function _inferWidgetCategory(typeName, pluginType)
	{
		var name = (typeName || "").toLowerCase();
		var display = (pluginType && pluginType.display_name ? pluginType.display_name : "").toLowerCase();

		if(/^owntech_|^twist_/.test(name) || display.indexOf("owntech") > -1 || display.indexOf("twist") === 0)
		{
			return "OwnTech";
		}
		if(name.indexOf("fast_frame") === 0 || display.indexOf("fast frame") > -1)
		{
			return "Fast Frame";
		}
		if(name.indexOf("serial") === 0 || name.indexOf("_serial") > -1 || display.indexOf("serial") > -1)
		{
			return "Serial";
		}
		if(name.indexOf("thingset") === 0 || name.indexOf("ts_") === 0 || display.indexOf("thingset") > -1)
		{
			return "ThingSet";
		}
		if(name.indexOf("uplot") === 0 || name.indexOf("plot") > -1 || name.indexOf("power_bars") > -1 || display.indexOf("plot") > -1)
		{
			return "Plots";
		}
		if(name.indexOf("control") > -1 || name.indexOf("mode") > -1 || display.indexOf("control") > -1)
		{
			return "Controls";
		}

		return "Other";
	}

	function _openWidgetDocs(typeName)
	{
		// Widget documentation opens in the main docs tab UI.
		if(!typeName) return;
		try
		{
			if(window.api && window.api.widgets && window.api.widgets.openDocTab)
			{
				window.api.widgets.openDocTab(typeName);
				return;
			}
		}
		catch(err) {}

		try
		{
			var ipc = (window.require && window.require('electron')) ? window.require('electron').ipcRenderer : null;
			if(ipc) ipc.send('open-widget-doc-tab', { type: typeName });
		}
		catch(err) {}
	}

	function _getWidgetCategoryForType(typeName, pluginType, config)
	{
		if(pluginType && pluginType.category)
		{
			return pluginType.category;
		}
		var categoryConfig = config || _getWidgetCategoryConfig();
		var mapped = categoryConfig.widgetCategories && categoryConfig.widgetCategories[typeName];
		if(mapped)
		{
			return mapped;
		}
		return _inferWidgetCategory(typeName, pluginType);
	}

	function _getWidgetTitleSetting(pluginType)
	{
		if(!pluginType || !_.isArray(pluginType.settings))
		{
			return undefined;
		}

		return _.find(pluginType.settings, function(settingDef)
		{
			return settingDef.name === "title";
		});
	}

	function _getDefaultWidgetTitle(typeName, pluginTypes)
	{
		var pluginType = pluginTypes && pluginTypes[typeName];
		var titleSetting = _getWidgetTitleSetting(pluginType);
		if(titleSetting && !_.isUndefined(titleSetting.default_value) && titleSetting.default_value !== "")
		{
			return String(titleSetting.default_value);
		}
		if(pluginType && pluginType.display_name)
		{
			return String(pluginType.display_name);
		}
		return String(typeName || "Widget");
	}

	function _getExistingWidgetTitles()
	{
		var titles = [];
		try
		{
			var model = freeboard.getLiveModel && freeboard.getLiveModel();
			if(!model || !_.isFunction(model.panes))
			{
				return titles;
			}

			_.each(model.panes(), function(pane)
			{
				_.each(pane.widgets(), function(widget)
				{
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
		}
		catch(err) {}

		return titles;
	}

	function _buildUniqueWidgetTitle(baseTitle, ignoreTitle)
	{
		var base = String(baseTitle || "Widget").trim() || "Widget";
		var ignore = String(ignoreTitle || "").trim();
		var titles = _getExistingWidgetTitles();
		if(ignore)
		{
			var ignored = false;
			titles = _.filter(titles, function(title)
			{
				if(!ignored && title === ignore)
				{
					ignored = true;
					return false;
				}
				return true;
			});
		}

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

	function _appendCalculatedSettingRow(valueCell, newSettings, settingDef, currentValue, includeRemove)
	{
		var input = $('<textarea></textarea>');

		if(settingDef.multi_input) {
			input.change(function() {
				var arrayInput = [];
				$(valueCell).find('textarea').each(function() {
					var thisVal = $(this).val();
					if(thisVal) {
						arrayInput = arrayInput.concat(thisVal);
					}
				});
				newSettings.settings[settingDef.name] = arrayInput;
			});
		} else {
			input.change(function() {
				newSettings.settings[settingDef.name] = $(this).val();
			});
		}

		if(currentValue) {
			input.val(currentValue);
		}

		valueEditor.createValueEditor(input);

		var datasourceToolbox = $('<ul class="board-toolbar datasource-input-suffix"></ul>');
		var wrapperDiv = $('<div class="calculated-setting-row"></div>');
		wrapperDiv.append(input).append(datasourceToolbox);

		var datasourceTool = $('<li><i class="icon-plus icon-white"></i><label>DATASOURCE</label></li>')
			.mousedown(function(e) {
				e.preventDefault();
				$(input).val("").focus().insertAtCaret("datasources[\"").trigger("freeboard-eval");
			});
		datasourceToolbox.append(datasourceTool);

		var jsEditorTool = $('<li><i class="icon-fullscreen icon-white"></i><label>.JS EDITOR</label></li>')
			.mousedown(function(e) {
				e.preventDefault();
				jsEditor.displayJSEditor(input.val(), function(result) {
					input.val(result);
					input.change();
				});
			});
		datasourceToolbox.append(jsEditorTool);

		if(includeRemove) {
			var removeButton = $('<li class="remove-setting-row"><i class="icon-minus icon-white"></i><label></label></li>')
				.mousedown(function(e) {
					e.preventDefault();
					wrapperDiv.remove();
					$(valueCell).find('textarea:first').change();
				});
			datasourceToolbox.prepend(removeButton);
		}

		$(valueCell).append(wrapperDiv);
	}

	function createPluginEditor(title, pluginTypes, currentTypeName, currentSettingsValues, settingsSavedCallback, isWidgetType)
	{
		currentSettingsValues = _.clone(currentSettingsValues || {});

		var newSettings = {
			type    : currentTypeName,
			settings: {}
		};

		function debugTitleState(context, extra)
		{
			try
			{
				var titleInput = $("#setting-value-container-title").find("input[type='text']").first();
				var payload = _.extend({
					currentTypeName: currentTypeName,
					selectedType: selectedType ? selectedType.type_name : undefined,
					currentSettingsTitle: currentSettingsValues ? currentSettingsValues.title : undefined,
					pendingSettingsTitle: newSettings && newSettings.settings ? newSettings.settings.title : undefined,
					inputValue: titleInput.length ? titleInput.val() : undefined
				}, extra || {});
				if(!window.__pluginEditorTitleTrace)
				{
					window.__pluginEditorTitleTrace = [];
				}
				window.__pluginEditorTitleTrace.push({
					timestamp: new Date().toISOString(),
					context: context,
					payload: payload
				});
				if(titleDebugPanel && titleDebugPanel.length)
				{
					titleDebugPanel.show();
					titleDebugPanel.prepend($('<div></div>').text("[" + context + "] " + JSON.stringify(payload)));
				}
				console.log("[PluginEditor:title]", context, payload);
			}
			catch(err) {}
		}

		function setWidgetTitleValue(titleValue)
		{
			var normalizedTitle = String(titleValue || "").trim();
			debugTitleState("before-auto-title-set", {
				nextTitle: normalizedTitle
			});
			currentSettingsValues = _.clone(currentSettingsValues || {});
			currentSettingsValues.title = normalizedTitle;
			newSettings.settings.title = normalizedTitle;

			var titleInput = $("#setting-value-container-title").find("input[type='text']").first();
			if(titleInput.length)
			{
				titleInput.val(normalizedTitle).trigger("change");
			}
			debugTitleState("after-auto-title-set", {
				appliedTitle: normalizedTitle
			});
		}

		function createSettingRow(name, displayName)
		{
			var tr = $('<div id="setting-row-' + name + '" class="form-row"></div>').appendTo(form);

			tr.append('<div class="form-label"><label class="control-label">' + displayName + '</label></div>');
			return $('<div id="setting-value-container-' + name + '" class="form-value"></div>').appendTo(tr);
		}

		var selectedType;
		var inPickerStep = false;
		var advanceToSettings;
		var datasourcePicker;
		var form = $('<div></div>');
		var titleDebugPanel = $('<div id="plugin-editor-title-debug" style="display:none; margin:8px 0; padding:8px; border:1px solid #555; background:#111; color:#ddd; font:12px/1.4 monospace; white-space:pre-wrap; max-height:180px; overflow:auto;"></div>');

		var pluginDescriptionElement = $('<div id="plugin-description"></div>').hide();
		form.append(pluginDescriptionElement);
		form.append(titleDebugPanel);
		// Widget docs button shows alongside the widget type picker.
		var docsButton = $('<button type="button" class="btn btn-sm btn-outline-light widget-docs-btn">Open widget docs</button>').hide();
		form.append(docsButton);

		function createSettingsFromDefinition(settingsDefs, typeaheadSource, typeaheadDataSegment)
		{
			_.each(settingsDefs, function(settingDef)
			{
				// Set a default value if one doesn't exist
				if(!_.isUndefined(settingDef.default_value) && _.isUndefined(currentSettingsValues[settingDef.name]))
				{
					currentSettingsValues[settingDef.name] = settingDef.default_value;
				}

				var displayName = settingDef.name;

				if(!_.isUndefined(settingDef.display_name))
				{
					displayName = settingDef.display_name;
				}

				var valueCell = createSettingRow(settingDef.name, displayName);

				switch (settingDef.type)
				{
					case "array":
					{
						var subTableDiv = $('<div class="form-table-value-subtable"></div>').appendTo(valueCell);

						var subTable = $('<table class="table table-condensed sub-table"></table>').appendTo(subTableDiv);
						var subTableHead = $("<thead></thead>").hide().appendTo(subTable);
						var subTableHeadRow = $("<tr></tr>").appendTo(subTableHead);
						var subTableBody = $('<tbody></tbody>').appendTo(subTable);

						var currentSubSettingValues = [];

						// Create our headers
						_.each(settingDef.settings, function(subSettingDef)
						{
							var subsettingDisplayName = subSettingDef.name;

							if(!_.isUndefined(subSettingDef.display_name))
							{
								subsettingDisplayName = subSettingDef.display_name;
							}

							$('<th>' + subsettingDisplayName + '</th>').appendTo(subTableHeadRow);
						});

						if(settingDef.name in currentSettingsValues)
						{
							currentSubSettingValues = currentSettingsValues[settingDef.name];
						}

						function processHeaderVisibility()
						{
							if(newSettings.settings[settingDef.name].length > 0)
							{
								subTableHead.show();
							}
							else
							{
								subTableHead.hide();
							}
						}

						function createSubsettingRow(subsettingValue)
						{
							var subsettingRow = $('<tr></tr>').appendTo(subTableBody);

							var newSetting = {};

							if(!_.isArray(newSettings.settings[settingDef.name]))
							{
								newSettings.settings[settingDef.name] = [];
							}

							newSettings.settings[settingDef.name].push(newSetting);

							_.each(settingDef.settings, function(subSettingDef)
							{
								var subsettingCol = $('<td></td>').appendTo(subsettingRow);
								var subsettingValueString = "";

								if(!_.isUndefined(subsettingValue[subSettingDef.name]))
								{
									subsettingValueString = subsettingValue[subSettingDef.name];
								}

								newSetting[subSettingDef.name] = subsettingValueString;

								$('<input class="table-row-value" type="text">').appendTo(subsettingCol).val(subsettingValueString).change(function()
								{
									newSetting[subSettingDef.name] = $(this).val();
								});
							});

							subsettingRow.append($('<td class="table-row-operation"></td>').append($('<ul class="board-toolbar"></ul>').append($('<li></li>').append($('<i class="icon-trash icon-white"></i>').click(function()
							{
								var subSettingIndex = newSettings.settings[settingDef.name].indexOf(newSetting);

								if(subSettingIndex != -1)
								{
									newSettings.settings[settingDef.name].splice(subSettingIndex, 1);
									subsettingRow.remove();
									processHeaderVisibility();
								}
							})))));

							subTableDiv.scrollTop(subTableDiv[0].scrollHeight);

							processHeaderVisibility();
						}

						$('<div class="table-operation text-button">ADD</div>').appendTo(valueCell).click(function()
						{
							var newSubsettingValue = {};

							_.each(settingDef.settings, function(subSettingDef)
							{
								newSubsettingValue[subSettingDef.name] = "";
							});

							createSubsettingRow(newSubsettingValue);
						});

						// Create our rows
						_.each(currentSubSettingValues, function(currentSubSettingValue, subSettingIndex)
						{
							createSubsettingRow(currentSubSettingValue);
						});

						break;
					}
					case "boolean":
					{
						newSettings.settings[settingDef.name] = currentSettingsValues[settingDef.name];

						var onOffSwitch = $('<div class="onoffswitch"><label class="onoffswitch-label" for="' + settingDef.name + '-onoff"><div class="onoffswitch-inner"><span class="on">YES</span><span class="off">NO</span></div><div class="onoffswitch-switch"></div></label></div>').appendTo(valueCell);

						var input = $('<input type="checkbox" name="onoffswitch" class="onoffswitch-checkbox" id="' + settingDef.name + '-onoff">').prependTo(onOffSwitch).change(function()
						{
							newSettings.settings[settingDef.name] = this.checked;
						});

						if(settingDef.name in currentSettingsValues)
						{
							input.prop("checked", currentSettingsValues[settingDef.name]);
						}

						break;
					}
					case "option":
					{
						var defaultValue = currentSettingsValues[settingDef.name];

						var input = $('<select></select>').appendTo($('<div class="styled-select"></div>').appendTo(valueCell)).change(function()
						{
							newSettings.settings[settingDef.name] = $(this).val();
						});

						_.each(settingDef.options, function(option)
						{

							var optionName;
							var optionValue;

							if(_.isObject(option))
							{
								optionName = option.name;
								optionValue = option.value;
							}
							else
							{
								optionName = option;
							}

							if(_.isUndefined(optionValue))
							{
								optionValue = optionName;
							}

							if(_.isUndefined(defaultValue))
							{
								defaultValue = optionValue;
							}

							$("<option></option>").text(optionName).attr("value", optionValue).appendTo(input);
						});

						newSettings.settings[settingDef.name] = defaultValue;

						if(settingDef.name in currentSettingsValues)
						{
							input.val(currentSettingsValues[settingDef.name]);
						}

						break;
					}
					default:
					{
						newSettings.settings[settingDef.name] = currentSettingsValues[settingDef.name];

						if(settingDef.type == "calculated")
						{
							if(settingDef.name in currentSettingsValues) {
								var currentValue = currentSettingsValues[settingDef.name];
								if(settingDef.multi_input && _.isArray(currentValue)) {
									var includeRemove = false;
									for(var i=0; i<currentValue.length; i++) {
										_appendCalculatedSettingRow(valueCell, newSettings, settingDef, currentValue[i], includeRemove);
										includeRemove = true;
									}
								} else {
									_appendCalculatedSettingRow(valueCell, newSettings, settingDef, currentValue, false);
								}
							} else {
								_appendCalculatedSettingRow(valueCell, newSettings, settingDef, null, false);
							}

							if(settingDef.multi_input) {
								var inputAdder = $('<ul class="board-toolbar"><li class="add-setting-row"><i class="icon-plus icon-white"></i><label>ADD</label></li></ul>')
									.mousedown(function(e) {
										e.preventDefault();
										_appendCalculatedSettingRow(valueCell, newSettings, settingDef, null, true);
									});
								$(valueCell).siblings('.form-label').append(inputAdder);
							}
						}
						else
						{
							var input = $('<input type="text">').appendTo(valueCell).change(function()
							{
								var previousValue = newSettings.settings[settingDef.name];
								if(settingDef.type == "number")
								{
									newSettings.settings[settingDef.name] = Number($(this).val());
								}
								else
								{
									newSettings.settings[settingDef.name] = $(this).val();
								}

								if(settingDef.name === "title")
								{
									currentSettingsValues = _.clone(currentSettingsValues || {});
									currentSettingsValues.title = newSettings.settings[settingDef.name];
									debugTitleState("manual-title-change", {
										previousValue: previousValue,
										newValue: newSettings.settings[settingDef.name]
									});
								}
							});

							if(settingDef.name in currentSettingsValues)
							{
								input.val(currentSettingsValues[settingDef.name]);
								if(settingDef.name === "title")
								{
									debugTitleState("title-input-initialized", {
										initialValue: currentSettingsValues[settingDef.name]
									});
								}
							}

							if(typeaheadSource && settingDef.typeahead_data_field){
								input.addClass('typeahead_data_field-' + settingDef.typeahead_data_field);
							}

							if(typeaheadSource && settingDef.typeahead_field){
								var typeaheadValues = [];

								input.keyup(function(event){
									if(event.which >= 65 && event.which <= 91) {
										input.trigger('change');
									}
								});

								$(input).autocomplete({
									source: typeaheadValues,
									select: function(event, ui){
										input.val(ui.item.value);
										input.trigger('change');
									}
								});

								input.change(function(event){
									var value = input.val();
									var source = _.template(typeaheadSource)({input: value});
									$.get(source, function(data){
										if(typeaheadDataSegment){
											data = data[typeaheadDataSegment];
										}
										data  = _.select(data, function(elm){
											return elm[settingDef.typeahead_field][0] == value[0];
										});

										typeaheadValues = _.map(data, function(elm){
											return elm[settingDef.typeahead_field];
										});
										$(input).autocomplete("option", "source", typeaheadValues);

										if(data.length == 1){
											data = data[0];
											//we found the one. let's use it to populate the other info
											for(var field in data){
												if(data.hasOwnProperty(field)){
													var otherInput = $(_.template('input.typeahead_data_field-<%= field %>')({field: field}));
													if(otherInput){
														otherInput.val(data[field]);
														if(otherInput.val() != input.val()) {
															otherInput.trigger('change');
														}
													}
												}
											}
										}
									});
								});
							}
						}

						break;
					}
				}

				if(!_.isUndefined(settingDef.suffix))
				{
					valueCell.append($('<div class="input-suffix">' + settingDef.suffix + '</div>'));
				}

				if(!_.isUndefined(settingDef.description))
				{
					valueCell.append($('<div class="setting-description">' + settingDef.description + '</div>'));
				}
			});
		}


		new DialogBox(form, title, "Save", "Cancel", function()
		{
			if(inPickerStep)
			{
				if(advanceToSettings) advanceToSettings();
				return true;
			}

			$(".validation-error").remove();

			// Loop through each setting and validate it
			for(var index = 0; index < selectedType.settings.length; index++)
			{
				var settingDef = selectedType.settings[index];

				if(settingDef.required && (_.isUndefined(newSettings.settings[settingDef.name]) || newSettings.settings[settingDef.name] == ""))
				{
					_displayValidationError(settingDef.name, "This is required.");
					return true;
				}
				else if(settingDef.type == "integer" && (newSettings.settings[settingDef.name] % 1 !== 0))
				{
					_displayValidationError(settingDef.name, "Must be a whole number.");
					return true;
				}
				else if(settingDef.type == "number" && !_isNumerical(newSettings.settings[settingDef.name]))
				{
					_displayValidationError(settingDef.name, "Must be a number.");
					return true;
				}
			}

			if(_.isFunction(settingsSavedCallback))
			{
				settingsSavedCallback(newSettings);
			}
		});

		// Create our body
		var pluginTypeNames = _.keys(pluginTypes);
		var typeSelect;
		var typeControl;
		var widgetPicker;
		var firstWidgetTypeName;
		var widgetCategoryOrder = ["OwnTech", "Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Other"];

		var widgetCategoryDefaultIcons = {
			"OwnTech": "bolt",
			"Fast Frame": "chart-area",
			"Serial": "terminal",
			"ThingSet": "network-wired",
			"Plots": "chart-line",
			"Controls": "sliders",
			"Other": "puzzle-piece"
		};

		function sortWidgetPlugins(category, list)
		{
			var preferredOrder = {
				"OwnTech": {
					"owntech_plot_uplot": 0,
					"twist_actions_panel": 1,
					"twist_setpoints_panel": 2,
					"twist_calibration_panel": 3
				},
				"Fast Frame": {
					"fast_frame_plot": 0,
					"fast_frame_channel_manager": 1,
					"fast_frame_plot_ui": 2,
					"fast_frame_control": 3
				},
				"Plots": {
					"uplot_series_manager": 0,
					"uplot_config_panel": 1,
					"xy_plot_uplot": 2,
					"xy_plot_source_manager": 3,
					"vertical_gauge": 4,
					"horizontal_gauge": 5,
					"radial_arc_gauge": 6,
					"radial_needle_gauge": 7,
					"donut_gauge": 8,
					"vertical_gauge_manager": 9,
					"vertical_gauge_config_panel": 10
				}
			};

			return list.slice(0).sort(function(a, b)
			{
				var orderMap = preferredOrder[category] || null;
				var rankA = orderMap && !_.isUndefined(orderMap[a.type_name]) ? orderMap[a.type_name] : 999;
				var rankB = orderMap && !_.isUndefined(orderMap[b.type_name]) ? orderMap[b.type_name] : 999;
				if(rankA !== rankB) return rankA - rankB;

				var labelA = (a.display_name || a.type_name || "").toLowerCase();
				var labelB = (b.display_name || b.type_name || "").toLowerCase();
				if(labelA < labelB) return -1;
				if(labelA > labelB) return 1;
				return 0;
			});
		}

		function applyWidgetTypeSelection(nextTypeName, options)
		{
			options = options || {};

			debugTitleState("type-selection-start", {
				nextTypeName: nextTypeName,
				preserveCurrentSettings: !!options.preserveCurrentSettings
			});

			newSettings.type = nextTypeName;
			newSettings.settings = {};

			if(typeSelect && typeSelect.is("select"))
			{
				typeSelect.val(nextTypeName);
			}
			if(widgetPicker)
			{
				widgetPicker.find(".widget-tile").removeClass("selected").attr("aria-pressed", "false");

				var selectedTile = widgetPicker.find('.widget-tile[data-type="' + nextTypeName + '"]');
				if(selectedTile.length)
				{
					selectedTile.addClass("selected").attr("aria-pressed", "true");
				}
			}

			if(isWidgetType && !options.preserveCurrentSettings && !_.isUndefined(pluginTypes[nextTypeName]))
			{
				var computedTitle = _buildUniqueWidgetTitle(
					_getDefaultWidgetTitle(nextTypeName, pluginTypes),
					""
				);
				console.log("[PluginEditor:title] auto-title-computed", {
					nextTypeName: nextTypeName,
					computedTitle: computedTitle
				});
				currentSettingsValues = {};
				setWidgetTitleValue(computedTitle);
			}

			_removeSettingsRows();
			selectedType = pluginTypes[nextTypeName];

			if(_.isUndefined(selectedType))
			{
				$("#setting-row-instance-name").hide();
				$("#dialog-ok").hide();
				pluginDescriptionElement.hide();
				if(typeControl)
				{
					typeControl.removeAttr("title");
				}
			}
			else
			{
				$("#setting-row-instance-name").show();

				if(selectedType.description && selectedType.description.length > 0)
				{
					pluginDescriptionElement.html(selectedType.description).show();
					if(typeControl)
					{
						typeControl.attr("title", selectedType.description);
					}
				}
				else
				{
					pluginDescriptionElement.hide();
					if(typeControl)
					{
						typeControl.removeAttr("title");
					}
				}

				$("#dialog-ok").show();
				createSettingsFromDefinition(selectedType.settings, selectedType.typeahead_source, selectedType.typeahead_data_segment);
			}

			if(isWidgetType)
			{
				docsButton.show();
				docsButton.prop("disabled", _.isUndefined(selectedType));
			}

			debugTitleState("type-selection-finished", {
				nextTypeName: nextTypeName,
				preserveCurrentSettings: !!options.preserveCurrentSettings
			});
		}

		if(pluginTypeNames.length > 1)
		{
			var typeRow = createSettingRow("plugin-types", "Type");

			if(isWidgetType)
			{
				var typeRowContainer = typeRow.closest(".form-row");
				typeRowContainer.addClass("widget-picker-row");
				typeRowContainer.find(".form-label").hide();
				typeRow.css("float", "none");
				var categoryConfig = _getWidgetCategoryConfig();
				var categories = widgetCategoryOrder.slice(0);
				var grouped = {};

					_.each(pluginTypes, function(pluginType)
					{
						if(pluginType.compatibility_only && pluginType.type_name !== currentTypeName)
						{
							return;
						}
						var category = _getWidgetCategoryForType(pluginType.type_name, pluginType, categoryConfig);
						if(!_.contains(categories, category))
						{
						category = "Other";
					}
					if(!grouped[category])
					{
						grouped[category] = [];
					}
					grouped[category].push(pluginType);
				});

				widgetPicker = $('<div class="widget-picker"></div>').appendTo(typeRow);
				typeControl = widgetPicker;

				_.each(categories, function(category)
				{
					var list = grouped[category];
					if(!list || list.length === 0) return;

					var section = $('<div class="widget-picker-section"></div>').appendTo(widgetPicker);
					if(category === "OwnTech")
					{
						section.addClass("owntech");
					}

					$('<div class="widget-picker-section-title"></div>').text(category).appendTo(section);
					var grid = $('<div class="widget-picker-grid"></div>').appendTo(section);
					var orderedList = sortWidgetPlugins(category, list);
					if(_.isUndefined(firstWidgetTypeName) && orderedList.length > 0)
					{
						firstWidgetTypeName = orderedList[0].type_name;
					}

					_.each(orderedList, function(pluginType)
					{
						var iconName = pluginType.icon || widgetCategoryDefaultIcons[category] || widgetCategoryDefaultIcons.Other;
						var tile = $('<div class="widget-tile" tabindex="0" role="button" aria-pressed="false"></div>')
							.attr("data-type", pluginType.type_name)
							.append($('<i class="fa-solid"></i>').addClass("fa-" + iconName))
							.append($('<span></span>').text(pluginType.display_name || pluginType.type_name))
							.appendTo(grid);

						if(pluginType.description && pluginType.description.length > 0)
						{
							tile.attr("title", pluginType.description);
						}

						tile.on("click", function()
						{
							if(!$(this).hasClass("selected"))
							{
								applyWidgetTypeSelection(pluginType.type_name);
							}
						});
						tile.on("keydown", function(event)
						{
							if(event.which === 13 || event.which === 32)
							{
								event.preventDefault();
								if(!$(this).hasClass("selected"))
								{
									applyWidgetTypeSelection(pluginType.type_name);
								}
							}
						});
					});
				});
			}
			else
			{
				var typeRowContainer = typeRow.closest(".form-row");
				typeRowContainer.find(".form-label").hide();
				typeRow.css("float", "none");

				datasourcePicker = $('<div class="datasource-picker"></div>').appendTo(typeRow);
				typeControl = datasourcePicker;

				var datasourceIconMap = {
					fast_frame_datasource    : "bolt",
					serialport_datasource    : "plug",
					thingset_serial_datasource: "terminal",
					can_datasource           : "network-wired",
					signal_generator_datasource: "wave-square"
				};

				var backBtn = $('<button type="button" class="datasource-back-btn" title="Back to type selection"><i class="fa-solid fa-arrow-left"></i></button>')
					.hide()
					.prependTo(form);

				advanceToSettings = function()
				{
					if(!selectedType) return;
					inPickerStep = false;
					typeRowContainer.hide();
					backBtn.show();
					$("#dialog-ok").text("Save");
					$("#modal_overlay section").removeClass("datasource-picker-active");
					$("#modal_overlay header h2").text(title + " — " + selectedType.display_name);
					createSettingsFromDefinition(selectedType.settings, selectedType.typeahead_source, selectedType.typeahead_data_segment);
				};

				backBtn.on("click", function()
				{
					inPickerStep = true;
					backBtn.hide();
					_removeSettingsRows();
					typeRowContainer.show();
					$("#dialog-ok").text("Next").hide();
					$("#modal_overlay section").addClass("datasource-picker-active");
					$("#modal_overlay header h2").text(title);
				});

				_.each(pluginTypes, function(pluginType)
				{
					var iconName = pluginType.icon || datasourceIconMap[pluginType.type_name] || "database";
					var tile = $('<div class="datasource-tile" tabindex="0" role="button" aria-pressed="false"></div>')
						.attr("data-type", pluginType.type_name)
						.append($('<i class="fa-solid fa-' + iconName + '"></i>'))
						.append($('<span></span>').text(pluginType.display_name || pluginType.type_name))
						.appendTo(datasourcePicker);

					if(pluginType.description && pluginType.description.length > 0)
					{
						tile.attr("title", pluginType.description);
					}

					tile.on("click", function()
					{
						selectedType = pluginType;
						newSettings.type = pluginType.type_name;
						advanceToSettings();
					});

					tile.on("keydown", function(e)
					{
						if(e.which === 13 || e.which === 32)
						{
							e.preventDefault();
							$(this).trigger("click");
						}
					});
				});
			}

			if(isWidgetType)
			{
				docsButton.show();
				docsButton.on("click", function()
				{
					_openWidgetDocs(newSettings.type);
				});
			}
		}
		else if(pluginTypeNames.length == 1)
		{
			selectedType = pluginTypes[pluginTypeNames[0]];
			newSettings.type = selectedType.type_name;
			newSettings.settings = {};
			if(isWidgetType && _.isUndefined(currentTypeName))
			{
				setWidgetTitleValue(_buildUniqueWidgetTitle(
					_getDefaultWidgetTitle(selectedType.type_name, pluginTypes),
					currentSettingsValues.title
				));
			}
			createSettingsFromDefinition(selectedType.settings);
			if(isWidgetType)
			{
				docsButton.show();
				docsButton.on("click", function()
				{
					_openWidgetDocs(newSettings.type);
				});
			}
		}

		if(typeSelect)
		{
			if(_.isUndefined(currentTypeName))
			{
				$("#setting-row-instance-name").hide();
				$("#dialog-ok").hide();
			}
			else
			{
				$("#dialog-ok").show();
				typeSelect.val(currentTypeName).trigger("change");
			}
		}
		else if(widgetPicker)
		{
			if(_.isUndefined(currentTypeName))
			{
				if(!_.isUndefined(firstWidgetTypeName))
				{
					applyWidgetTypeSelection(firstWidgetTypeName);
				}
				else
				{
					$("#setting-row-instance-name").hide();
					$("#dialog-ok").hide();
				}
			}
			else
			{
				$("#dialog-ok").show();
				applyWidgetTypeSelection(currentTypeName, { preserveCurrentSettings: true });
			}
		}
		else if(datasourcePicker)
		{
			if(_.isUndefined(currentTypeName))
			{
				inPickerStep = true;
				$("#dialog-ok").hide();
				$("#modal_overlay section").addClass("datasource-picker-active");
			}
			else
			{
				// Editing an existing datasource — skip the picker and show settings directly.
				inPickerStep = false;
				selectedType = pluginTypes[currentTypeName];
				newSettings.type = currentTypeName;
				typeRowContainer.hide();
				createSettingsFromDefinition(selectedType.settings, selectedType.typeahead_source, selectedType.typeahead_data_segment);
				$("#dialog-ok").show();
			}
		}
	}

	// Public API
	return {
		createPluginEditor : function(
			title,
			pluginTypes,
			currentTypeName,
			currentSettingsValues,
			settingsSavedCallback,
			isWidgetType)
		{
			createPluginEditor(title, pluginTypes, currentTypeName, currentSettingsValues, settingsSavedCallback, isWidgetType);
		}
	}
}
