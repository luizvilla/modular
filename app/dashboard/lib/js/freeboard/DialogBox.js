function DialogBox(contentElement, title, okTitle, cancelTitle, okCallback)
{
	var modal_width = 900;

	// Initialize our modal overlay
	var overlay = $('<div id="modal_overlay" style="display:none;"></div>');

	var modalDialog = $('<div class="modal"></div>');

	function closeModal()
	{
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

	$(document).off('keydown.dialog').on('keydown.dialog', function(e)
	{
		if($('#modal_overlay').length === 0) return;

		var isEnter = (e.key === 'Enter' || e.keyCode === 13);
		var isEscape = (e.key === 'Escape' || e.keyCode === 27);
		var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
		var wantsSave = isEnter && !e.altKey && !e.shiftKey && (!e.ctrlKey && !e.metaKey || e.ctrlKey || e.metaKey);

		if(wantsSave)
		{
			if(tag === 'TEXTAREA' && !e.ctrlKey && !e.metaKey) return;
			var okBtn = $('#dialog-ok', overlay);
			if(okBtn.length && okBtn.is(':visible'))
			{
				var $fields = $('input, textarea, select', overlay).filter(function()
				{
					return $(this).closest('#setting-row-plugin-types').length === 0;
				});
				$fields.trigger('change');
				okBtn.trigger('click');
				e.preventDefault();
			}
			return;
		}

		if(isEscape)
		{
			var cancelBtn = $('#dialog-cancel', overlay);
			if(cancelBtn.length && cancelBtn.is(':visible'))
			{
				cancelBtn.trigger('click');
				e.preventDefault();
			}
		}
	});

	overlay.append(modalDialog);
	$("body").append(overlay);
	overlay.fadeIn(200);
}
