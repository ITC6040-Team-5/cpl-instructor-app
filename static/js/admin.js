/**
 * admin.js — Admin dashboard, case review, and escalation for the NUPathway SPA.
 *
 * Exports: fetchAdminCases, renderAdminTable, openAdminReview
 * Assigns window.openAdminDeleteConfirm and window.renderAdminTable (called from inline onclick).
 * Uses window.navigateTo (router.js) to avoid circular imports.
 */

import { escapeHtml, getBadgeClass, formatTimestamp, formatMarkdown, getFileIcon, getAdminHeaders } from './utils.js';
import { handleAdminLogout } from './auth.js';

// Module-level state for client-side filtering/sorting
let _allAdminCases = [];
let _adminSortKey = 'updated_at';
let _adminSortAsc = false;
let _adminFilter = 'all';

function getFilteredCases() {
    let cases = [..._allAdminCases];
    // Tab filter
    if (_adminFilter === 'needs-review') {
        cases = cases.filter(c => ['Submitted', 'Under Review'].includes(c.status));
    } else if (_adminFilter === 'in-progress') {
        cases = cases.filter(c => ['Draft', 'In Progress'].includes(c.status));
    } else if (_adminFilter === 'completed') {
        cases = cases.filter(c => ['Approved', 'Denied'].includes(c.status));
    }
    // Search filter
    const searchInput = document.getElementById('admin-search-input');
    const query = (searchInput?.value || '').toLowerCase().trim();
    if (query) {
        cases = cases.filter(c =>
            (c.case_id || '').toLowerCase().includes(query) ||
            (c.applicant || '').toLowerCase().includes(query) ||
            (c.student_id || '').toLowerCase().includes(query)
        );
    }
    // Sort
    cases.sort((a, b) => {
        let va = a[_adminSortKey] || '', vb = b[_adminSortKey] || '';
        if (typeof va === 'number' && typeof vb === 'number') {
            return _adminSortAsc ? va - vb : vb - va;
        }
        va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
        return _adminSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return cases;
}

function updateAdminTabs() {
    const tabs = document.getElementById('admin-queue-tabs');
    if (!tabs) return;
    const all = _allAdminCases.length;
    const needsReview = _allAdminCases.filter(c => ['Submitted', 'Under Review'].includes(c.status)).length;
    const inProgress = _allAdminCases.filter(c => ['Draft', 'In Progress'].includes(c.status)).length;
    const completed = _allAdminCases.filter(c => ['Approved', 'Denied'].includes(c.status)).length;
    const tabEls = tabs.querySelectorAll('.tab');
    if (tabEls[0]) tabEls[0].textContent = `All Cases (${all})`;
    if (tabEls[1]) tabEls[1].textContent = `Needs Review (${needsReview})`;
    if (tabEls[2]) tabEls[2].textContent = `In Progress (${inProgress})`;
    if (tabEls[3]) tabEls[3].textContent = `Completed (${completed})`;

    // Update sidebar badge
    const badge = document.getElementById('queue-count-badge');
    if (badge) badge.textContent = needsReview || all;
}

export function renderAdminTable() {
    const tbody = document.querySelector('#admin-cases-table tbody');
    if (!tbody) return;
    const cases = getFilteredCases();
    tbody.innerHTML = '';

    if (_allAdminCases.length === 0) {
        // Empty state: no cases at all
        tbody.innerHTML = `<tr><td colspan="7" class="admin-empty-state">
            <div style="text-align:center; padding: 48px 24px;">
                <i class="ph ph-clipboard-text" style="font-size: 2.5rem; color: var(--text-muted); opacity: 0.5;"></i>
                <p style="margin-top: 12px; color: var(--text-muted);">No cases have been submitted yet.</p>
            </div>
        </td></tr>`;
        return;
    }

    if (cases.length === 0) {
        // No-results state: search/filter returned nothing
        tbody.innerHTML = `<tr><td colspan="7" class="admin-empty-state">
            <div style="text-align:center; padding: 36px 24px;">
                <i class="ph ph-magnifying-glass" style="font-size: 2rem; color: var(--text-muted); opacity: 0.5;"></i>
                <p style="margin-top: 8px; color: var(--text-muted);">No matching cases found.</p>
                <button class="btn-link" onclick="document.getElementById('admin-search-input').value=''; renderAdminTable();" style="margin-top: 4px;">Clear search</button>
            </div>
        </td></tr>`;
        return;
    }

    cases.forEach(c => {
        const badgeClass = getBadgeClass(c.status);
        const initials = (c.applicant || 'UN').substring(0, 2).toUpperCase();
        const pct = c.completion_pct || 0;
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        tr.addEventListener('click', () => openAdminReview(c.case_id));
        tr.innerHTML = `
            <td class="font-mono text-sm" style="white-space:nowrap;">${c.case_id}</td>
            <td>
                <div class="flex-align-center gap-2">
                    <div class="avatar-small img">${initials}</div>
                    <div style="min-width:0;">
                        <strong class="admin-applicant-name">${escapeHtml(c.applicant || 'Unknown')}</strong>
                        ${c.student_id ? `<span class="admin-applicant-sub">${escapeHtml(c.student_id)}</span>` : ''}
                    </div>
                </div>
            </td>
            <td><div style="max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(c.target_course || '—')}</div></td>
            <td><span class="badge ${badgeClass}" style="white-space:nowrap;">${c.status}</span></td>
            <td>
                <div class="flex-align-center gap-2 text-sm">
                    <div class="progress-bar-bg small">
                        <div class="progress-bar-fill ${pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : ''}" style="width: ${pct}%;"></div>
                    </div>
                    ${pct}%
                </div>
            </td>
            <td>
                ${c.confidence_score != null
                    ? `<div class="confidence-score-cell">
                        <div class="progress-bar-bg small">
                            <div class="progress-bar-fill ${c.confidence_score >= 70 ? 'green' : c.confidence_score >= 40 ? 'yellow' : ''}" style="width:${c.confidence_score}%;"></div>
                        </div>
                        ${c.confidence_score}%
                       </div>`
                    : '<span class="text-muted">—</span>'
                }
            </td>
            <td class="text-sm text-muted" style="white-space:nowrap;">${formatTimestamp(c.updated_at)}</td>
            <td><button class="btn-icon"><i class="ph ph-caret-right"></i></button></td>
            <td onclick="event.stopPropagation()">
                <button class="btn-icon" style="color:var(--status-danger);" title="Delete case"
                    onclick="openAdminDeleteConfirm('${c.case_id}')">
                    <i class="ph ph-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Assigned to window — called from inline onclick in dynamically generated HTML
window.renderAdminTable = renderAdminTable;

window.openAdminDeleteConfirm = async function(caseId) {
    const caseData = _allAdminCases.find(c => c.case_id === caseId);
    if (!caseData) return;

    const pct = caseData.completion_pct || 0;
    const confidence = caseData.confidence_score || 0;
    const hasSummary = caseData.summary && caseData.summary.length > 50;
    const isSubstantive = pct >= 60 || confidence >= 60 || hasSummary;

    const qualityNote = isSubstantive
        ? `<div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;font-size:0.875rem;color:#92400E;">
            <strong>⚠ This case may contain genuine information</strong> — the applicant appears to have provided meaningful prior learning details
            (${pct}% complete${confidence ? `, ${confidence}% AI confidence` : ''}).
            Review before deleting.
           </div>`
        : `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.75rem;font-size:0.875rem;color:#166534;">
            This case appears to be a test or exploratory conversation with minimal case data (${pct}% complete).
           </div>`;

    const body = `
        ${qualityNote}
        <p style="margin-bottom:0.75rem;">You are about to permanently delete case <strong>${escapeHtml(caseId)}</strong>
        ${caseData.applicant ? ` for <strong>${escapeHtml(caseData.applicant)}</strong>` : ''}.
        All messages, evidence records, and reviewer data will be removed.</p>
        <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1rem;">
            <strong style="color:#DC2626;">⛔ This action is irreversible.</strong>
            <span style="color:#991B1B;font-size:0.875rem;"> There is no undo. The data cannot be recovered once deleted.</span>
        </div>
        <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;color:var(--text-muted);cursor:not-allowed;opacity:0.55;" title="Email integration coming soon">
            <input type="checkbox" disabled>
            <span>Notify student via email <em style="font-size:0.78rem;">(email integration coming soon)</em></span>
        </label>
    `;

    showModal({
        title: 'Delete Case',
        body,
        confirmText: 'Delete Permanently',
        cancelText: 'Cancel',
        dangerous: true,
        onConfirm: async () => {
            try {
                const resp = await fetch(`/api/admin/case/${caseId}`, {
                    method: 'DELETE',
                    headers: getAdminHeaders(),
                });
                const data = await resp.json();
                if (resp.ok) {
                    showToast(`Case ${caseId} deleted.`, 'success');
                    fetchAdminCases();
                    if (window.location.pathname.startsWith('/admin/review')) {
                        window.navigateTo('/admin');
                    }
                } else {
                    showToast(data.error || 'Delete failed.', 'error');
                }
            } catch (e) {
                showToast('Delete failed.', 'error');
            }
        },
    });
};

export async function fetchAdminCases() {
    const tbody = document.querySelector('#admin-cases-table tbody');
    if (!tbody) return;

    // Loading state
    tbody.innerHTML = `<tr><td colspan="7" class="admin-loading-state">
        <div style="text-align:center; padding: 36px 24px;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 12px; color: var(--text-muted);">Loading cases...</p>
        </div>
    </td></tr>`;

    try {
        const response = await fetch('/api/admin/cases', { headers: getAdminHeaders() });
        if (response.status === 401) {
            showToast('Admin session expired. Please log in again.', 'warning');
            handleAdminLogout();
            return;
        }
        const data = await response.json();
        _allAdminCases = data.cases || [];
        updateAdminTabs();
        renderAdminTable();
    } catch (e) {
        console.error('Failed to fetch admin cases', e);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted p-4">Failed to load cases.</td></tr>`;
    }
}

export async function openAdminReview(caseId) {
    window.currentReviewCaseId = caseId;
    window.navigateTo('/admin/review');

    try {
        const response = await fetch(`/api/case/${caseId}`);
        const data = await response.json();
        if (data.error) return;

        const el = (id) => document.getElementById(id);
        if (el('review-applicant-name')) el('review-applicant-name').innerText = data.applicant_name || 'Unknown';
        if (el('review-case-subhead')) el('review-case-subhead').innerText = `${data.case_id} • ${data.target_course || '—'}`;
        if (el('review-case-summary')) el('review-case-summary').innerText = data.summary || 'No summary available.';
        if (el('review-target-course')) el('review-target-course').innerText = data.target_course || '—';
        if (el('review-confidence')) el('review-confidence').innerText = data.confidence_score ? `${data.confidence_score}%` : '—';
        if (el('review-case-status')) el('review-case-status').innerText = data.status || '—';

        // Transcript
        const transcriptBody = document.getElementById('review-transcript-body');
        if (transcriptBody && data.messages) {
            transcriptBody.innerHTML = data.messages.length === 0
                ? '<p class="text-muted p-4">No transcript available.</p>'
                : '';
            data.messages.forEach(msg => {
                const isAI = msg.role === 'assistant';
                const div = document.createElement('div');
                div.className = `message ${msg.role}`;
                div.innerHTML = `
                    <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg>' : (data.applicant_name || 'ST').substring(0, 2).toUpperCase()}</div>
                    <div class="message-content"><div>${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</div></div>
                `;
                transcriptBody.appendChild(div);
            });
        }

        // Evidence
        const evidenceList = document.getElementById('review-evidence-list');
        if (evidenceList && data.evidence) {
            evidenceList.innerHTML = data.evidence.length === 0
                ? '<p class="text-muted text-sm">No evidence files attached.</p>'
                : '';
            data.evidence.forEach(ev => {
                const icon = getFileIcon(ev.file_name);
                const statusBadge = ev.status === 'Uploaded' ? 'green' : 'blue';
                const downloadUrl = `/api/evidence/download/${caseId}/${encodeURIComponent(ev.file_name)}`;
                evidenceList.innerHTML += `<div class="file-item" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <i class="${icon}" style="flex-shrink:0;"></i>
                    <a href="${downloadUrl}" target="_blank" rel="noopener" class="admin-applicant-name" style="flex:1;color:var(--brand-accent);text-decoration:none;font-size:0.8rem;" title="${escapeHtml(ev.file_name)}">${escapeHtml(ev.file_name)}</a>
                    <span class="badge ${statusBadge}" style="font-size:0.6rem;flex-shrink:0;">${ev.status}</span>
                    <a href="${downloadUrl}" download="${escapeHtml(ev.file_name)}" title="Download" style="color:var(--text-muted);flex-shrink:0;"><i class="ph ph-download-simple"></i></a>
                </div>`;
            });
        }

        // Load per-case reviewer checks
        try {
            const checksResp = await fetch(`/api/case/${caseId}/checks`, { headers: getAdminHeaders() });
            if (checksResp.ok) {
                const checksData = await checksResp.json();
                const rubricEl = document.getElementById('check-rubric-assessed');
                const identityEl = document.getElementById('check-identity-verified');
                if (rubricEl) rubricEl.checked = !!checksData.checks?.rubric_assessed;
                if (identityEl) identityEl.checked = !!checksData.checks?.identity_verified;
            }
        } catch (ce) {
            console.warn('Could not load reviewer checks:', ce);
        }

        // Load existing reviewer notes for this case
        const notesInput = document.getElementById('review-notes-input');
        if (notesInput) notesInput.value = data.reviewer_notes || '';

    } catch (e) {
        console.error('Failed to load case for review', e);
    }
}

async function saveReviewerChecks() {
    const caseId = window.currentReviewCaseId;
    if (!caseId) return;
    const payload = {
        rubric_assessed: document.getElementById('check-rubric-assessed')?.checked || false,
        identity_verified: document.getElementById('check-identity-verified')?.checked || false,
    };
    try {
        await fetch(`/api/case/${caseId}/checks`, {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify(payload),
        });
    } catch (e) {
        console.warn('Failed to save reviewer checks:', e);
    }
}

async function handleReviewAction(decision) {
    const caseId = window.currentReviewCaseId;
    if (!caseId) return showToast('No case selected.', 'warning');

    const notes = document.getElementById('review-notes-input')?.value || '';

    try {
        const response = await fetch(`/api/case/${caseId}/review`, {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ decision, notes }),
        });
        const data = await response.json();
        if (response.ok && data.status === 'success') {
            showToast(`Case ${decision.toLowerCase()}d successfully.`, 'success');
            fetchAdminCases();
            window.navigateTo('/admin');
        } else {
            showToast(data.error || 'Action failed.', 'error');
        }
    } catch (error) {
        showToast('Review action failed.', 'error');
    }
}

function openEscalationDrawer() {
    const caseId = window.currentReviewCaseId;
    if (!caseId) { showToast('No case selected.', 'warning'); return; }
    const caseRef = document.getElementById('escalation-case-ref');
    const applicantEl = document.getElementById('escalation-applicant');
    if (caseRef) caseRef.textContent = caseId;
    if (applicantEl) {
        applicantEl.textContent = document.getElementById('review-applicant-name')?.textContent || '—';
    }
    const escalationDrawer = document.getElementById('escalation-drawer');
    if (escalationDrawer) {
        requestAnimationFrame(() => escalationDrawer.classList.add('drawer-visible'));
    }
}

function closeEscalationDrawer() {
    const escalationDrawer = document.getElementById('escalation-drawer');
    if (escalationDrawer) escalationDrawer.classList.remove('drawer-visible');
}

export function init() {
    // Tab click handler
    document.getElementById('admin-queue-tabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        document.querySelectorAll('#admin-queue-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _adminFilter = tab.dataset.filter || 'all';
        renderAdminTable();
    });

    // Search handler
    document.getElementById('admin-search-input')?.addEventListener('input', () => renderAdminTable());

    // Sort handler
    document.querySelectorAll('#admin-cases-table th.sortable')?.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (_adminSortKey === key) {
                _adminSortAsc = !_adminSortAsc;
            } else {
                _adminSortKey = key;
                _adminSortAsc = true;
            }
            // Update sort indicators
            document.querySelectorAll('#admin-cases-table th.sortable').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            th.classList.add(_adminSortAsc ? 'sort-asc' : 'sort-desc');
            renderAdminTable();
        });
    });

    // Review action buttons
    const reviewBackBtn = document.getElementById('review-back-btn');
    if (reviewBackBtn) reviewBackBtn.addEventListener('click', () => window.navigateTo('/admin'));

    const approveBtn = document.getElementById('admin-approve-btn');
    const denyBtn = document.getElementById('admin-deny-btn');
    const revisionBtn = document.getElementById('request-revision-btn');
    if (approveBtn) approveBtn.addEventListener('click', () => handleReviewAction('Approve'));
    if (denyBtn) denyBtn.addEventListener('click', () => handleReviewAction('Deny'));
    if (revisionBtn) revisionBtn.addEventListener('click', () => handleReviewAction('Request Revision'));

    // Persist reviewer checks on change
    document.getElementById('check-rubric-assessed')?.addEventListener('change', saveReviewerChecks);
    document.getElementById('check-identity-verified')?.addEventListener('change', saveReviewerChecks);

    // Escalation drawer
    const escalateBtn = document.getElementById('admin-escalate-btn');
    const escalationCloseBtn = document.getElementById('escalation-drawer-close');
    const escalationPrepareBtn = document.getElementById('escalation-prepare-btn');

    if (escalateBtn) escalateBtn.addEventListener('click', openEscalationDrawer);
    if (escalationCloseBtn) escalationCloseBtn.addEventListener('click', closeEscalationDrawer);
    if (escalationPrepareBtn) {
        escalationPrepareBtn.addEventListener('click', async () => {
            const caseId = window.currentReviewCaseId;
            if (!caseId) return showToast('No case selected.', 'warning');

            const payload = {
                escalation_type: document.getElementById('escalation-type')?.value || 'SME Review',
                escalated_to_name: document.getElementById('escalation-to-name')?.value?.trim() || '',
                escalated_to_email: document.getElementById('escalation-email')?.value?.trim() || '',
                escalation_notes: document.getElementById('escalation-notes')?.value?.trim() || '',
            };

            try {
                const resp = await fetch(`/api/case/${caseId}/escalate`, {
                    method: 'POST',
                    headers: getAdminHeaders(),
                    body: JSON.stringify(payload),
                });
                const data = await resp.json();
                if (resp.ok) {
                    showToast(data.message || 'Escalation recorded.', 'success');
                    closeEscalationDrawer();
                    fetchAdminCases();
                    window.navigateTo('/admin');
                } else {
                    showToast(data.error || 'Failed to record escalation.', 'error');
                }
            } catch (e) {
                showToast('Failed to record escalation.', 'error');
            }
        });
    }

    // Global search bar
    const globalSearchInput = document.getElementById('global-search-input');
    if (globalSearchInput) {
        globalSearchInput.addEventListener('keypress', async (e) => {
            if (e.key !== 'Enter') return;
            const query = globalSearchInput.value.trim();
            if (!query) return;

            const adminToken = sessionStorage.getItem('cpl_admin_token');
            if (!adminToken) {
                showToast('Please sign in as reviewer to search cases.', 'warning');
                return;
            }

            try {
                const resp = await fetch('/api/admin/cases', { headers: getAdminHeaders() });
                const data = await resp.json();
                const match = (data.cases || []).find(c =>
                    c.case_id === query ||
                    (c.student_id || '').toLowerCase() === query.toLowerCase() ||
                    (c.applicant || '').toLowerCase().includes(query.toLowerCase())
                );
                if (match) {
                    openAdminReview(match.case_id);
                    globalSearchInput.value = '';
                    showToast(`Found case ${match.case_id}`, 'info');
                } else {
                    showToast('No matching case found.', 'warning');
                }
            } catch (err) {
                console.error('Global search failed', err);
                showToast('Search failed.', 'error');
            }
        });
    }
}
