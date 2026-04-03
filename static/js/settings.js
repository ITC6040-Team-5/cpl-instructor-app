/**
 * settings.js — Admin settings tab and knowledge base CRUD for the NUPathway SPA.
 *
 * Exports: loadSettingsTab, loadKnowledgeBase
 * Assigns window.deleteKBEntry (called from inline onclick in dynamically generated HTML).
 */

import { escapeHtml, getAdminHeaders } from './utils.js';
import { handleAdminLogout } from './auth.js';

export async function loadSettingsTab() {
    try {
        const resp = await fetch('/api/admin/settings', { headers: getAdminHeaders() });
        if (resp.status === 401) { handleAdminLogout(); return; }
        const settings = await resp.json();

        const el = (id) => document.getElementById(id);
        if (el('setting-university-name')) el('setting-university-name').value = settings.university_name || '';
        if (el('setting-draft-threshold')) el('setting-draft-threshold').value = settings.draft_save_threshold || '30';
        if (el('setting-submit-threshold')) el('setting-submit-threshold').value = settings.submit_threshold || '80';
        if (el('setting-delete-threshold')) el('setting-delete-threshold').value = settings.delete_allowed_below || '50';
        if (el('setting-system-prompt-addendum')) el('setting-system-prompt-addendum').value = settings.system_prompt_addendum || '';

        // Toggles
        const strict = el('toggle-strict-domain');
        if (strict) strict.classList.toggle('active', settings.strict_domain_mode === 'true');
        const evidence = el('toggle-require-evidence');
        if (evidence) evidence.classList.toggle('active', settings.require_evidence_links === 'true');
    } catch (e) {
        console.error('Failed to load settings', e);
    }
    // Load knowledge base entries
    loadKnowledgeBase();
}

export async function loadKnowledgeBase() {
    const tbody = document.getElementById('kb-table-body');
    if (!tbody) return;
    try {
        const resp = await fetch('/api/admin/knowledge', { headers: getAdminHeaders() });
        if (!resp.ok) return;
        const data = await resp.json();
        const entries = data.entries || [];
        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted p-4">No entries yet.</td></tr>';
            return;
        }
        tbody.innerHTML = entries.map(e => `
            <tr>
                <td><span class="badge ${e.entry_type === 'course' ? 'blue' : e.entry_type === 'policy' ? 'yellow' : 'gray'}">${e.entry_type}</span></td>
                <td class="font-mono text-sm">${e.entry_key || '—'}</td>
                <td>${escapeHtml(e.title)}</td>
                <td class="text-sm text-muted" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(e.content)}">${escapeHtml(e.content.substring(0, 80))}${e.content.length > 80 ? '…' : ''}</td>
                <td><button class="btn-icon text-danger" onclick="deleteKBEntry(${e.id})"><i class="ph ph-trash"></i></button></td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Failed to load knowledge base', e);
    }
}

// Assigned to window — called from inline onclick in dynamically generated HTML
window.deleteKBEntry = async function(id) {
    try {
        const resp = await fetch(`/api/admin/knowledge/${id}`, { method: 'DELETE', headers: getAdminHeaders() });
        if (resp.ok) { showToast('Entry removed.', 'success'); loadKnowledgeBase(); }
        else showToast('Failed to remove entry.', 'error');
    } catch(e) { showToast('Failed to remove entry.', 'error'); }
};

export function init() {
    document.getElementById('kb-add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('kb-add-form');
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('kb-cancel-btn')?.addEventListener('click', () => {
        const form = document.getElementById('kb-add-form');
        if (form) form.style.display = 'none';
    });

    document.getElementById('kb-refresh-btn')?.addEventListener('click', loadKnowledgeBase);

    document.getElementById('kb-save-btn')?.addEventListener('click', async () => {
        const entry = {
            entry_type: document.getElementById('kb-new-type')?.value || 'course',
            entry_key: document.getElementById('kb-new-key')?.value?.trim() || '',
            title: document.getElementById('kb-new-title')?.value?.trim() || '',
            content: document.getElementById('kb-new-content')?.value?.trim() || '',
        };
        if (!entry.title || !entry.content) { showToast('Title and content are required.', 'warning'); return; }
        try {
            const resp = await fetch('/api/admin/knowledge', {
                method: 'POST',
                headers: getAdminHeaders(),
                body: JSON.stringify(entry),
            });
            if (resp.ok) {
                showToast('Entry saved.', 'success');
                document.getElementById('kb-add-form').style.display = 'none';
                loadKnowledgeBase();
            } else showToast('Failed to save entry.', 'error');
        } catch(e) { showToast('Failed to save entry.', 'error'); }
    });

    const saveSettingsBtn = document.getElementById('save-settings-btn');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            const el = (id) => document.getElementById(id);
            const updates = {
                university_name: el('setting-university-name')?.value || '',
                draft_save_threshold: el('setting-draft-threshold')?.value || '30',
                submit_threshold: el('setting-submit-threshold')?.value || '80',
                delete_allowed_below: el('setting-delete-threshold')?.value || '50',
                strict_domain_mode: el('toggle-strict-domain')?.classList.contains('active') ? 'true' : 'false',
                require_evidence_links: el('toggle-require-evidence')?.classList.contains('active') ? 'true' : 'false',
                system_prompt_addendum: el('setting-system-prompt-addendum')?.value || '',
            };

            try {
                const resp = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: getAdminHeaders(),
                    body: JSON.stringify(updates),
                });
                const data = await resp.json();
                if (resp.ok) {
                    showToast('Settings saved.', 'success');
                } else {
                    showToast(data.error || 'Failed to save.', 'error');
                }
            } catch (e) {
                showToast('Failed to save settings.', 'error');
            }
        });
    }

    // Settings screen toggle buttons
    document.querySelectorAll('.toggle').forEach(toggle => {
        toggle.addEventListener('click', function () { this.classList.toggle('active'); });
    });
}
