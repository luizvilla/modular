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
					handle: '.pane-header h1, .pane-header h1 *'
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

		var elementHeight = Number($(element).attr("data-sizey"));
		var elementWidth = Number($(element).attr("data-sizex"));

		if(calculatedHeight != elementHeight || viewModel.col_width() !=  elementWidth)
		{
			grid.resize_widget($(element), viewModel.col_width(), calculatedHeight, function(){
				grid.set_dom_grid_height();
				notifyPaneSizeChanged(viewModel);
			});
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
			$('<div class="pane-resize-handle pane-resize-' + handle.direction + '"></div>')
				.attr("title", handle.title)
				.attr("data-resize-dir", handle.direction)
				.hide()
				.appendTo($pane);
		});

		$pane.on("mousedown.freeboard-pane-resize", ".pane-resize-handle", function(event)
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

		if(_.isNumber(paneModel.row) && _.isNumber(paneModel.col)) // Support for legacy format
		{
			var obj = {};
			obj[cols] = paneModel.row;
			paneModel.row = obj;


			obj = {};
			obj[cols] = paneModel.col;
			paneModel.col = obj;
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
			grid.remove_widget(element);
		},
		removeAllPanes : function()
		{
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
