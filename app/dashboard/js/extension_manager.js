(function () {
    'use strict';

    var MODAL_ID = 'extension-manager-modal';

    function getApi() {
        return window.api && window.api.extensions && window.api.extensions.manager
            ? window.api.extensions.manager
            : null;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showNotice(el, message, variant) {
        el.innerHTML = '<div class="alert alert-' + (variant || 'info') + ' py-1 px-2 mb-2" role="alert">' + escapeHtml(message) + '</div>';
    }

    function renderExtension(ext) {
        var row = document.createElement('div');
        row.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-2';
        row.dataset.extId = ext.id;

        var info = document.createElement('div');
        info.className = 'flex-grow-1';
        info.innerHTML =
            '<strong>' + escapeHtml(ext.displayName) + '</strong>' +
            ' <span class="badge bg-secondary ms-1">' + escapeHtml(ext.version || '0.0.0') + '</span>' +
            '<div class="text-muted small">' + escapeHtml(ext.id) + '</div>';

        var controls = document.createElement('div');
        controls.className = 'd-flex gap-1 flex-shrink-0';

        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-sm ' + (ext.enabled ? 'btn-outline-warning' : 'btn-outline-success');
        toggleBtn.textContent = ext.enabled ? 'Disable' : 'Enable';
        toggleBtn.title = ext.enabled ? 'Disable this extension (restart required)' : 'Enable this extension (restart required)';

        var removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-sm btn-outline-danger';
        removeBtn.textContent = 'Uninstall';
        removeBtn.title = 'Remove this extension from managed storage (restart required)';

        controls.appendChild(toggleBtn);
        controls.appendChild(removeBtn);
        row.appendChild(info);
        row.appendChild(controls);

        return { row: row, toggleBtn: toggleBtn, removeBtn: removeBtn };
    }

    function buildModal() {
        var existing = document.getElementById(MODAL_ID);
        if (existing) return existing;

        var modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.setAttribute('aria-labelledby', MODAL_ID + '-label');
        modal.setAttribute('aria-hidden', 'true');

        modal.innerHTML = [
            '<div class="modal-dialog modal-lg modal-dialog-scrollable">',
            '  <div class="modal-content">',
            '    <div class="modal-header">',
            '      <h5 class="modal-title" id="' + MODAL_ID + '-label">Extension Manager</h5>',
            '      <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>',
            '    </div>',
            '    <div class="modal-body">',
            '      <div id="ext-manager-notice"></div>',
            '      <div id="ext-manager-list" class="list-group mb-3"></div>',
            '      <div id="ext-manager-empty" class="text-muted small" hidden>No extensions installed.</div>',
            '    </div>',
            '    <div class="modal-footer justify-content-between">',
            '      <button type="button" id="ext-manager-install-btn" class="btn btn-primary">',
            '        Install from file…',
            '      </button>',
            '      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>',
            '    </div>',
            '  </div>',
            '</div>',
        ].join('\n');

        document.body.appendChild(modal);
        return modal;
    }

    function refreshList(manager, listEl, emptyEl, noticeEl) {
        manager.list().then(function (extensions) {
            listEl.innerHTML = '';
            if (!extensions || !extensions.length) {
                emptyEl.hidden = false;
                return;
            }
            emptyEl.hidden = true;
            extensions.forEach(function (ext) {
                var rendered = renderExtension(ext);

                rendered.toggleBtn.addEventListener('click', function () {
                    var op = ext.enabled ? manager.disable(ext.id) : manager.enable(ext.id);
                    op.then(function (result) {
                        if (result && result.ok) {
                            showNotice(noticeEl, 'Extension "' + ext.displayName + '" ' + (ext.enabled ? 'disabled' : 'enabled') + '. Restart the app for the change to take effect.', 'success');
                            refreshList(manager, listEl, emptyEl, noticeEl);
                        } else {
                            showNotice(noticeEl, (result && result.error) || 'Operation failed.', 'danger');
                        }
                    }).catch(function (err) {
                        showNotice(noticeEl, String(err && err.message || err), 'danger');
                    });
                });

                rendered.removeBtn.addEventListener('click', function () {
                    manager.uninstall(ext.id).then(function (result) {
                        if (result && result.ok) {
                            showNotice(noticeEl, 'Extension "' + ext.displayName + '" uninstalled. Restart the app for the change to take effect.', 'success');
                            refreshList(manager, listEl, emptyEl, noticeEl);
                        } else {
                            showNotice(noticeEl, (result && result.error) || 'Uninstall failed.', 'danger');
                        }
                    }).catch(function (err) {
                        showNotice(noticeEl, String(err && err.message || err), 'danger');
                    });
                });

                listEl.appendChild(rendered.row);
            });
        }).catch(function (err) {
            showNotice(noticeEl, 'Failed to load installed extensions: ' + String(err && err.message || err), 'danger');
        });
    }

    function openManager() {
        var manager = getApi();
        if (!manager) {
            console.warn('[ExtensionManager] window.api.extensions.manager not available');
            return;
        }

        var modalEl = buildModal();
        var listEl = document.getElementById('ext-manager-list');
        var emptyEl = document.getElementById('ext-manager-empty');
        var noticeEl = document.getElementById('ext-manager-notice');
        var installBtn = document.getElementById('ext-manager-install-btn');

        noticeEl.innerHTML = '';
        refreshList(manager, listEl, emptyEl, noticeEl);

        installBtn.onclick = function () {
            manager.chooseBundle().then(function (bundlePath) {
                if (!bundlePath) return;
                manager.install(bundlePath).then(function (result) {
                    if (result && result.ok) {
                        showNotice(noticeEl, 'Extension "' + result.id + '@' + result.version + '" installed. Restart the app for the change to take effect.', 'success');
                        refreshList(manager, listEl, emptyEl, noticeEl);
                    } else {
                        showNotice(noticeEl, (result && result.error) || 'Install failed.', 'danger');
                    }
                }).catch(function (err) {
                    showNotice(noticeEl, String(err && err.message || err), 'danger');
                });
            });
        };

        if (window.bootstrap && window.bootstrap.Modal) {
            var bsModal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
            bsModal.show();
        } else {
            // Fallback: show modal manually without Bootstrap JS.
            modalEl.style.display = 'block';
            modalEl.classList.add('show');
            document.body.classList.add('modal-open');
            var closeBtn = modalEl.querySelector('[data-bs-dismiss="modal"]');
            if (closeBtn) {
                closeBtn.onclick = function () {
                    modalEl.style.display = 'none';
                    modalEl.classList.remove('show');
                    document.body.classList.remove('modal-open');
                };
            }
        }
    }

    function init() {
        var manager = getApi();
        if (!manager || typeof manager.onOpen !== 'function') return;
        manager.onOpen(openManager);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
