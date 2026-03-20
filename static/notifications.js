/**
 * notifications.js — Centralized feedback/notification system.
 *
 * Provides:
 *  - showToast(message, type)   → Non-blocking snackbar (success, error, warning, info)
 *  - showModal(options)         → Blocking dialog with confirm/cancel
 *  - showInlineError(el, msg)   → Field-level validation message
 *
 * Usage:
 *  showToast('Draft saved', 'success');
 *  showModal({ title: 'Delete?', body: '...', onConfirm: () => {} });
 */

// ─── Toast System ──────────────────────────────────

const TOAST_DURATION = 4000;

function _ensureContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, type = 'info') {
    const container = _ensureContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: 'ph-check-circle',
        error: 'ph-x-circle',
        warning: 'ph-warning',
        info: 'ph-info',
    };

    toast.innerHTML = `
        <i class="ph-fill ${icons[type] || icons.info}"></i>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="ph ph-x"></i>
        </button>
    `;

    container.appendChild(toast);

    // Trigger enter animation
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, TOAST_DURATION);
}


// ─── Modal System ──────────────────────────────────

function _ensureModalOverlay() {
    let overlay = document.getElementById('modal-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modal-overlay';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-content" id="modal-content"></div>`;
        document.body.appendChild(overlay);
    }
    return overlay;
}

/**
 * Show a blocking modal dialog.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.body - HTML body content
 * @param {string} [options.confirmText='Confirm']
 * @param {string} [options.cancelText='Cancel']
 * @param {string} [options.confirmClass='btn-primary'] - CSS class for confirm button
 * @param {Function} [options.onConfirm] - called on confirm
 * @param {Function} [options.onCancel] - called on cancel
 * @param {boolean} [options.showCancel=true]
 * @param {boolean} [options.dangerous=false] - highlight destructive action
 */
function showModal(options) {
    const overlay = _ensureModalOverlay();
    const content = document.getElementById('modal-content');
    const confirmClass = options.dangerous ? 'btn-danger' : (options.confirmClass || 'btn-primary');

    content.innerHTML = `
        <div class="modal-header">
            <h3>${options.title || 'Confirm'}</h3>
            <button class="modal-close" id="modal-close-btn"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            ${options.body || ''}
        </div>
        <div class="modal-footer">
            ${options.showCancel !== false ? `<button class="btn-secondary" id="modal-cancel-btn">${options.cancelText || 'Cancel'}</button>` : ''}
            <button class="${confirmClass}" id="modal-confirm-btn">${options.confirmText || 'Confirm'}</button>
        </div>
    `;

    overlay.classList.add('modal-visible');

    const close = () => {
        overlay.classList.remove('modal-visible');
    };

    document.getElementById('modal-confirm-btn').onclick = () => {
        close();
        if (options.onConfirm) options.onConfirm();
    };

    const cancelBtn = document.getElementById('modal-cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            close();
            if (options.onCancel) options.onCancel();
        };
    }

    document.getElementById('modal-close-btn').onclick = () => {
        close();
        if (options.onCancel) options.onCancel();
    };

    // Close on overlay click
    overlay.onclick = (e) => {
        if (e.target === overlay) {
            close();
            if (options.onCancel) options.onCancel();
        }
    };
}


// ─── Confirmation Shorthand ────────────────────────

function confirmAction(title, body, onConfirm, dangerous = false) {
    showModal({
        title, body, onConfirm, dangerous,
        confirmText: dangerous ? 'Delete' : 'Confirm',
    });
}


// ─── Inline Validation ─────────────────────────────

function showInlineError(element, message) {
    clearInlineError(element);
    const err = document.createElement('div');
    err.className = 'inline-error';
    err.textContent = message;
    element.parentElement.appendChild(err);
    element.classList.add('input-error');
}

function clearInlineError(element) {
    const existing = element.parentElement.querySelector('.inline-error');
    if (existing) existing.remove();
    element.classList.remove('input-error');
}


// ─── Export to global scope ────────────────────────
window.showToast = showToast;
window.showModal = showModal;
window.confirmAction = confirmAction;
window.showInlineError = showInlineError;
window.clearInlineError = clearInlineError;
