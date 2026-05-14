DatasourceModel = function(theFreeboardModel, datasourcePlugins) {
	var self = this;

	function disposeDatasourceInstance()
	{
		if(!_.isUndefined(self.datasourceInstance))
		{
			if(_.isFunction(self.datasourceInstance.onDispose))
			{
				self.datasourceInstance.onDispose();
			}

			self.datasourceInstance = undefined;
		}
	}

	this.name = ko.observable();
	this.latestData = ko.observable();
	this.settings = ko.observable({});
	// Track paused state for UI and to suppress updates.
	this.isPaused = ko.observable(false);
	function syncPausedFromSettings(newValue)
	{
		var paused = !!(newValue && newValue.paused);
		self.isPaused(paused);
	}
	this.settings.subscribe(function(newValue)
	{
		syncPausedFromSettings(newValue);
		if(!_.isUndefined(self.datasourceInstance) && _.isFunction(self.datasourceInstance.onSettingsChanged))
		{
			self.datasourceInstance.onSettingsChanged(newValue);
		}
	});

	this.updateCallback = function(newData)
	{
		// Skip updates while paused to keep widgets static and avoid port contention.
		if(self.isPaused()) return;
		theFreeboardModel.processDatasourceUpdate(self, newData);

		self.latestData(newData);

		var now = new Date();
		self.last_updated(now.toLocaleTimeString());
	}

	this.type = ko.observable();
	this.type.subscribe(function(newValue)
	{
		disposeDatasourceInstance();

		if((newValue in datasourcePlugins) && _.isFunction(datasourcePlugins[newValue].newInstance))
		{
			var datasourceType = datasourcePlugins[newValue];

			function finishLoad()
			{
				datasourceType.newInstance(self.settings(), function(datasourceInstance)
				{

					self.datasourceInstance = datasourceInstance;
					datasourceInstance.updateNow();

				}, self.updateCallback);
			}

			// Do we need to load any external scripts?
			if(datasourceType.external_scripts)
			{
				head.js(datasourceType.external_scripts.slice(0), finishLoad); // Need to clone the array because head.js adds some weird functions to it
			}
			else
			{
				finishLoad();
			}
		}
	});

	this.last_updated = ko.observable("never");
	this.last_error = ko.observable();

	this.settings.subscribe(function(newValue)
	{
		syncPausedFromSettings(newValue);
		if(!_.isUndefined(self.datasourceInstance) && _.isFunction(self.datasourceInstance.onSettingsChanged))
		{
			self.datasourceInstance.onSettingsChanged(newValue);
		}

		// Emit live config update
		freeboard.emit("config_updated", theFreeboardModel.getCurrentConfig());
	});

	this.serialize = function()
	{
		return {
			name    : self.name(),
			type    : self.type(),
			settings: self.settings()
		};
	}

	this.deserialize = function(object)
	{
		self.settings(object.settings);
		self.name(object.name);
		self.type(object.type);
		syncPausedFromSettings(object.settings || {});
	}

	this.getDataRepresentation = function(dataPath)
	{
		var valueFunction = new Function("data", "return " + dataPath + ";");
		return valueFunction.call(undefined, self.latestData());
	}

	this.updateNow = function()
	{
		if(self.isPaused()) return;
		if(!_.isUndefined(self.datasourceInstance) && _.isFunction(self.datasourceInstance.updateNow))
		{
			self.datasourceInstance.updateNow();
		}
	}

	// Toggle pause from the datasource list UI.
	this.togglePause = function()
	{
		var next = !self.isPaused();
		var current = self.settings() || {};
		var newSettings = Object.assign({}, current, { paused: next });
		self.settings(newSettings);
		self.isPaused(next);
	}

	this.dispose = function()
	{
		disposeDatasourceInstance();
	}
}

DeveloperConsole = function(theFreeboardModel)
{
	function showDeveloperConsole()
	{
		var pluginScriptsInputs = [];
		var container = $('<div></div>');
		var addScript = $('<div class="table-operation text-button">ADD</div>');
		var table = $('<table class="table table-condensed sub-table"></table>');

		table.append($('<thead style=""><tr><th>Plugin Script URL</th></tr></thead>'));

		var tableBody = $("<tbody></tbody>");

		table.append(tableBody);

		container.append($("<p>Here you can add references to other scripts to load datasource or widget plugins.</p>"))
			.append(table)
			.append(addScript)
            .append('<p>To learn how to build plugins for freeboard, please visit <a target="_blank" href="http://freeboard.github.io/freeboard/docs/plugin_example.html">http://freeboard.github.io/freeboard/docs/plugin_example.html</a></p>');

		function refreshScript(scriptURL)
		{
			$('script[src="' + scriptURL + '"]').remove();
		}

		function addNewScriptRow(scriptURL)
		{
			var tableRow = $('<tr></tr>');
			var tableOperations = $('<ul class="board-toolbar"></ul>');
			var scriptInput = $('<input class="table-row-value" style="width:100%;" type="text">');
			var deleteOperation = $('<li><i class="icon-trash icon-white"></i></li>').click(function(e){
				pluginScriptsInputs = _.without(pluginScriptsInputs, scriptInput);
				tableRow.remove();
			});

			pluginScriptsInputs.push(scriptInput);

			if(scriptURL)
			{
				scriptInput.val(scriptURL);
			}

			tableOperations.append(deleteOperation);
			tableBody
				.append(tableRow
				.append($('<td></td>').append(scriptInput))
					.append($('<td class="table-row-operation">').append(tableOperations)));
		}

		_.each(theFreeboardModel.plugins(), function(pluginSource){

			addNewScriptRow(pluginSource);

		});

		addScript.click(function(e)
		{
			addNewScriptRow();
		});

		new DialogBox(container, "Developer Console", "OK", null, function(){

			// Unload our previous scripts
			_.each(theFreeboardModel.plugins(), function(pluginSource){

				$('script[src^="' + pluginSource + '"]').remove();

			});

			theFreeboardModel.plugins.removeAll();

			_.each(pluginScriptsInputs, function(scriptInput){

				var scriptURL = scriptInput.val();

				if(scriptURL && scriptURL.length > 0)
				{
					theFreeboardModel.addPluginSource(scriptURL);

					// Load the script with a cache buster
					head.js(scriptURL + "?" + Date.now());
				}
			});

		});
	}

	// Public API
	return {
		showDeveloperConsole : function()
		{
			showDeveloperConsole();
		}
	}
}

function DialogBox(contentElement, title, okTitle, cancelTitle, okCallback)
{
	var modal_width = 900;

	// Initialize our modal overlay
	var overlay = $('<div id="modal_overlay" style="display:none;"></div>');

	var modalDialog = $('<div class="modal"></div>');

	function closeModal()
	{
		// Remove key handler when closing to avoid leaks
		$(document).off('keydown.dialog');

		overlay.fadeOut(200, function()
		{
			$(this).remove();
		});
	}

	// Create our header
	modalDialog.append('<header><h2 class="title">' + title + "</h2></header>");

	$('<section></section>').appendTo(modalDialog).append(contentElement);

	// Create our footer
	var footer = $('<footer></footer>').appendTo(modalDialog);

	if(okTitle)
	{
		$('<span id="dialog-ok" class="text-button">' + okTitle + '</span>').appendTo(footer).click(function()
		{
			var hold = false;

			if(_.isFunction(okCallback))
			{
				hold = okCallback();
			}

			if(!hold)
			{
				closeModal();
			}
		});
	}

	if(cancelTitle)
	{
		$('<span id="dialog-cancel" class="text-button">' + cancelTitle + '</span>').appendTo(footer).click(function()
		{
			closeModal();
		});
	}

	// Bind Enter/Ctrl+Enter/Cmd+Enter to trigger OK inside the modal.
	$(document).off('keydown.dialog').on('keydown.dialog', function(e) {
		if ($('#modal_overlay').length === 0) return;

		var isEnter = (e.key === 'Enter' || e.keyCode === 13);
		var isEscape = (e.key === 'Escape' || e.keyCode === 27);
		var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
		var wantsSave = isEnter && !e.altKey && !e.shiftKey && (!e.ctrlKey && !e.metaKey || e.ctrlKey || e.metaKey);

		if (wantsSave) {
			if (tag === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return;
			var okBtn = $('#dialog-ok', overlay);
			if (okBtn.length && okBtn.is(':visible')) {
				var $fields = $('input, textarea, select', overlay).filter(function() {
					return $(this).closest('#setting-row-plugin-types').length === 0;
				});
				$fields.trigger('change');
				okBtn.trigger('click');
				e.preventDefault();
			}
			return;
		}

		if (isEscape) {
			var cancelBtn = $('#dialog-cancel', overlay);
			if (cancelBtn.length && cancelBtn.is(':visible')) {
				cancelBtn.trigger('click');
				e.preventDefault();
			}
		}
	});

	overlay.append(modalDialog);
	$("body").append(overlay);
	overlay.fadeIn(200);
}

function FreeboardModel(datasourcePlugins, widgetPlugins, freeboardUI)
{
	var self = this;

	var SERIALIZATION_VERSION = 1;

	this.version = 0;
	this.isEditing = ko.observable(false);
	this.allow_edit = ko.observable(false);
	this.allow_edit.subscribe(function(newValue)
	{
		if(newValue)
		{
			$("#main-header").show();
		}
		else
		{
			$("#main-header").hide();
		}
	});

	this.header_image = ko.observable();
	this.plugins = ko.observableArray();
	this.datasources = ko.observableArray();
	this.panes = ko.observableArray();
	this.datasourceData = {};
	this.processDatasourceUpdate = function(datasourceModel, newData)
	{
		var datasourceName = datasourceModel.name();

		self.datasourceData[datasourceName] = newData;

		_.each(self.panes(), function(pane)
		{
			_.each(pane.widgets(), function(widget)
			{
				widget.processDatasourceUpdate(datasourceName);
			});
		});
	}

	this._datasourceTypes = ko.observable();
	this.datasourceTypes = ko.computed({
		read: function()
		{
			self._datasourceTypes();

			var returnTypes = [];

			_.each(datasourcePlugins, function(datasourcePluginType)
			{
				var typeName = datasourcePluginType.type_name;
				var displayName = typeName;

				if(!_.isUndefined(datasourcePluginType.display_name))
				{
					displayName = datasourcePluginType.display_name;
				}

				returnTypes.push({
					name        : typeName,
					display_name: displayName
				});
			});

			return returnTypes;
		}
	});

	this._widgetTypes = ko.observable();
	this.widgetTypes = ko.computed({
		read: function()
		{
			self._widgetTypes();

			var returnTypes = [];

			_.each(widgetPlugins, function(widgetPluginType)
			{
				var typeName = widgetPluginType.type_name;
				var displayName = typeName;

				if(!_.isUndefined(widgetPluginType.display_name))
				{
					displayName = widgetPluginType.display_name;
				}

				returnTypes.push({
					name        : typeName,
					display_name: displayName
				});
			});

			return returnTypes;
		}
	});

	this.addPluginSource = function(pluginSource)
	{
		if(pluginSource && self.plugins.indexOf(pluginSource) == -1)
		{
			self.plugins.push(pluginSource);
		}
	}

	this.getCurrentConfig = function() {
		const config = {
			datasources: [],
			widgets: []
		};

		// Gather all datasource settings
		_.each(self.datasources(), function(datasource) {
			if (typeof datasource.serialize === "function") {
				config.datasources.push({
					name: datasource.name(),
					settings: datasource.settings(), // live config
					fullConfig: datasource.serialize() // optional full serialization
				});
			}
		});

		// Gather all widget settings from all panes
		_.each(self.panes(), function(pane) {
			_.each(pane.widgets(), function(widget) {
				if (typeof widget.serialize === "function") {
					config.widgets.push({
						name: widget.title ? widget.title() : "Unnamed Widget",
						type: widget.type ? widget.type() : null,
						settings: widget.settings(),
						fullConfig: widget.serialize(),
						pane: pane.title ? pane.title() : null
					});
				}
			});
		});

		return config;
	};

	this.serialize = function()
	{
		var panes = [];

		_.each(self.panes(), function(pane)
		{
			panes.push(pane.serialize());
		});

		var datasources = [];

		_.each(self.datasources(), function(datasource)
		{
			datasources.push(datasource.serialize());
		});

		return {
			version     : SERIALIZATION_VERSION,
			header_image: self.header_image(),
			allow_edit  : self.allow_edit(),
			plugins     : self.plugins(),
			panes       : panes,
			datasources : datasources,
			columns     : freeboardUI.getUserColumns()
		};
	}

	this.deserialize = function(object, finishedCallback)
	{
		// Normalize and guard input so missing fields don't break loading.
		object = object || {};
		object.plugins = _.isArray(object.plugins) ? object.plugins : [];
		object.datasources = _.isArray(object.datasources) ? object.datasources : [];
		object.panes = _.isArray(object.panes) ? object.panes : [];
		var safeColumns = (_.isNumber(object.columns) && !isNaN(object.columns)) ? object.columns : freeboardUI.getUserColumns();

		// Emit debug steps into the Activity pane.
		freeboard.emit("activity", {
			id: "dashboard:load",
			state: "start",
			title: "Dashboard",
			label: "Deserialize",
			detail: `plugins=${object.plugins.length}, datasources=${object.datasources.length}, panes=${object.panes.length}`
		});

		function finishLoad()
		{
			freeboardUI.setUserColumns(safeColumns);
			freeboard.emit("activity", {
				id: "dashboard:load:columns",
				state: "done",
				title: "Dashboard",
				label: "Columns set",
				detail: String(safeColumns)
			});

			if(!_.isUndefined(object.allow_edit))
			{
				self.allow_edit(object.allow_edit);
			}
			else
			{
				self.allow_edit(true);
			}
			self.version = object.version || 0;
			self.header_image(object.header_image);
			freeboard.emit("activity", {
				id: "dashboard:load:meta",
				state: "done",
				title: "Dashboard",
				label: "Metadata applied"
			});

			_.each(object.datasources, function(datasourceConfig)
			{
				var datasource = new DatasourceModel(self, datasourcePlugins);
				datasource.deserialize(datasourceConfig);
				self.addDatasource(datasource);
			});
			freeboard.emit("activity", {
				id: "dashboard:load:datasources",
				state: "done",
				title: "Dashboard",
				label: "Datasources loaded",
				detail: String(object.datasources.length)
			});

			// Normalize pane layouts so missing row/col does not crash reloads.
			var normalizedPanes = _.chain(object.panes)
				.filter(function(pane){ return !!pane; })
				.map(function(pane, idx){
					if(!pane.row || !pane.col)
					{
						var fallback = Math.max(1, safeColumns || 1);
						pane.row = pane.row || {};
						pane.col = pane.col || {};
						pane.row[fallback] = pane.row[fallback] || 1;
						pane.col[fallback] = pane.col[fallback] || ((idx % fallback) + 1);
						console.error("Pane layout missing row/col, applying fallback:", pane);
						freeboard.emit("activity", {
							id: "dashboard:load:panes:normalize",
							state: "error",
							title: "Dashboard",
							label: "Pane layout normalized",
							detail: `index=${idx}`
						});
					}
					return pane;
				})
				.value();

			var sortedPanes = _.sortBy(normalizedPanes, function(pane){
				try
				{
					var pos = freeboardUI.getPositionForScreenSize(pane);
					return (pos && _.isNumber(pos.row)) ? pos.row : 1;
				}
				catch(err)
				{
					console.error("Pane position resolve failed:", err, pane);
					freeboard.emit("activity", {
						id: "dashboard:load:panes:position",
						state: "error",
						title: "Dashboard",
						label: "Pane position resolve failed",
						detail: String(err && (err.message || err))
					});
					return 1;
				}
			});

			_.each(sortedPanes, function(paneConfig)
			{
				var pane = new PaneModel(self, widgetPlugins);
				pane.deserialize(paneConfig);
				self.panes.push(pane);
			});
			freeboard.emit("activity", {
				id: "dashboard:load:panes",
				state: "done",
				title: "Dashboard",
				label: "Panes loaded",
				detail: String(object.panes.length)
			});

			if(self.allow_edit() && self.panes().length == 0)
			{
				self.setEditing(true);
			}

			if(_.isFunction(finishedCallback))
			{
				finishedCallback();
			}

			freeboard.emit("config_updated", self.getCurrentConfig());
			freeboardUI.processResize(true);
			freeboard.emit("activity", {
				id: "dashboard:load",
				state: "done",
				title: "Dashboard",
				label: "Deserialize complete"
			});
		}

		// This could have been self.plugins(object.plugins), but for some weird reason head.js was causing a function to be added to the list of plugins.
		_.each(object.plugins, function(plugin)
		{
			self.addPluginSource(plugin);
		});

		// Load any plugins referenced in this definition
		if(object.plugins.length > 0)
		{
			freeboard.emit("activity", {
				id: "dashboard:load:plugins",
				state: "start",
				title: "Dashboard",
				label: "Loading plugins",
				detail: String(object.plugins.length)
			});
			head.js(object.plugins, function()
			{
				freeboard.emit("activity", {
					id: "dashboard:load:plugins",
					state: "done",
					title: "Dashboard",
					label: "Plugins loaded",
					detail: String(object.plugins.length)
				});
				finishLoad();
			});
		}
		else
		{
			finishLoad();
		}
	}

	this.clearDashboard = function()
	{
		// Full reset before loading a new dashboard to avoid leftover state.
		freeboardUI.beginBulkRemove();
		freeboardUI.removeAllPanes();

		_.each(self.datasources(), function(datasource)
		{
			datasource.dispose();
		});

		_.each(self.panes(), function(pane)
		{
			pane.dispose();
		});

		self.plugins.removeAll();
		self.datasources.removeAll();
		self.panes.removeAll();
		self.datasourceData = {};
		self.header_image(undefined);
		self.version = 0;
		// Let knockout cleanup settle before re-enabling pane removals.
		setTimeout(function() {
			freeboardUI.endBulkRemove();
		}, 0);
	}

	this.loadDashboard = function(dashboardData, callback)
	{
		// Always clear the loading spinner even if deserialization throws.
		var loadingCleared = false;
		function clearLoading()
		{
			if(loadingCleared) return;
			loadingCleared = true;
			freeboardUI.showLoadingIndicator(false);
		}

		freeboard.emit("activity", {
			id: "dashboard:load",
			state: "start",
			title: "Dashboard",
			label: "Load requested"
		});
		freeboardUI.showLoadingIndicator(true);
		try
		{
			// Reset the current board before loading the new one.
			self.clearDashboard();
			freeboard.emit("activity", {
				id: "dashboard:load:reset",
				state: "done",
				title: "Dashboard",
				label: "Reset complete"
			});
			self.deserialize(dashboardData, function()
			{
				try
				{
					clearLoading();

					if(_.isFunction(callback))
					{
						callback();
					}

					freeboard.emit("dashboard_loaded");
					freeboard.emit("activity", {
						id: "dashboard:load",
						state: "done",
						title: "Dashboard",
						label: "Load complete"
					});
				}
				catch(err)
				{
					clearLoading();
					console.error("Dashboard load callback failed:", err);
					freeboard.emit("activity", {
						id: "dashboard:load",
						state: "error",
						title: "Dashboard",
						label: "Load callback failed",
						detail: String(err && (err.message || err))
					});
				}
			});
		}
		catch(err)
		{
			clearLoading();
			console.error("Dashboard load failed:", err);
			freeboard.emit("activity", {
				id: "dashboard:load",
				state: "error",
				title: "Dashboard",
				label: "Load failed",
				detail: String(err && (err.message || err))
			});
			alert("Failed to load dashboard. Check the console for details.");
		}
	}

	this.loadDashboardFromLocalFile = function()
	{
		// Check for the various File API support.
		if(window.File && window.FileReader && window.FileList && window.Blob)
		{
			var input = document.createElement('input');
			input.type = "file";
			$(input).on("change", function(event)
			{
				var files = event.target.files;

				if(files && files.length > 0)
				{
					var file = files[0];
					var reader = new FileReader();

					reader.addEventListener("load", function(fileReaderEvent)
					{
						// Guard JSON parsing so a bad file doesn't leave the app stuck.
						try
						{
							var textFile = fileReaderEvent.target;
							var jsonObject = JSON.parse(textFile.result);

							freeboard.emit("activity", {
								id: "dashboard:load:file",
								state: "done",
								title: "Dashboard",
								label: "File parsed"
							});
							self.loadDashboard(jsonObject);
							self.setEditing(false);
						}
						catch(err)
						{
							console.error("Dashboard JSON parse failed:", err);
							freeboard.emit("activity", {
								id: "dashboard:load:file",
								state: "error",
								title: "Dashboard",
								label: "File parse failed",
								detail: String(err && (err.message || err))
							});
							alert("Invalid dashboard JSON. Check the console for details.");
						}
					});

					reader.readAsText(file);
				}

			});
			$(input).trigger("click");
		}
		else
		{
			alert('Unable to load a file in this browser.');
		}
	}

	this.saveDashboardClicked = function(){
		// Save directly in pretty format; no toggle menu.
		self.saveDashboard(null, { currentTarget: { dataset: { pretty: "true" } } });
	}

	this.saveDashboard = function(_thisref, event)
	{
		var pretty = $(event.currentTarget).data('pretty');
		var contentType = 'application/octet-stream';
		var a = document.createElement('a');
		if(pretty){
			var blob = new Blob([JSON.stringify(self.serialize(), null, '\t')], {'type': contentType});
		}else{
			var blob = new Blob([JSON.stringify(self.serialize())], {'type': contentType});
		}
		document.body.appendChild(a);
		a.href = window.URL.createObjectURL(blob);
		a.download = "dashboard.json";
		a.target="_self";
		a.click();
	}

	this.addDatasource = function(datasource)
	{
		self.datasources.push(datasource);
		freeboard.emit("config_updated", self.getCurrentConfig());
	}

	this.deleteDatasource = function(datasource)
	{
		delete self.datasourceData[datasource.name()];
		datasource.dispose();
		self.datasources.remove(datasource);
		freeboard.emit("config_updated", self.getCurrentConfig());
	}

	this.createPane = function()
	{
		var newPane = new PaneModel(self, widgetPlugins);
		self.addPane(newPane);
	}

	this.addGridColumnLeft = function()
	{
		freeboardUI.addGridColumnLeft();
	}

	this.addGridColumnRight = function()
	{
		freeboardUI.addGridColumnRight();
	}

	this.subGridColumnLeft = function()
	{
		freeboardUI.subGridColumnLeft();
	}

	this.subGridColumnRight = function()
	{
		freeboardUI.subGridColumnRight();
	}

	this.addPane = function(pane)
	{
		var newPaneHeight = pane.getCalculatedHeight();

		_.each(self.panes(), function(existingPane)
		{
			if(_.isNumber(existingPane.row) && _.isNumber(existingPane.col))
			{
				existingPane.row += newPaneHeight;
				return;
			}

			if(!_.isObject(existingPane.row))
			{
				existingPane.row = {};
			}

			_.each(existingPane.row, function(rowValue, columnKey)
			{
				var currentRow = Number(rowValue) || 1;
				existingPane.row[columnKey] = currentRow + newPaneHeight;
			});
		});

		if(!_.isObject(pane.row))
		{
			pane.row = {};
		}
		if(!_.isObject(pane.col))
		{
			pane.col = {};
		}

		pane.row[1] = 1;
		pane.col[1] = 1;
		self.panes.unshift(pane);
		freeboard.emit("config_updated", self.getCurrentConfig());
	}

	this.deletePane = function(pane)
	{
		pane.dispose();
		self.panes.remove(pane);
		freeboard.emit("config_updated", self.getCurrentConfig());
	}

	this.deleteWidget = function(widget)
	{
		ko.utils.arrayForEach(self.panes(), function(pane)
		{
			pane.widgets.remove(widget);
		});

		widget.dispose();
		freeboard.emit("config_updated", self.getCurrentConfig());
	}

	this.setEditing = function(editing, animate)
	{
		// Don't allow editing if it's not allowed
		if(!self.allow_edit() && editing)
		{
			return;
		}

		self.isEditing(editing);

		if(_.isUndefined(animate))
		{
			animate = true;
		}

		var animateLength = (animate) ? 250 : 0;
		var barHeight = $("#admin-bar").outerHeight();
		var tabsOffset = $("#app-tabs").outerHeight() || 0;

		if(!editing)
		{
			$("#toggle-header-icon").addClass("icon-chevron-down").removeClass("icon-chevron-up");
			$(".gridster .gs_w").css({cursor: "default"});
			$("#main-header").animate({"top": (tabsOffset - barHeight) + "px"}, animateLength);
			$("#board-content").animate({"top": (tabsOffset + 20) + "px"}, animateLength);
			$("#main-header").data().shown = false;
			$(".sub-section").unbind();
			freeboardUI.disableGrid();
		}
		else
		{
			$("#toggle-header-icon").addClass("icon-chevron-up").removeClass("icon-chevron-down");
			$(".gridster .gs_w").css({cursor: "pointer"});
			$("#main-header").animate({"top": tabsOffset + "px"}, animateLength);
			$("#board-content").animate({"top": (tabsOffset + barHeight + 20) + "px"}, animateLength);
			$("#main-header").data().shown = true;
			freeboardUI.attachWidgetEditIcons($(".sub-section"));
			freeboardUI.enableGrid();
		}

		freeboardUI.showPaneEditIcons(editing, animate);
	}

	this.toggleEditing = function()
	{
		var editing = !self.isEditing();
		self.setEditing(editing);
	}
}

function FreeboardUI()
{
	var PANE_MARGIN = 10;
	var PANE_WIDTH = 300;
	var MIN_COLUMNS = 3;
	var COLUMN_WIDTH = PANE_MARGIN + PANE_WIDTH + PANE_MARGIN;
	var ROW_HEIGHT = 30;

	var userColumns = MIN_COLUMNS;

	var loadingIndicator = $('<div class="wrapperloading"><div class="loading up" ></div><div class="loading down"></div></div>');
	var grid;
	var activePaneResize = null;
	var suppressRemove = false;

	function processResize(layoutWidgets)
	{
		var maxDisplayableColumns = getMaxDisplayableColumnCount();
		var repositionFunction = function(){};
		if(layoutWidgets)
		{
			repositionFunction = function(index)
			{
				var paneElement = this;
				var paneModel = ko.dataFor(paneElement);

				var newPosition = getPositionForScreenSize(paneModel);
				$(paneElement).attr("data-sizex", Math.min(paneModel.col_width(),
					maxDisplayableColumns, grid.cols))
					.attr("data-row", newPosition.row)
					.attr("data-col", newPosition.col);

				paneModel.processSizeChange();
			}
		}

		updateGridWidth(Math.min(maxDisplayableColumns, userColumns));

		repositionGrid(repositionFunction);
		updateGridColumnControls();
	}

	function addGridColumn(shift)
	{
		var num_cols = grid.cols + 1;
		if(updateGridWidth(num_cols))
		{
			repositionGrid(function() {
				var paneElement = this;
				var paneModel = ko.dataFor(paneElement);

				var prevColumnIndex = grid.cols > 1 ? grid.cols - 1 : 1;
				var prevCol = paneModel.col[prevColumnIndex];
				var prevRow = paneModel.row[prevColumnIndex];
				var newPosition;
				if(shift)
				{
					leftPreviewCol = true;
					var newCol = prevCol < grid.cols ? prevCol + 1 : grid.cols;
					newPosition = {row: prevRow, col: newCol};
				}
				else
				{
					rightPreviewCol = true;
					newPosition = {row: prevRow, col: prevCol};
				}
				$(paneElement).attr("data-sizex", Math.min(paneModel.col_width(), grid.cols))
					.attr("data-row", newPosition.row)
					.attr("data-col", newPosition.col);
			});
		}
		updateGridColumnControls();
		userColumns = grid.cols;
	}

	function subtractGridColumn(shift)
	{
		var num_cols = grid.cols - 1;
		if(updateGridWidth(num_cols))
		{
			repositionGrid(function() {
				var paneElement = this;
				var paneModel = ko.dataFor(paneElement);

				var prevColumnIndex = grid.cols + 1;
				var prevCol = paneModel.col[prevColumnIndex];
				var prevRow = paneModel.row[prevColumnIndex];
				var newPosition;
				if(shift)
				{
					var newCol = prevCol > 1 ? prevCol - 1 : 1;
					newPosition = {row: prevRow, col: newCol};
				}
				else
				{
					var newCol = prevCol <= grid.cols ? prevCol : grid.cols;
					newPosition = {row: prevRow, col: newCol};
				}
				$(paneElement).attr("data-sizex", Math.min(paneModel.col_width(), grid.cols))
					.attr("data-row", newPosition.row)
					.attr("data-col", newPosition.col);
			});
		}
		updateGridColumnControls();
		userColumns = grid.cols;
	}

	function updateGridColumnControls()
	{
		var col_controls = $(".column-tool");
		var available_width = $("#board-content").width();
		var max_columns = Math.floor(available_width / COLUMN_WIDTH);

		if(grid.cols <= MIN_COLUMNS)
		{
			col_controls.addClass("min");
		}
		else
		{
			col_controls.removeClass("min");
		}

		if(grid.cols >= max_columns)
		{
			col_controls.addClass("max");
		}
		else
		{
			col_controls.removeClass("max");
		}
	}

	function getMaxDisplayableColumnCount()
	{
		var available_width = $("#board-content").width();
		return Math.floor(available_width / COLUMN_WIDTH);
	}

	function updateGridWidth(newCols)
	{
		if(newCols === undefined || newCols < MIN_COLUMNS)
		{
			newCols = MIN_COLUMNS;
		}

		var max_columns = getMaxDisplayableColumnCount();
		if(newCols > max_columns)
		{
			newCols = max_columns;
		}

		// +newCols to account for scaling on zoomed browsers
		var new_width = (COLUMN_WIDTH * newCols) + newCols;
		$(".responsive-column-width").css("max-width", new_width);

		if(newCols === grid.cols)
		{
			return false; 
		}
		else
		{
			return true;
		}
	}

	function repositionGrid(repositionFunction)
	{
		var rootElement = grid.$el;

		rootElement.find("> li").unbind().removeData();
		$(".responsive-column-width").css("width", "");
		grid.generate_grid_and_stylesheet();

		rootElement.find("> li").each(repositionFunction);

		grid.init();
		$(".responsive-column-width").css("width", grid.cols * PANE_WIDTH + (grid.cols * PANE_MARGIN * 2));
	}

	function getUserColumns()
	{
		return userColumns;
	}

	function setUserColumns(numCols)
	{
		userColumns = Math.max(MIN_COLUMNS, numCols);
	}

	ko.bindingHandlers.grid = {
		init: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			// Initialize our grid
			grid = $(element).gridster({
				widget_margins        : [PANE_MARGIN, PANE_MARGIN],
				widget_base_dimensions: [PANE_WIDTH, 10],
				draggable             : {
					handle: '.pane-drag-handle, .pane-drag-handle *'
				},
				resize: {
					enabled : false,
					axes : "x"
				}
			}).data("gridster");

			processResize(false)

			grid.disable();
		}
	}

	function addPane(element, viewModel, isEditing)
	{
		var position = getPositionForScreenSize(viewModel);
		var col = position.col;
		var row = position.row;
		var width = Number(viewModel.width());
		var height = Number(viewModel.getCalculatedHeight());

		grid.add_widget(element, width, height, col, row);
		attachPaneResizeHandles(element, viewModel);

		if(isEditing)
		{
			showPaneEditIcons(true);
		}

		updatePositionForScreenSize(viewModel, row, col);

		$(element).attrchange({
			trackValues: true,
			callback   : function(event)
			{
				if(event.attributeName == "data-row")
				{
                    updatePositionForScreenSize(viewModel, Number(event.newValue), undefined);
				}
				else if(event.attributeName == "data-col")
				{
                    updatePositionForScreenSize(viewModel, undefined, Number(event.newValue));
				}
			}
		});
	}

	function updatePane(element, viewModel)
	{
		// If widget has been added or removed
		var calculatedHeight = viewModel.getCalculatedHeight();
		var $element = $(element);
		var coords = $element.data("coords");

		// Some dashboard loads trigger a resize before Gridster has registered the pane.
		// Rehydrate the grid metadata from the DOM instead of crashing on wgd.size_x.
		if((!coords || !coords.grid) && grid && _.isFunction(grid.register_widget))
		{
			var fallbackPosition = getPositionForScreenSize(viewModel);
			$element.attr("data-sizex", Math.min(viewModel.col_width(), grid.cols))
				.attr("data-sizey", calculatedHeight)
				.attr("data-col", fallbackPosition.col)
				.attr("data-row", fallbackPosition.row);
			try
			{
				grid.register_widget($element);
				coords = $element.data("coords");
			}
			catch(err)
			{
				console.error("Pane grid registration failed:", err);
				return;
			}
		}

		if(!coords || !coords.grid)
		{
			return;
		}

		var elementHeight = Number($element.attr("data-sizey"));
		var elementWidth = Number($element.attr("data-sizex"));
		var heightChanged = calculatedHeight != elementHeight;
		var widthChanged = viewModel.col_width() != elementWidth;

		if(heightChanged || widthChanged)
		{
			grid.resize_widget($element, viewModel.col_width(), calculatedHeight, function(){
				grid.set_dom_grid_height();
				notifyPaneSizeChanged(viewModel);
			});

			// Let Gridster keep vertical growth stable when widgets are added to a pane.
			// Only fall back to a full relayout when the pane width changes.
			if(widthChanged)
			{
				var currentCol = Number($element.attr("data-col"));
				var currentRow = Number($element.attr("data-row"));
				if(!grid.can_move_to({ size_x: viewModel.col_width(), size_y: calculatedHeight }, currentCol, currentRow))
				{
					processResize(true);
				}
			}
		}
	}

	function notifyPaneSizeChanged(paneModel)
	{
		_.each(paneModel.widgets(), function(widget)
		{
			if(widget && _.isFunction(widget.processSizeChange))
			{
				widget.processSizeChange();
			}
		});
	}

	function updatePositionForScreenSize(paneModel, row, col)
	{
		var displayCols = grid.cols;

		if(!_.isUndefined(row)) paneModel.row[displayCols] = row;
		if(!_.isUndefined(col)) paneModel.col[displayCols] = col;
	}

	function showLoadingIndicator(show)
	{
		if(show)
		{
			loadingIndicator.fadeOut(0).appendTo("body").fadeIn(500);
		}
		else
		{
	    		loadingIndicator.fadeOut(500).remove();
		}
	}

	function showPaneEditIcons(show, animate)
	{
		if(_.isUndefined(animate))
		{
			animate = true;
		}

		var animateLength = (animate) ? 250 : 0;

		if(show)
		{
			$(".pane-tools").fadeIn(animateLength);//.css("display", "block").animate({opacity: 1.0}, animateLength);
			$("#column-tools").fadeIn(animateLength);
			$(".pane-resize-handle").fadeIn(animateLength);
		}
		else
		{
			$(".pane-tools").fadeOut(animateLength);//.animate({opacity: 0.0}, animateLength).css("display", "none");//, function()
			$("#column-tools").fadeOut(animateLength);
			$(".pane-resize-handle").fadeOut(animateLength);
		}
	}

	function attachPaneResizeHandles(element, viewModel)
	{
		var $pane = $(element);
		if($pane.data("pane-resize-bound"))
		{
			return;
		}
		$pane.data("pane-resize-bound", true);

		var handles = [
			{ direction: "e", title: "Drag to resize pane width" },
			{ direction: "s", title: "Drag to resize pane height" },
			{ direction: "se", title: "Drag to resize pane" }
		];

		_.each(handles, function(handle)
		{
			var $handle = $('<div class="pane-resize-handle pane-resize-' + handle.direction + '"></div>')
				.attr("title", handle.title)
				.attr("data-resize-dir", handle.direction)
				.hide()
				.appendTo($pane);

			$handle.on("mousedown.freeboard-pane-resize", function(event)
			{
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();

				var dir = $(this).attr("data-resize-dir") || "";
				var startWidth = Number($pane.attr("data-sizex")) || Number(viewModel.col_width()) || 1;
				var startHeight = Number($pane.attr("data-sizey")) || Number(viewModel.getCalculatedHeight()) || 1;
				grid.disable();
				activePaneResize = {
					$pane: $pane,
					viewModel: viewModel,
					startX: event.clientX,
					startY: event.clientY,
					startWidth: startWidth,
					startHeight: startHeight,
					dir: dir,
					lastWidth: startWidth,
					lastHeight: startHeight
				};

				$("body").addClass("pane-resize-active");

				$(window)
					.on("mousemove.freeboard-pane-resize", paneResizeMove)
					.on("mouseup.freeboard-pane-resize", paneResizeStop);
			});
		});

	}

	function paneResizeMove(event)
	{
		if(!activePaneResize)
		{
			return;
		}

		var deltaCols = activePaneResize.dir.indexOf("e") !== -1 ? Math.round((event.clientX - activePaneResize.startX) / COLUMN_WIDTH) : 0;
		var deltaRows = activePaneResize.dir.indexOf("s") !== -1 ? Math.round((event.clientY - activePaneResize.startY) / ROW_HEIGHT) : 0;
		var nextWidth = activePaneResize.startWidth + deltaCols;
		var nextHeight = activePaneResize.startHeight + deltaRows;

		nextWidth = Math.max(1, Math.min(nextWidth, grid.cols));
		nextHeight = Math.max(1, nextHeight);

		if(nextWidth === activePaneResize.lastWidth && nextHeight === activePaneResize.lastHeight)
		{
			return;
		}

		activePaneResize.lastWidth = nextWidth;
		activePaneResize.lastHeight = nextHeight;

		grid.resize_widget(activePaneResize.$pane, nextWidth, nextHeight, function(){
			grid.set_dom_grid_height();
			notifyPaneSizeChanged(activePaneResize.viewModel);
		});
	}

	function paneResizeStop()
	{
		if(!activePaneResize)
		{
			return;
		}

		var finalWidth = Number(activePaneResize.$pane.attr("data-sizex")) || activePaneResize.lastWidth;
		var finalHeight = Number(activePaneResize.$pane.attr("data-sizey")) || activePaneResize.lastHeight;
		activePaneResize.viewModel.col_width(finalWidth);
		activePaneResize.viewModel.row_height(finalHeight);

		$(window).off(".freeboard-pane-resize");
		$("body").removeClass("pane-resize-active");
		grid.enable();
		activePaneResize = null;
	}

	function attachWidgetEditIcons(element)
	{
		$(element).hover(function()
		{
			showWidgetEditIcons(this, true);
		}, function()
		{
			showWidgetEditIcons(this, false);
		});
	}

	function showWidgetEditIcons(element, show)
	{
		if(show)
		{
			$(element).find(".sub-section-tools").fadeIn(250);
		}
		else
		{
			$(element).find(".sub-section-tools").fadeOut(250);
		}
	}

	function getPositionForScreenSize(paneModel)
	{
		var cols = grid.cols;

		if(!_.isObject(paneModel.row))
		{
			paneModel.row = {};
		}
		if(!_.isObject(paneModel.col))
		{
			paneModel.col = {};
		}

		if(_.isNumber(paneModel.row) && _.isNumber(paneModel.col)) // Support for legacy format
		{
			var obj = {};
			obj[cols] = paneModel.row;
			paneModel.row = obj;


			obj = {};
			obj[cols] = paneModel.col;
			paneModel.col = obj;
		}

		if(_.isEmpty(paneModel.row) || _.isEmpty(paneModel.col))
		{
			paneModel.row[cols] = paneModel.row[cols] || 1;
			paneModel.col[cols] = paneModel.col[cols] || 1;
		}

		var newColumnIndex = 1;
		var columnDiff = 1000;

		for(var columnIndex in paneModel.col)
		{
			if(columnIndex == cols)	 // If we already have a position defined for this number of columns, return that position
			{
				return {row: paneModel.row[columnIndex], col: paneModel.col[columnIndex]};
			}
			else if(paneModel.col[columnIndex] > cols) // If it's greater than our display columns, put it in the last column
			{
				newColumnIndex = cols;
			}
			else // If it's less than, pick whichever one is closest
			{
				var delta = cols - columnIndex;

				if(delta < columnDiff)
				{
					newColumnIndex = columnIndex;
					columnDiff = delta;
				}
			}
		}

		if(newColumnIndex in paneModel.col && newColumnIndex in paneModel.row)
		{
			return {row: paneModel.row[newColumnIndex], col: paneModel.col[newColumnIndex]};
		}

		return {row:1,col:newColumnIndex};
	}


	// Public Functions
	return {
		beginBulkRemove : function()
		{
			// Avoid double-removal while panes are being cleared.
			suppressRemove = true;
		},
		endBulkRemove : function()
		{
			suppressRemove = false;
		},
		showLoadingIndicator : function(show)
		{
			showLoadingIndicator(show);
		},
		showPaneEditIcons : function(show, animate)
		{
			showPaneEditIcons(show, animate);
		},
		attachWidgetEditIcons : function(element)
		{
			attachWidgetEditIcons(element);
		},
		getPositionForScreenSize : function(paneModel)
		{
			return getPositionForScreenSize(paneModel);
		},
		processResize : function(layoutWidgets)
		{
			processResize(layoutWidgets);
		},
		disableGrid : function()
		{
			grid.disable();
		},
		enableGrid : function()
		{
			grid.enable();
		},
		addPane : function(element, viewModel, isEditing)
		{
			addPane(element, viewModel, isEditing);
		},
		updatePane : function(element, viewModel)
		{
			updatePane(element, viewModel);
		},
		removePane : function(element)
		{
			if(suppressRemove) return;
			if(!grid) return;
			grid.remove_widget(element);
		},
		removeAllPanes : function()
		{
			if(!grid) return;
			grid.remove_all_widgets();
		},
		addGridColumnLeft : function()
		{
			addGridColumn(true);
		},
		addGridColumnRight : function()
		{
			addGridColumn(false);
		},
		subGridColumnLeft : function()
		{
			subtractGridColumn(true);
		},
		subGridColumnRight : function()
		{
			subtractGridColumn(false);
		},
		getUserColumns : function()
		{
			return getUserColumns();
		},
		setUserColumns : function(numCols)
		{
			setUserColumns(numCols);
		}
	}
}

JSEditor = function () {
	var assetRoot = ""

	function setAssetRoot(_assetRoot) {
		assetRoot = _assetRoot;
	}

	function displayJSEditor(value, callback) {

		var exampleText = "// Example: Convert temp from C to F and truncate to 2 decimal places.\n// return (datasources[\"MyDatasource\"].sensor.tempInF * 1.8 + 32).toFixed(2);";

		// If value is empty, go ahead and suggest something
		if (!value) {
			value = exampleText;
		}

		var codeWindow = $('<div class="code-window"></div>');
		var codeMirrorWrapper = $('<div class="code-mirror-wrapper"></div>');
		var codeWindowFooter = $('<div class="code-window-footer"></div>');
		var codeWindowHeader = $('<div class="code-window-header cm-s-ambiance">This javascript will be re-evaluated any time a datasource referenced here is updated, and the value you <code><span class="cm-keyword">return</span></code> will be displayed in the widget. You can assume this javascript is wrapped in a function of the form <code><span class="cm-keyword">function</span>(<span class="cm-def">datasources</span>)</code> where datasources is a collection of javascript objects (keyed by their name) corresponding to the most current data in a datasource.</div>');

		codeWindow.append([codeWindowHeader, codeMirrorWrapper, codeWindowFooter]);

		$("body").append(codeWindow);

		var codeMirrorEditor = CodeMirror(codeMirrorWrapper.get(0),
			{
				value: value,
				mode: "javascript",
				theme: "ambiance",
				indentUnit: 4,
				lineNumbers: true,
				matchBrackets: true,
				autoCloseBrackets: true
			}
		);

		var closeButton = $('<span id="dialog-cancel" class="text-button">Close</span>').click(function () {
			if (callback) {
				var newValue = codeMirrorEditor.getValue();

				if (newValue === exampleText) {
					newValue = "";
				}

				callback(newValue);
				codeWindow.remove();
			}
		});

		codeWindowFooter.append(closeButton);
	}

	// Public API
	return {
		displayJSEditor: function (value, callback) {
			displayJSEditor(value, callback);
		},
		setAssetRoot: function (assetRoot) {
			setAssetRoot(assetRoot)
		}
	}
}

function PaneModel(theFreeboardModel, widgetPlugins) {
	var self = this;

	this.title = ko.observable();
	this.width = ko.observable(1);
	this.row = {};
	this.col = {};

    this.col_width = ko.observable(2);
	this.row_height = ko.observable(null);
	this.col_width.subscribe(function(newValue)
	{
		self.processSizeChange();
	});
	this.row_height.subscribe(function(newValue)
	{
		self.processSizeChange();
	});

	this.widgets = ko.observableArray();

	this.addWidget = function (widget) {
		this.widgets.push(widget);
	}

	this.widgetCanMoveUp = function (widget) {
		return (self.widgets.indexOf(widget) >= 1);
	}

	this.widgetCanMoveDown = function (widget) {
		var i = self.widgets.indexOf(widget);

		return (i < self.widgets().length - 1);
	}

	this.moveWidgetUp = function (widget) {
		if (self.widgetCanMoveUp(widget)) {
			var i = self.widgets.indexOf(widget);
			var array = self.widgets();
			self.widgets.splice(i - 1, 2, array[i], array[i - 1]);
		}
	}

	this.moveWidgetDown = function (widget) {
		if (self.widgetCanMoveDown(widget)) {
			var i = self.widgets.indexOf(widget);
			var array = self.widgets();
			self.widgets.splice(i, 2, array[i + 1], array[i]);
		}
	}

	this.processSizeChange = function()
	{
		// Give the animation a moment to complete. Really hacky.
		// TODO: Make less hacky. Also, doesn't work when screen resizes.
		setTimeout(function(){
			_.each(self.widgets(), function (widget) {
				widget.processSizeChange();
			});
		}, 1000);
	}

	this.getCalculatedHeight = function () {
		var fixedRows = Number(self.row_height());
		if(_.isFinite(fixedRows) && fixedRows > 0)
		{
			return Math.max(1, Math.floor(fixedRows));
		}

		var sumHeights = _.reduce(self.widgets(), function (memo, widget) {
			return memo + widget.height();
		}, 0);

		sumHeights *= 6;
		sumHeights += 3;

		sumHeights *= 10;

		var rows = Math.ceil((sumHeights + 20) / 30);

		return Math.max(4, rows);
	}

	this.serialize = function () {
		var widgets = [];

		_.each(self.widgets(), function (widget) {
			widgets.push(widget.serialize());
		});

		return {
			title: self.title(),
			width: self.width(),
			row: self.row,
			col: self.col,
			col_width: Number(self.col_width()),
			row_height: _.isFinite(Number(self.row_height())) && Number(self.row_height()) > 0 ? Math.floor(Number(self.row_height())) : undefined,
			widgets: widgets
		};
	}

	this.deserialize = function (object) {
		self.title(object.title);
		self.width(object.width);

		self.row = _.isObject(object.row) ? object.row : {};
		self.col = _.isObject(object.col) ? object.col : {};
        self.col_width(object.col_width || 2);
		self.row_height(_.isFinite(Number(object.row_height)) && Number(object.row_height) > 0 ? Math.floor(Number(object.row_height)) : null);

		_.each(object.widgets, function (widgetConfig) {
			var widget = new WidgetModel(theFreeboardModel, widgetPlugins);
			widget.deserialize(widgetConfig);
			self.widgets.push(widget);
		});
	}

	this.dispose = function () {
		_.each(self.widgets(), function (widget) {
			widget.dispose();
		});
	}
}

var WIDGET_CATEGORY_STORAGE_KEY = "freeboard.widget_categories";

function _getDefaultWidgetCategories()
{
	return ["OwnTech", "Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Other"];
}

function _normalizeCategories(categories)
{
	var seen = {};
	var normalized = [];
	_.each(categories, function(category)
	{
		var name = (category || "").toString().trim();
		if(name.length === 0) return;
		if(!seen[name])
		{
			seen[name] = true;
			normalized.push(name);
		}
	});
	return normalized;
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
	if(name.indexOf("gauge") > -1 || display.indexOf("gauge") > -1)
	{
		return "Gauges";
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
		// Widget documentation opens in the docs tab UI.
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

function getWidgetCategoryConfig()
{
	var stored = null;
	try
	{
		stored = JSON.parse(localStorage.getItem(WIDGET_CATEGORY_STORAGE_KEY) || "null");
	}
	catch(e)
	{
		stored = null;
	}

	var categories = stored && _.isArray(stored.categories) ? stored.categories : _getDefaultWidgetCategories();
	categories = _normalizeCategories(categories);
	if(categories.length === 0)
	{
		categories = _getDefaultWidgetCategories();
	}
	if(!_.contains(categories, "Other"))
	{
		categories.push("Other");
	}

	var widgetCategories = stored && _.isObject(stored.widgetCategories) ? stored.widgetCategories : {};

	return {
		categories: categories,
		widgetCategories: widgetCategories
	};
}

function saveWidgetCategoryConfig(config)
{
	var categories = _normalizeCategories(config && config.categories ? config.categories : []);
	if(categories.length === 0)
	{
		categories = _getDefaultWidgetCategories();
	}
	if(!_.contains(categories, "Other"))
	{
		categories.push("Other");
	}
	var widgetCategories = config && _.isObject(config.widgetCategories) ? config.widgetCategories : {};
	try
	{
		localStorage.setItem(WIDGET_CATEGORY_STORAGE_KEY, JSON.stringify({
			categories: categories,
			widgetCategories: widgetCategories
		}));
	}
	catch(e)
	{
	}
}

function getWidgetCategoryForType(typeName, pluginType, config)
{
	if(pluginType && pluginType.category)
	{
		return pluginType.category;
	}
	var categoryConfig = config || getWidgetCategoryConfig();
	var mapped = categoryConfig.widgetCategories && categoryConfig.widgetCategories[typeName];
	if(mapped)
	{
		return mapped;
	}
	return _inferWidgetCategory(typeName, pluginType);
}

WidgetCategoryManager = function(theFreeboardModel, widgetPlugins)
{
	function showWidgetCategoryManager()
	{
		var config = getWidgetCategoryConfig();
		var categories = config.categories.slice(0);
		var widgetCategories = _.clone(config.widgetCategories || {});

		var container = $("<div></div>");
		container.append($("<p>Organize widget types into categories. Categories and assignments are stored locally in your browser.</p>"));

		var categoryTable = $('<table class="table table-condensed sub-table"></table>');
		categoryTable.append($("<thead><tr><th>Categories</th><th>&nbsp;</th></tr></thead>"));
		var categoryBody = $("<tbody></tbody>");
		categoryTable.append(categoryBody);

		var addCategoryButton = $('<div class="table-operation text-button">ADD CATEGORY</div>');

		var mappingTable = $('<table class="table table-condensed sub-table"></table>');
		mappingTable.append($("<thead><tr><th>Widget</th><th>Category</th></tr></thead>"));
		var mappingBody = $("<tbody></tbody>");
		mappingTable.append(mappingBody);

		container.append(categoryTable).append(addCategoryButton).append(mappingTable);

		function renderCategoryRows()
		{
			categoryBody.empty();
			_.each(categories, function(category, index)
			{
				var row = $("<tr></tr>");
				var nameCell = $("<td></td>");
				var input = $('<input class="table-row-value" type="text">').val(category);
				input.on("change", function()
				{
					categories[index] = $(this).val();
					renderMappingRows();
				});
				nameCell.append(input);

				var controlsCell = $("<td></td>");
				var toolbar = $('<ul class="board-toolbar"></ul>');
				var removeBtn = $('<li><i class="icon-trash icon-white"></i></li>').on("click", function()
				{
					categories.splice(index, 1);
					renderCategoryRows();
					renderMappingRows();
				});
				toolbar.append(removeBtn);
				controlsCell.append(toolbar);

				row.append(nameCell).append(controlsCell);
				categoryBody.append(row);
			});
		}

		function renderMappingRows()
		{
			mappingBody.empty();
			var normalized = _normalizeCategories(categories);
			if(normalized.length === 0)
			{
				normalized = _getDefaultWidgetCategories();
			}
			if(!_.contains(normalized, "Other"))
			{
				normalized.push("Other");
			}

			var pluginList = _.sortBy(_.values(widgetPlugins), function(plugin)
			{
				return (plugin.display_name || plugin.type_name || "").toLowerCase();
			});

			_.each(pluginList, function(plugin)
			{
				var row = $("<tr></tr>");
				row.append($("<td></td>").text(plugin.display_name || plugin.type_name));

				var select = $("<select></select>");
				_.each(normalized, function(category)
				{
					select.append($("<option></option>").val(category).text(category));
				});

				var current = widgetCategories[plugin.type_name] || getWidgetCategoryForType(plugin.type_name, plugin, {
					categories: normalized,
					widgetCategories: widgetCategories
				});
				if(!_.contains(normalized, current))
				{
					current = _.contains(normalized, "Other") ? "Other" : normalized[0];
				}
				select.val(current);
				select.on("change", function()
				{
					widgetCategories[plugin.type_name] = $(this).val();
				});

				row.append($("<td></td>").append(select));
				mappingBody.append(row);
			});
		}

		addCategoryButton.on("click", function()
		{
			categories.push("New Category");
			renderCategoryRows();
			renderMappingRows();
		});

		renderCategoryRows();
		renderMappingRows();

		new DialogBox(container, "Widget Categories", "Save", "Cancel", function()
		{
			var normalized = _normalizeCategories(categories);
			if(normalized.length === 0)
			{
				normalized = _getDefaultWidgetCategories();
			}
			if(!_.contains(normalized, "Other"))
			{
				normalized.push("Other");
			}

			_.each(widgetCategories, function(value, key)
			{
				if(!_.contains(normalized, value))
				{
					widgetCategories[key] = _.contains(normalized, "Other") ? "Other" : normalized[0];
				}
			});

			saveWidgetCategoryConfig({
				categories: normalized,
				widgetCategories: widgetCategories
			});

			theFreeboardModel._widgetTypes.valueHasMutated();
		});
	}

	return {
		showWidgetCategoryManager: showWidgetCategoryManager
	};
}

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

	function createPluginEditor(title, pluginTypes, currentTypeName, currentSettingsValues, settingsSavedCallback, isWidgetType, skipSettingsTypes)
	{
		currentSettingsValues = _.clone(currentSettingsValues || {});

		var newSettings = {
			type    : currentTypeName,
			settings: {}
		};

		function setWidgetTitleValue(titleValue)
		{
			var normalizedTitle = String(titleValue || "").trim();
			currentSettingsValues = _.clone(currentSettingsValues || {});
			currentSettingsValues.title = normalizedTitle;
			newSettings.settings.title = normalizedTitle;

			var titleInput = $("#setting-value-container-title").find("input[type='text']").first();
			if(titleInput.length)
			{
				titleInput.val(normalizedTitle).trigger("change");
			}
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

		var pluginDescriptionElement = $('<div id="plugin-description"></div>').hide();
		form.append(pluginDescriptionElement);

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

						// Allow dynamic option lists (function) and optional refresh for live lists.
						var optionsProvider = settingDef.options;
						var input = $('<select></select>').appendTo($('<div class="styled-select"></div>').appendTo(valueCell)).change(function()
						{
							newSettings.settings[settingDef.name] = $(this).val();
						});

						function resolveOptions()
						{
							return _.isFunction(optionsProvider) ? optionsProvider() : optionsProvider;
						}

						function hasOptionValue(value)
						{
							var found = false;
							input.find('option').each(function()
							{
								if($(this).attr('value') == value)
								{
									found = true;
									return false;
								}
							});
							return found;
						}

						function populateOptions(optionsList)
						{
							var selectedValue = input.val();
							if(_.isUndefined(selectedValue) || selectedValue === null || selectedValue === "")
							{
								selectedValue = newSettings.settings[settingDef.name];
							}
							if(_.isUndefined(selectedValue) || selectedValue === null || selectedValue === "")
							{
								selectedValue = currentSettingsValues[settingDef.name];
							}
							var resolved = _.isArray(optionsList) ? optionsList : [];
							input.empty();

							_.each(resolved, function(option)
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

							// Preserve the current value during live option refreshes even if the source list
							// temporarily omits it (for example while serial ports are re-enumerating).
							if(!_.isUndefined(selectedValue) && selectedValue !== "" && !hasOptionValue(selectedValue))
							{
								$("<option></option>").text(selectedValue).attr("value", selectedValue).appendTo(input);
							}

							var nextValue = selectedValue;
							if(_.isUndefined(nextValue) || nextValue === "" || !hasOptionValue(nextValue))
							{
								nextValue = _.isUndefined(defaultValue) ? undefined : defaultValue;
							}

							if(!_.isUndefined(nextValue))
							{
								input.val(nextValue);
								newSettings.settings[settingDef.name] = nextValue;
							}
						}

						populateOptions(resolveOptions());

						if(_.isFunction(optionsProvider) && settingDef.optionsRefreshMs)
						{
							var refreshMs = Math.max(parseInt(settingDef.optionsRefreshMs, 10) || 1000, 250);
							var refreshTimer = setInterval(function()
							{
								populateOptions(resolveOptions());
							}, refreshMs);

							input.on('remove', function()
							{
								clearInterval(refreshTimer);
							});
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
								var rawVal = $(this).val();
								if (settingDef.type == "number")
								{
									// Preserve empty as empty to satisfy required/number validation
									newSettings.settings[settingDef.name] = (rawVal === "" ? "" : Number(rawVal));
								}
								else
								{
									newSettings.settings[settingDef.name] = rawVal;
								}

								if(settingDef.name === "title")
								{
									currentSettingsValues = _.clone(currentSettingsValues || {});
									currentSettingsValues.title = newSettings.settings[settingDef.name];
								}
							});

							if(settingDef.name in currentSettingsValues)
							{
								input.val(currentSettingsValues[settingDef.name]);
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


		if(isWidgetType && !_.isUndefined(currentTypeName))
		{
			var _editPlugin = pluginTypes[currentTypeName];
			if(_editPlugin && (!_editPlugin.settings || _editPlugin.settings.length === 0))
			{
				return;
			}
		}

		new DialogBox(form, title, _.isUndefined(currentTypeName) ? "Add" : "Save", "Cancel", function()
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
		var widgetCategoryOrder = ["Plots", "Gauges", "Serial", "Controls", "OwnTech", "ThingSet", "Other"];

		var widgetCategoryDefaultIcons = {
			"OwnTech": "bolt",
			"Fast Frame": "chart-area",
			"Serial": "terminal",
			"ThingSet": "network-wired",
			"Plots": "chart-line",
			"Gauges": "gauge-high",
			"Controls": "sliders",
			"Other": "puzzle-piece"
		};

		function sortWidgetPlugins(category, list)
		{
			var preferredOrder = {
				"Plots": {
					"time_plot_uplot": 0,
					"xy_plot_uplot": 1,
					"fast_frame_plot": 2
				},
				"Gauges": {
					"vertical_gauge": 0,
					"horizontal_gauge": 1,
					"radial_arc_gauge": 2,
					"radial_needle_gauge": 3,
					"donut_gauge": 4
				},
				"Controls": {
					"fast_frame_control": 0,
					"fast_frame_channel_manager": 1,
					"uplot_series_manager": 2,
					"uplot_config_panel": 3,
					"xy_plot_source_manager": 4,
					"vertical_gauge_manager": 5,
					"vertical_gauge_config_panel": 6
				},
				"OwnTech": {
					"twist_actions_panel": 0,
					"twist_setpoints_panel": 1,
					"twist_calibration_panel": 2
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
				currentSettingsValues = {};
				setWidgetTitleValue(_buildUniqueWidgetTitle(
					_getDefaultWidgetTitle(nextTypeName, pluginTypes),
					""
				));
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

		}

		if(pluginTypeNames.length > 1)
		{
			var typeRow = createSettingRow("plugin-types", "Type");

			if(isWidgetType)
			{
				var typeRowContainer = typeRow.closest(".form-row");

				if(!_.isUndefined(currentTypeName))
				{
					// EDIT mode: hide type row, settings shown directly in post-setup
					typeRowContainer.hide();
				}
				else
				{
					// ADD mode: build picker with two-step flow
					typeRowContainer.addClass("widget-picker-row");
					typeRowContainer.find(".form-label").hide();
					typeRow.css("float", "none");
					var categoryConfig = getWidgetCategoryConfig();
					var categories = widgetCategoryOrder.slice(0);
					var grouped = {};

					_.each(pluginTypes, function(pluginType)
					{
						var category = getWidgetCategoryForType(pluginType.type_name, pluginType, categoryConfig);
						if(pluginType.compatibility_only && pluginType.type_name !== currentTypeName && category !== "Controls")
						{
							return;
						}
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

					var widgetBackBtn = $('<button type="button" class="datasource-back-btn" title="Back to type selection"><i class="fa-solid fa-arrow-left"></i></button>')
						.hide()
						.prependTo(form);

					var advanceToWidgetSettings = function(type)
					{
						var plugin = pluginTypes[type];
						if(!plugin) return;
						inPickerStep = false;
						applyWidgetTypeSelection(type);
						var skipForType = (!plugin.settings || plugin.settings.length === 0) ||
							(skipSettingsTypes && skipSettingsTypes.indexOf(type) > -1);
						if(skipForType)
						{
							$("#dialog-ok").trigger("click");
							return;
						}
						typeRowContainer.hide();
						widgetBackBtn.show();
					};

					widgetBackBtn.on("click", function()
					{
						inPickerStep = true;
						widgetBackBtn.hide();
						_removeSettingsRows();
						typeRowContainer.show();
						$("#dialog-ok").hide();
					});

					_.each(categories, function(category)
					{
						var list = grouped[category];
						if(!list || list.length === 0) return;

						var section = $('<div class="widget-picker-section"></div>').appendTo(widgetPicker);
						if(category === "OwnTech")
						{
							section.addClass("owntech");
						}
						if(category === "ThingSet")
						{
							section.addClass("thingset");
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
									advanceToWidgetSettings(pluginType.type_name);
								}
							});
							tile.on("keydown", function(event)
							{
								if(event.which === 13 || event.which === 32)
								{
									event.preventDefault();
									if(!$(this).hasClass("selected"))
									{
										advanceToWidgetSettings(pluginType.type_name);
									}
								}
							});
						});
					});
				}
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
					$("#dialog-ok").text(_.isUndefined(currentTypeName) ? "Add" : "Save").show();
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
			// ADD mode only (EDIT mode has no widgetPicker): start in picker-first step
			inPickerStep = true;
			$("#dialog-ok").hide();
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

		if(isWidgetType && !_.isUndefined(currentTypeName) && pluginTypeNames.length > 1)
		{
			// Widget EDIT mode: picker is hidden, show settings directly
			selectedType = pluginTypes[currentTypeName];
			newSettings.type = currentTypeName;
			createSettingsFromDefinition(selectedType.settings, selectedType.typeahead_source, selectedType.typeahead_data_segment);
			$("#dialog-ok").text("Save").show();
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
			isWidgetType,
			skipSettingsTypes)
		{
			createPluginEditor(title, pluginTypes, currentTypeName, currentSettingsValues, settingsSavedCallback, isWidgetType, skipSettingsTypes);
		}
	}
}

ValueEditor = function(theFreeboardModel)
{
	var _veDatasourceRegex = new RegExp(".*datasources\\[\"([^\"]*)(\"\\])?(.*)$");

	var dropdown = null;
	var selectedOptionIndex = 0;
	var _autocompleteOptions = [];
	var currentValue = null;

	var EXPECTED_TYPE = {
		ANY : "any",
		ARRAY : "array",
		OBJECT : "object",
		STRING : "string",
		NUMBER : "number",
		BOOLEAN : "boolean"
	};

	function _isPotentialTypeMatch(value, expectsType)
	{
		if(_.isArray(value) || _.isObject(value))
		{
			return true;
		}
		return _isTypeMatch(value, expectsType);
	}

	function _isTypeMatch(value, expectsType) {
		switch(expectsType)
		{
		case EXPECTED_TYPE.ANY: return true;
		case EXPECTED_TYPE.ARRAY: return _.isArray(value);
		case EXPECTED_TYPE.OBJECT: return _.isObject(value);
		case EXPECTED_TYPE.STRING: return _.isString(value);
		case EXPECTED_TYPE.NUMBER: return _.isNumber(value);
		case EXPECTED_TYPE.BOOLEAN: return _.isBoolean(value);
		}
	}

	function _checkCurrentValueType(element, expectsType) {
		$(element).parent().find(".validation-error").remove();
		if(!_isTypeMatch(currentValue, expectsType)) {
			$(element).parent().append("<div class='validation-error'>" +
				"This field expects an expression that evaluates to type " +
				expectsType + ".</div>");
		}
	}

	function _resizeValueEditor(element)
	{
		var lineBreakCount = ($(element).val().match(/\n/g) || []).length;

		var newHeight = Math.min(200, 20 * (lineBreakCount + 1));

		$(element).css({height: newHeight + "px"});
	}

	function _autocompleteFromDatasource(inputString, datasources, expectsType)
	{
		var match = _veDatasourceRegex.exec(inputString);

		var options = [];

		if(match)
		{
			// Editor value is: datasources["; List all datasources
			if(match[1] == "")
			{
				_.each(datasources, function(datasource)
				{
					options.push({value: datasource.name(), entity: undefined,
						precede_char: "", follow_char: "\"]"});
				});
			}
			// Editor value is a partial match for a datasource; list matching datasources
			else if(match[1] != "" && _.isUndefined(match[2]))
			{
				var replacementString = match[1];

				_.each(datasources, function(datasource)
				{
					var dsName = datasource.name();

					if(dsName != replacementString && dsName.indexOf(replacementString) == 0)
					{
						options.push({value: dsName, entity: undefined,
							precede_char: "", follow_char: "\"]"});
					}
				});
			}
			// Editor value matches a datasources; parse JSON in order to populate list
			else
			{
				// We already have a datasource selected; find it
				var datasource = _.find(datasources, function(datasource)
				{
					return (datasource.name() === match[1]);
				});

				if(!_.isUndefined(datasource))
				{
					var dataPath = "data";
					var remainder = "";

					// Parse the partial JSON selectors
					if(!_.isUndefined(match[2]))
					{
						// Strip any incomplete field values, and store the remainder
						var remainderIndex = match[3].lastIndexOf("]") + 1;
						dataPath = dataPath + match[3].substring(0, remainderIndex);
						remainder = match[3].substring(remainderIndex, match[3].length);
						remainder = remainder.replace(/^[\[\"]*/, "");
						remainder = remainder.replace(/[\"\]]*$/, "");
					}

					// Get the data for the last complete JSON field
					var dataValue = datasource.getDataRepresentation(dataPath);
					currentValue = dataValue;

					// For arrays, list out the indices
					if(_.isArray(dataValue))
					{
						for(var index = 0; index < dataValue.length; index++)
						{
							if(index.toString().indexOf(remainder) == 0)
							{
								var value = dataValue[index];
								if(_isPotentialTypeMatch(value, expectsType))
								{
									options.push({value: index, entity: value,
										precede_char: "[", follow_char: "]",
										preview: value.toString()});
								}
							}
						}
					}
					// For objects, list out the keys
					else if(_.isObject(dataValue))
					{
						_.each(dataValue, function(value, name)
						{
							if(name.indexOf(remainder) == 0)
							{
								if(_isPotentialTypeMatch(value, expectsType))
								{
									options.push({value: name, entity: value,
										precede_char: "[\"", follow_char: "\"]"});
								}
							}
						});
					}
					// For everything else, do nothing (no further selection possible)
					else
					{
						// no-op
					}
				}
			}
		}
		_autocompleteOptions = options;
	}

	function _renderAutocompleteDropdown(element, expectsType)
	{
		var inputString = $(element).val().substring(0, $(element).getCaretPosition());

		// Weird issue where the textarea box was putting in ASCII (nbsp) for spaces.
		inputString = inputString.replace(String.fromCharCode(160), " ");

		_autocompleteFromDatasource(inputString, theFreeboardModel.datasources(), expectsType);

		if(_autocompleteOptions.length > 0)
		{
			if(!dropdown)
			{
				dropdown = $('<ul id="value-selector" class="value-dropdown"></ul>')
					.insertAfter(element)
					.width($(element).outerWidth() - 2)
					.css("left", $(element).position().left)
					.css("top", $(element).position().top + $(element).outerHeight() - 1);
			}

			dropdown.empty();
			dropdown.scrollTop(0);

			var selected = true;
			selectedOptionIndex = 0;

			_.each(_autocompleteOptions, function(option, index)
			{
				var li = _renderAutocompleteDropdownOption(element, inputString, option, index);
				if(selected)
				{
					$(li).addClass("selected");
					selected = false;
				}
			});
		}
		else
		{
			_checkCurrentValueType(element, expectsType);
			$(element).next("ul#value-selector").remove();
			dropdown = null;
			selectedOptionIndex = -1;
		}
	}

	function _renderAutocompleteDropdownOption(element, inputString, option, currentIndex)
	{
		var optionLabel = option.value;
		if(option.preview)
		{
			optionLabel = optionLabel + "<span class='preview'>" + option.preview + "</span>";
		}
		var li = $('<li>' + optionLabel + '</li>').appendTo(dropdown)
			.mouseenter(function()
			{
				$(this).trigger("freeboard-select");
			})
			.mousedown(function(event)
			{
				$(this).trigger("freeboard-insertValue");
				event.preventDefault();
			})
			.data("freeboard-optionIndex", currentIndex)
			.data("freeboard-optionValue", option.value)
			.bind("freeboard-insertValue", function()
			{
				var optionValue = option.value;
				optionValue = option.precede_char + optionValue + option.follow_char;

				var replacementIndex = inputString.lastIndexOf("]");
				if(replacementIndex != -1)
				{
					$(element).replaceTextAt(replacementIndex+1, $(element).val().length,
						optionValue);
				}
				else
				{
					$(element).insertAtCaret(optionValue);
				}

				currentValue = option.entity;
				$(element).triggerHandler("mouseup");
			})
			.bind("freeboard-select", function()
			{
				$(this).parent().find("li.selected").removeClass("selected");
				$(this).addClass("selected");
				selectedOptionIndex = $(this).data("freeboard-optionIndex");
			});
		return li;
	}

	function createValueEditor(element, expectsType)
	{
		$(element).addClass("calculated-value-input")
			.bind("keyup mouseup freeboard-eval", function(event) {
				// Ignore arrow keys and enter keys
				if(dropdown && event.type == "keyup"
					&& (event.keyCode == 38 || event.keyCode == 40 || event.keyCode == 13))
				{
					event.preventDefault();
					return;
				}
				_renderAutocompleteDropdown(element, expectsType);
			})
			.focus(function()
			{
				$(element).css({"z-index" : 3001});
				_resizeValueEditor(element);
			})
			.focusout(function()
			{
				_checkCurrentValueType(element, expectsType);
				$(element).css({
					"height": "",
					"z-index" : 3000
				});
				$(element).next("ul#value-selector").remove();
				dropdown = null;
				selectedOptionIndex = -1;
			})
			.bind("keydown", function(event)
			{

				if(dropdown)
				{
					if(event.keyCode == 38 || event.keyCode == 40) // Handle Arrow keys
					{
						event.preventDefault();

						var optionItems = $(dropdown).find("li");

						if(event.keyCode == 38) // Up Arrow
						{
							selectedOptionIndex--;
						}
						else if(event.keyCode == 40) // Down Arrow
						{
							selectedOptionIndex++;
						}

						if(selectedOptionIndex < 0)
						{
							selectedOptionIndex = optionItems.size() - 1;
						}
						else if(selectedOptionIndex >= optionItems.size())
						{
							selectedOptionIndex = 0;
						}

						var optionElement = $(optionItems).eq(selectedOptionIndex);

						optionElement.trigger("freeboard-select");
						$(dropdown).scrollTop($(optionElement).position().top);
					}
					else if(event.keyCode == 13) // Handle enter key
					{
						event.preventDefault();

						if(selectedOptionIndex != -1)
						{
							$(dropdown).find("li").eq(selectedOptionIndex)
								.trigger("freeboard-insertValue");
						}
					}
				}
			});
	}

	// Public API
	return {
		createValueEditor : function(element, expectsType)
		{
			if(expectsType)
			{
				createValueEditor(element, expectsType);
			}
			else {
				createValueEditor(element, EXPECTED_TYPE.ANY);
			}
		},
		EXPECTED_TYPE : EXPECTED_TYPE
	}
}

function WidgetModel(theFreeboardModel, widgetPlugins) {
	function disposeWidgetInstance() {
		if (!_.isUndefined(self.widgetInstance)) {
			if (_.isFunction(self.widgetInstance.onDispose)) {
				self.widgetInstance.onDispose();
			}

			self.widgetInstance = undefined;
		}
	}

	var self = this;

	this.datasourceRefreshNotifications = {};
	this.calculatedSettingScripts = {};

	this.title = ko.observable();
	this.fillSize = ko.observable(false);

	this.type = ko.observable();
	this.type.subscribe(function (newValue) {
		disposeWidgetInstance();

		if ((newValue in widgetPlugins) && _.isFunction(widgetPlugins[newValue].newInstance)) {
			var widgetType = widgetPlugins[newValue];

			function finishLoad() {
				widgetType.newInstance(self.settings(), function (widgetInstance) {

					self.fillSize((widgetType.fill_size === true));
					self.widgetInstance = widgetInstance;
					self.shouldRender(true);
					self._heightUpdate.valueHasMutated();

				});
			}

			// Do we need to load any external scripts?
			if (widgetType.external_scripts) {
				head.js(widgetType.external_scripts.slice(0), finishLoad); // Need to clone the array because head.js adds some weird functions to it
			}
			else {
				finishLoad();
			}
		}
	});

	this.settings = ko.observable({});
	this.settings.subscribe(function (newValue) {
		if (!_.isUndefined(self.widgetInstance) && _.isFunction(self.widgetInstance.onSettingsChanged)) {
			self.widgetInstance.onSettingsChanged(newValue);
		}

		self.updateCalculatedSettings();
		self._heightUpdate.valueHasMutated();

		// Emit live config update
		freeboard.emit("config_updated", theFreeboardModel.getCurrentConfig());
	});

	this.processDatasourceUpdate = function (datasourceName) {
		var refreshSettingNames = self.datasourceRefreshNotifications[datasourceName];

		if (_.isArray(refreshSettingNames)) {
			_.each(refreshSettingNames, function (settingName) {
				self.processCalculatedSetting(settingName);
			});
		}
	}

	this.callValueFunction = function (theFunction) {
		return theFunction.call(undefined, theFreeboardModel.datasourceData);
	}

	this.processSizeChange = function () {
		if (!_.isUndefined(self.widgetInstance) && _.isFunction(self.widgetInstance.onSizeChanged)) {
			self.widgetInstance.onSizeChanged();
		}
	}

	this.processCalculatedSetting = function (settingName) {
		if (_.isFunction(self.calculatedSettingScripts[settingName])) {
			var returnValue = undefined;

			try {
				returnValue = self.callValueFunction(self.calculatedSettingScripts[settingName]);
			}
			catch (e) {
				var rawValue = self.settings()[settingName];

				// If there is a reference error and the value just contains letters and numbers, then
				if (e instanceof ReferenceError && (/^\w+$/).test(rawValue)) {
					returnValue = rawValue;
				}
			}

			if (!_.isUndefined(self.widgetInstance) && _.isFunction(self.widgetInstance.onCalculatedValueChanged) && !_.isUndefined(returnValue)) {
				try {
					self.widgetInstance.onCalculatedValueChanged(settingName, returnValue);
				}
				catch (e) {
					console.log(e.toString());
				}
			}
		}
	}

	this.updateCalculatedSettings = function () {
		self.datasourceRefreshNotifications = {};
		self.calculatedSettingScripts = {};

		if (_.isUndefined(self.type())) {
			return;
		}

		// Check for any calculated settings
		var settingsDefs = widgetPlugins[self.type()].settings;
		var datasourceRegex = new RegExp("datasources.([\\w_-]+)|datasources\\[['\"]([^'\"]+)", "g");
		var currentSettings = self.settings();

		_.each(settingsDefs, function (settingDef) {
			if (settingDef.type == "calculated") {
				var script = currentSettings[settingDef.name];

				if (!_.isUndefined(script)) {

					if(_.isArray(script)) {
						script = "[" + script.join(",") + "]";
					}

					// If there is no return, add one
					if ((script.match(/;/g) || []).length <= 1 && script.indexOf("return") == -1) {
						script = "return " + script;
					}

					var valueFunction;

 					try {
						valueFunction = new Function("datasources", script);
					}
					catch (e) {
						var literalText = currentSettings[settingDef.name].replace(/"/g, '\\"').replace(/[\r\n]/g, ' \\\n');

						// If the value function cannot be created, then go ahead and treat it as literal text
						valueFunction = new Function("datasources", "return \"" + literalText + "\";");
					}

					self.calculatedSettingScripts[settingDef.name] = valueFunction;
					self.processCalculatedSetting(settingDef.name);

					// Are there any datasources we need to be subscribed to?
					var matches;

					while (matches = datasourceRegex.exec(script)) {
						var dsName = (matches[1] || matches[2]);
						var refreshSettingNames = self.datasourceRefreshNotifications[dsName];

						if (_.isUndefined(refreshSettingNames)) {
							refreshSettingNames = [];
							self.datasourceRefreshNotifications[dsName] = refreshSettingNames;
						}

						if(_.indexOf(refreshSettingNames, settingDef.name) == -1) // Only subscribe to this notification once.
						{
							refreshSettingNames.push(settingDef.name);
						}
					}
				}
			}
		});
	}

	this._heightUpdate = ko.observable();
	this.height = ko.computed({
		read: function () {
			self._heightUpdate();

			if (!_.isUndefined(self.widgetInstance) && _.isFunction(self.widgetInstance.getHeight)) {
				return self.widgetInstance.getHeight();
			}

			return 1;
		}
	});

	this.displayTitle = ko.computed(function()
	{
		var settings = self.settings();
		var titleSetting = settings ? settings.title : undefined;
		if(_.isFunction(titleSetting))
		{
			titleSetting = titleSetting();
		}

		if(titleSetting && titleSetting.length)
		{
			return titleSetting;
		}

		var fallbackTitle = self.title();
		if(fallbackTitle && fallbackTitle.length)
		{
			return fallbackTitle;
		}

		var type = self.type();
		if(type && widgetPlugins[type] && widgetPlugins[type].display_name)
		{
			return widgetPlugins[type].display_name;
		}

		return "";
	});

	this.shouldRender = ko.observable(false);
	this.render = function (element) {
		self.shouldRender(false);
		if (!_.isUndefined(self.widgetInstance) && _.isFunction(self.widgetInstance.render)) {
			self.widgetInstance.render(element);
			self.updateCalculatedSettings();
		}
	}

	this.dispose = function () {
		disposeWidgetInstance();
		self.shouldRender(false);
		self.datasourceRefreshNotifications = {};
		self.calculatedSettingScripts = {};
	}

	this.serialize = function () {
		return {
			title: self.title(),
			type: self.type(),
			settings: self.settings()
		};
	}

	this.deserialize = function (object) {
		self.title(object.title);
		self.settings(object.settings);
		self.type(object.type);
	}
}

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
	var widgetCategoryManager = new WidgetCategoryManager(theFreeboardModel, widgetPlugins);

	theFreeboardModel.showWidgetCategoryManager = function()
	{
		widgetCategoryManager.showWidgetCategoryManager();
	};

	var currentStyle = {
		values: {
			"font-family": '"HelveticaNeue-UltraLight", "Helvetica Neue Ultra Light", "Helvetica Neue", sans-serif',
			"color"      : "#d3d4d4",
			"font-weight": 100
		}
	};

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
							settings = viewModel.settings();
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

if (options.type == 'widget' && options.operation == 'edit' && instanceType === 'fast_frame_control') {
						return;
					}

					if (options.type == 'widget' && options.operation == 'edit' && (instanceType === 'time_plot_uplot' || instanceType === 'xy_plot_uplot' || instanceType === 'fast_frame_plot' || instanceType === 'vertical_gauge' || instanceType === 'horizontal_gauge' || instanceType === 'radial_arc_gauge' || instanceType === 'radial_needle_gauge' || instanceType === 'donut_gauge')) {
						freeboard.openIntegratedPlotEditor(viewModel, instanceType);
						return;
					}

					var integratedEditorTypes = ['time_plot_uplot', 'xy_plot_uplot', 'fast_frame_plot',
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
								if(_.isUndefined(newSettings.settings.title) || newSettings.settings.title === "")
								{
									var widgetType = widgetPlugins[newSettings.type];
									if(widgetType && widgetType.display_name)
									{
										newSettings.settings.title = widgetType.display_name;
									}
								}
								var newViewModel = new WidgetModel(theFreeboardModel, widgetPlugins);
								newViewModel.settings(newSettings.settings);
								newViewModel.type(newSettings.type);
								if((_.isUndefined(newSettings.settings.title) || newSettings.settings.title === "") && widgetPlugins[newSettings.type] && widgetPlugins[newSettings.type].display_name)
								{
									newViewModel.title(widgetPlugins[newSettings.type].display_name);
								}

								viewModel.widgets.push(newViewModel);

								freeboardUI.attachWidgetEditIcons(element);

									if (newSettings.type === 'time_plot_uplot' || newSettings.type === 'xy_plot_uplot' || newSettings.type === 'fast_frame_plot' || newSettings.type === 'vertical_gauge' || newSettings.type === 'horizontal_gauge' || newSettings.type === 'radial_arc_gauge' || newSettings.type === 'radial_needle_gauge' || newSettings.type === 'donut_gauge') {
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

								viewModel.type(newSettings.type);
								viewModel.settings(newSettings.settings);
							}
						}
					}, options.type === 'widget', options.type === 'widget' ? integratedEditorTypes : null);
				}
			});
		}
	}

	function openWidgetDocs(typeName)
	{
		// Widget docs open in a dedicated tab (menu/toolbar integration).
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

	ko.bindingHandlers.widgetDocs = {
		init: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			$(element).click(function(event)
			{
				event.preventDefault();
				var typeName = (viewModel && _.isFunction(viewModel.type)) ? viewModel.type() : null;
				openWidgetDocs(typeName);
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

			var $section = $(element).find('section').addClass('widget-sort-section');

			function ddLog() {
				var msg = '[drag-drop] ' + Array.prototype.join.call(arguments, ' ');
				if (window.api && window.api.logger) { window.api.logger.log('log', [msg]); }
			}

			$section.sortable({
				connectWith     : '.widget-sort-section',
				handle          : '.sub-section-tools',
				placeholder     : 'sub-section-sortable-placeholder',
				forcePlaceholderSize: true,
				tolerance       : 'pointer',
				scroll          : false,
				disabled        : !theFreeboardModel.isEditing(),
				start: function(event, ui) {
					ui.placeholder.height(ui.item.outerHeight());
					var w = ui.item.data('ko-widget');
					var p = ui.item.data('ko-pane');
					ddLog('start | widget=' + (w ? w.type() : 'NULL') +
						' pane="' + (p ? p.title() : 'NULL') + '"' +
						' ko-widget set=' + !!w + ' ko-pane set=' + !!p);
				},
				receive: function(event, ui) {
					var widget     = ui.item.data('ko-widget');
					var sourcePane = ui.item.data('ko-pane');
					ddLog('receive | widget=' + (widget ? widget.type() : 'NULL') +
						' sourcePane="' + (sourcePane ? sourcePane.title() : 'NULL') + '"' +
						' targetPane="' + viewModel.title() + '"');
					if (!widget || !sourcePane) {
						ddLog('receive | ABORT: missing widget or sourcePane');
						return;
					}
					var newIndex = $(this).children('.sub-section').index(ui.item[0]);
					ddLog('receive | newIndex=' + newIndex +
						' targetChildren=' + $(this).children('.sub-section').length +
						' sourceWidgets(before)=' + sourcePane.widgets().length +
						' targetWidgets(before)=' + viewModel.widgets().length);
					// Detach the jQuery UI-repositioned node before Knockout array ops.
					// jQuery UI's _clear() places ui.item back in the DOM (before the
					// placeholder) prior to firing receive/update; without detaching here,
					// Knockout's removeNode leaves that node as a visible ghost widget.
					ui.item.detach();
					sourcePane.widgets.remove(widget);
					ddLog('receive | sourceWidgets(after remove)=' + sourcePane.widgets().length);
					viewModel.widgets.splice(newIndex, 0, widget);
					ddLog('receive | targetWidgets(after splice)=' + viewModel.widgets().length +
						' shouldRender(before)=' + widget.shouldRender());
					widget.shouldRender(true);
					ddLog('receive | shouldRender(after)=' + widget.shouldRender() + ' — done');
				},
				update: function(event, ui) {
					// ui.sender is set on the RECEIVING list, not the SENDING list.
					// When an item leaves this pane for another, update fires here with
					// ui.sender=null and ui.item already gone → newIndex=-1.  Skip it;
					// the receive handler on the target pane owns the cross-pane move.
					if (ui.sender) return; // skip target's update — handled by receive
					var widget = ui.item.data('ko-widget');
					var newIndex = $(this).children('.sub-section').index(ui.item[0]);
					ddLog('update | newIndex=' + newIndex + ' sender=' + !!ui.sender +
						' widget=' + (widget ? widget.type() : 'NULL'));
					if (!widget || newIndex === -1) return; // -1 = source exit for cross-pane drag
					ddLog('update | within-pane reorder widgets(before)=' + viewModel.widgets().length);
					ui.item.detach(); // prevent ghost — same reason as receive handler
					viewModel.widgets.remove(widget);
					viewModel.widgets.splice(newIndex, 0, widget);
					ddLog('update | widgets(after)=' + viewModel.widgets().length);
					widget.shouldRender(true);
					ddLog('update | done');
				}
			});

			var editSub = theFreeboardModel.isEditing.subscribe(function(editing) {
				if ($section.data('ui-sortable')) {
					$section.sortable(editing ? 'enable' : 'disable');
				}
			});

			ko.utils.domNodeDisposal.addDisposeCallback(element, function() {
				editSub.dispose();
				$section.sortable('destroy');
			});
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
			// Store references on the .sub-section wrapper so drag-and-drop handlers can look them up
			$(element).closest('.sub-section').data('ko-widget', viewModel).data('ko-pane', bindingContext.$parent);
			var _ddMsg = '[drag-drop] widget.init | type=' + viewModel.type() + ' shouldRender=' + viewModel.shouldRender();
			if (window.api && window.api.logger) { window.api.logger.log('log', [_ddMsg]); }
		},
		update: function(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext)
		{
			var _ddMsg = '[drag-drop] widget.update | type=' + viewModel.type() + ' shouldRender=' + viewModel.shouldRender();
			if (window.api && window.api.logger) { window.api.logger.log('log', [_ddMsg]); }
			if(viewModel.shouldRender())
			{
				$(element).empty();
				viewModel.render(element);
			}
		}
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
		showWidgetCategoryManager : function()
		{
			widgetCategoryManager.showWidgetCategoryManager();
		},
		getWidgetCategoryConfig : function()
		{
			return getWidgetCategoryConfig();
		},
		setWidgetCategoryConfig : function(config)
		{
			saveWidgetCategoryConfig(config);
		},
		openIntegratedPlotEditor: function(widgetModel, type)
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

				var titleInput = createInput('Title', 'title', 'text', left);
				var historyInput = createInput('History Length', 'historyLength', 'number', left);
				var refreshInput = createInput('Refresh Rate (ms)', 'refreshRate', 'number', left);
				var xLabelInput = createInput('X Label', 'xLabel', 'text', left);
				var yLabelInput = createInput('Y Label', 'yLabel', 'text', left);
				var xMinInput = createInput('X Min', 'xMin', 'number', left);
				var xMaxInput = createInput('X Max', 'xMax', 'number', left);
				var yMinInput = createInput('Y Min', 'yMin', 'number', left);
				var yMaxInput = createInput('Y Max', 'yMax', 'number', left);

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
				opSelect.val(def.op || 'identity');
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
				removeBtn.on('click', function() {
					seriesDefs.splice(index, 1);
					renderChannelList();
				});

				var refreshDatasourceSelect = function(selectEl, selected) {
					selectEl.empty();
					selectEl.append('<option value="">Select datasource</option>');
					shared.listDatasources().forEach(function(ds) {
						selectEl.append($('<option>').val(ds.name).text(ds.name));
					});
					if (selected && selectEl.find('option[value="' + selected + '"]').length) {
						selectEl.val(selected);
					}
				};

				var populateVariables = async function(dsName, deviceVal, varEl, selectedVar) {
					varEl.empty();
					if (!dsName) {
						varEl.append('<option value="">No datasource</option>');
						return;
					}
					var dsType = shared.getDatasourceType(dsName);
					if (dsType === 'signal_generator_datasource') {
						varEl.append('<option value="0">Signal</option>');
						if (selectedVar !== undefined && selectedVar !== null) varEl.val(selectedVar);
						return;
					}
					if (dsType === 'fast_frame_datasource' || dsType === 'serialport_datasource') {
						var headers = await shared.fetchDatasourceHeaders(dsName);
						var count = Array.isArray(headers) ? headers.length : 0;
						if (!count) {
							count = await shared.fetchDatasourceChannelCount(dsName, dsType);
						}
						if (!count) {
							count = 4;
						}
						for (var i = 0; i < count; i++) {
							var label = headers[i] || 'Channel ' + (i + 1);
							varEl.append($('<option>').val(i.toString()).text(label));
						}
					} else if (dsType === 'can_datasource') {
						for (var j = 0; j < 4; j++) {
							varEl.append($('<option>').val('var' + j).text('Variable ' + j));
						}
					} else {
						varEl.append('<option value="">Unknown datasource type</option>');
					}
					if (selectedVar !== undefined && selectedVar !== null && varEl.find('option[value="' + selectedVar + '"]').length) {
						varEl.val(selectedVar);
					}
				};

				var refreshDeviceSelect = function(dsName, deviceEl, selectedDevice) {
					var dsType = shared.getDatasourceType(dsName);
					deviceEl.empty();
					if (dsType === 'can_datasource') {
						deviceEl.append('<option value="">Select device</option>');
						if (selectedDevice) {
							deviceEl.append($('<option>').val(selectedDevice).text(selectedDevice));
							deviceEl.val(selectedDevice);
						}
						deviceEl.show();
					} else {
						deviceEl.hide();
					}
				};

				opSelect.on('change', function() {
					sourceBRow.toggle(opSelect.val() === 'mulvar');
					paramInput.toggle(opSelect.val() === 'scale' || opSelect.val() === 'offset');
				});

				sourceASelect.on('change', function() {
					refreshDeviceSelect(sourceASelect.val(), sourceADevice, def.a?.device);
					populateVariables(sourceASelect.val(), sourceADevice.val(), sourceAVar, def.a?.var).catch(function() {});
				});
				sourceADevice.on('change', function() {
					populateVariables(sourceASelect.val(), sourceADevice.val(), sourceAVar, sourceAVar.val()).catch(function() {});
				});
				sourceBSelect.on('change', function() {
					refreshDeviceSelect(sourceBSelect.val(), sourceBDevice, def.b?.device);
					populateVariables(sourceBSelect.val(), sourceBDevice.val(), sourceBVar, def.b?.var).catch(function() {});
				});
				sourceBDevice.on('change', function() {
					populateVariables(sourceBSelect.val(), sourceBDevice.val(), sourceBVar, sourceBVar.val()).catch(function() {});
				});

				refreshDatasourceSelect(sourceASelect, def.a?.ds);
				refreshDatasourceSelect(sourceBSelect, def.b?.ds);
				refreshDeviceSelect(sourceASelect.val(), sourceADevice, def.a?.device);
				refreshDeviceSelect(sourceBSelect.val(), sourceBDevice, def.b?.device);
				populateVariables(sourceASelect.val(), sourceADevice.val(), sourceAVar, def.a?.var).catch(function() {});
				populateVariables(sourceBSelect.val(), sourceBDevice.val(), sourceBVar, def.b?.var).catch(function() {});
				sourceBRow.toggle(opSelect.val() === 'mulvar');
				paramInput.toggle(opSelect.val() === 'scale' || opSelect.val() === 'offset');

				row.append(labelRow, opRow, sourceARow, sourceBRow, removeBtn);
				return { row, labelInput, opSelect, paramInput, sourceASelect, sourceADevice, sourceAVar, sourceBSelect, sourceBDevice, sourceBVar };
			};

			var channelRows = [];
			var renderChannelList = function() {
				channelList.empty();
				channelRows = [];
				seriesDefs.forEach(function(def, idx) {
					var item = createChannelRow(def, idx);
					channelList.append(item.row);
					channelRows.push(item);
				});
			};

			addChannelButton.on('click', function() {
				seriesDefs.push({ label: '', op: 'identity', param: 0, a: { ds: '', type: '', device: null, var: null }, b: null });
				renderChannelList();
			});

			renderChannelList();

			new DialogBox(form, "Edit Widget", "Save", "Cancel", function() {
				var newDefs = [];
				channelList.children().each(function(index) {
					var rowEl = $(this);
					var label = rowEl.find('input[type="text"]').first().val();
					var op = rowEl.find('select').first().val();
					var param = parseFloat(rowEl.find('input[type="number"]').first().val()) || 0;
					var selects = rowEl.find('select');
					var aDs = selects.eq(1).val();
					var aDevice = selects.eq(2).val();
					var aVar = selects.eq(3).val();
					var bDs = selects.eq(4).val();
					var bDevice = selects.eq(5).val();
					var bVar = selects.eq(6).val();
					var def = {
						label: label || '',
						op: op,
						param: param,
						a: { ds: aDs, type: shared.getDatasourceType(aDs), device: aDevice || null, var: aVar }
					};
					if (op === 'mulvar') {
						def.b = { ds: bDs, type: shared.getDatasourceType(bDs), device: bDevice || null, var: bVar };
					} else {
						def.b = null;
					}
					newDefs.push(def);
				});

				var newSettings = {
					title: titleInput.val(),
					historyLength: parseInt(historyInput.val()) || 200,
					refreshRate: parseInt(refreshInput.val()) || 1000,
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
		},
		getPlotEditorShared : function()
		{
			return plotEditorShared;
		},
		getWidgetCategoryForType : function(typeName, pluginType, config)
		{
			return getWidgetCategoryForType(typeName, pluginType, config);
		}
	};
}());

$.extend(freeboard, jQuery.eventEmitter);
