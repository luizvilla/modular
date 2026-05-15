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
        el.innerHTML = '<div class="alert alert-' + (variant || 'info') + ' py-1 px-2 mb-2" role="alert">' +
            escapeHtml(message) + '</div>';
    }

    function renderInstalledEntry(ext, manager, noticeEl, onChanged) {
        var row = document.createElement('div');
        row.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';

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
        toggleBtn.title = ext.enabled
            ? 'Disable this extension (restart required)'
            : 'Enable this extension (restart required)';

        var removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-sm btn-outline-danger';
        removeBtn.textContent = 'Uninstall';

        toggleBtn.addEventListener('click', function () {
            var op = ext.enabled ? manager.disable(ext.id) : manager.enable(ext.id);
            op.then(function (result) {
                if (result && result.ok) {
                    showNotice(noticeEl,
                        '"' + ext.displayName + '" ' + (ext.enabled ? 'disabled' : 'enabled') +
                        '. Restart the app for the change to take effect.', 'success');
                    onChanged();
                } else {
                    showNotice(noticeEl, (result && result.error) || 'Operation failed.', 'danger');
                }
            }).catch(function (err) {
                showNotice(noticeEl, String(err && err.message || err), 'danger');
            });
        });

        removeBtn.addEventListener('click', function () {
            manager.uninstall(ext.id).then(function (result) {
                if (result && result.ok) {
                    showNotice(noticeEl,
                        '"' + ext.displayName + '" uninstalled. Restart the app for the change to take effect.',
                        'success');
                    onChanged();
                } else {
                    showNotice(noticeEl, (result && result.error) || 'Uninstall failed.', 'danger');
                }
            }).catch(function (err) {
                showNotice(noticeEl, String(err && err.message || err), 'danger');
            });
        });

        controls.appendChild(toggleBtn);
        controls.appendChild(removeBtn);
        row.appendChild(info);
        row.appendChild(controls);
        return row;
    }

    function renderBuiltinEntry(ext) {
        var row = document.createElement('div');
        row.className = 'list-group-item d-flex justify-content-between align-items-center gap-2';
        row.style.opacity = '0.8';

        var info = document.createElement('div');
        info.className = 'flex-grow-1';
        info.innerHTML =
            '<strong>' + escapeHtml(ext.displayName) + '</strong>' +
            ' <span class="badge bg-secondary ms-1">' + escapeHtml(ext.version || '0.0.0') + '</span>' +
            ' <span class="badge bg-info text-dark ms-1">Built-in</span>' +
            '<div class="text-muted small">' + escapeHtml(ext.id) +
            (ext.enabled ? '' : ' &mdash; <em>disabled</em>') + '</div>';

        row.appendChild(info);
        return row;
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
            '      <h6 class="text-muted mb-1" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Installed</h6>',
            '      <div id="ext-manager-installed" class="list-group mb-1"></div>',
            '      <div id="ext-manager-empty" class="text-muted small mb-3 ps-1">No extensions installed.</div>',
            '      <h6 class="text-muted mb-1 mt-3" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Built-in</h6>',
            '      <div id="ext-manager-builtin" class="list-group"></div>',
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

    function refreshList(manager, installedEl, builtinEl, emptyEl, noticeEl) {
        manager.list().then(function (extensions) {
            installedEl.innerHTML = '';
            builtinEl.innerHTML = '';

            var installed = (extensions || []).filter(function (e) { return e.source === 'installed'; });
            var builtins = (extensions || []).filter(function (e) { return e.source !== 'installed'; });

            emptyEl.hidden = installed.length > 0;

            installed.forEach(function (ext) {
                installedEl.appendChild(renderInstalledEntry(ext, manager, noticeEl, function () {
                    refreshList(manager, installedEl, builtinEl, emptyEl, noticeEl);
                }));
            });

            builtins.forEach(function (ext) {
                builtinEl.appendChild(renderBuiltinEntry(ext));
            });
        }).catch(function (err) {
            showNotice(noticeEl, 'Failed to load extensions: ' + String(err && err.message || err), 'danger');
        });
    }

    function openManager() {
        var manager = getApi();
        if (!manager) {
            console.warn('[ExtensionManager] window.api.extensions.manager not available');
            return;
        }

        buildModal();
        var installedEl = document.getElementById('ext-manager-installed');
        var builtinEl = document.getElementById('ext-manager-builtin');
        var emptyEl = document.getElementById('ext-manager-empty');
        var noticeEl = document.getElementById('ext-manager-notice');
        var installBtn = document.getElementById('ext-manager-install-btn');

        noticeEl.innerHTML = '';
        refreshList(manager, installedEl, builtinEl, emptyEl, noticeEl);

        installBtn.onclick = function () {
            manager.chooseBundle().then(function (bundlePath) {
                if (!bundlePath) return;
                manager.install(bundlePath).then(function (result) {
                    if (result && result.ok) {
                        showNotice(noticeEl,
                            '"' + result.id + '@' + result.version + '" installed. Restart the app for the change to take effect.',
                            'success');
                        refreshList(manager, installedEl, builtinEl, emptyEl, noticeEl);
                    } else {
                        showNotice(noticeEl, (result && result.error) || 'Install failed.', 'danger');
                    }
                }).catch(function (err) {
                    showNotice(noticeEl, String(err && err.message || err), 'danger');
                });
            });
        };

        var modalEl = document.getElementById(MODAL_ID);
        if (window.bootstrap && window.bootstrap.Modal) {
            window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } else {
            modalEl.style.display = 'block';
            modalEl.classList.add('show');
            document.body.classList.add('modal-open');
            modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach(function (btn) {
                btn.onclick = function () {
                    modalEl.style.display = 'none';
                    modalEl.classList.remove('show');
                    document.body.classList.remove('modal-open');
                };
            });
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
