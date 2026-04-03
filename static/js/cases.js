/**
 * cases.js — Case history and detail view for the NUPathway SPA.
 *
 * Exports: fetchApplicantCases, loadCaseDetail, loadChatHistory, attemptSessionRecovery
 * Uses window.navigateTo (router.js) to avoid importing router.js.
 */

import { S } from './state.js';
import { escapeHtml, formatMarkdown, getBadgeClass, getFileIcon, formatTimestamp, getRequestHeaders } from './utils.js';
import { appendUserMessage, updateIntakeSidebar } from './chat.js';

export async function fetchApplicantCases() {
    const container = document.getElementById('case-list-container');
    if (!container) return;

    // Ensure list view is visible, detail is hidden
    const listView = document.getElementById('case-list-view');
    const detailView = document.getElementById('case-detail-view');
    if (listView) listView.style.display = 'block';
    if (detailView) detailView.style.display = 'none';

    try {
        const response = await fetch('/api/cases', { headers: getRequestHeaders() });
        const data = await response.json();
        container.innerHTML = '';

        if (!data.cases || data.cases.length === 0) {
            container.innerHTML = `<div class="text-center text-muted p-4">
                <i class="ph ph-folder-open" style="font-size: 2rem;"></i>
                <p class="mt-2">No cases yet. Start a conversation to create your first case.</p>
            </div>`;
            return;
        }

        data.cases.forEach((c, idx) => {
            const badgeClass = getBadgeClass(c.status);
            const pct = c.completion_pct || 0;
            const ts = c.created_at ? formatTimestamp(c.created_at) : '';
            const div = document.createElement('div');
            div.className = 'case-list-item';
            div.innerHTML = `
                <div class="case-list-left">
                    <div class="case-index">Case ${c.index || idx + 1}</div>
                    <div class="case-info">
                        <strong>${c.target_course || 'Building case...'}</strong>
                        <span class="text-sm text-muted">${ts}</span>
                    </div>
                </div>
                <div class="case-list-right">
                    <div class="progress-bar-bg small" style="width: 60px;" title="${pct}% complete">
                        <div class="progress-bar-fill ${pct >= 80 ? 'green' : pct >= 30 ? 'yellow' : ''}" style="width: ${pct}%;"></div>
                    </div>
                    <span class="badge ${badgeClass}">${c.status}</span>
                    <i class="ph ph-caret-right text-muted"></i>
                </div>
            `;
            div.addEventListener('click', () => loadCaseDetail(c.case_id, c.index || idx + 1));
            container.appendChild(div);
        });
    } catch (e) {
        console.error('Failed to fetch cases', e);
        showToast('Failed to load cases.', 'error');
    }
}

export async function loadCaseDetail(caseId, caseIndex) {
    const listView = document.getElementById('case-list-view');
    const detailView = document.getElementById('case-detail-view');
    if (listView) listView.style.display = 'none';
    if (detailView) detailView.style.display = 'block';

    try {
        const response = await fetch(`/api/case/${caseId}`, { headers: getRequestHeaders() });
        const data = await response.json();
        if (data.error) return;

        // Populate detail header
        const detailTitle = document.getElementById('case-detail-title');
        if (detailTitle) detailTitle.innerText = `Case ${caseIndex || ''} — ${data.target_course || 'In Progress'}`;

        const detailStatus = document.getElementById('case-detail-status');
        if (detailStatus) {
            detailStatus.className = `badge ${getBadgeClass(data.status)}`;
            detailStatus.innerText = data.status;
        }

        // Summary
        const detailSummary = document.getElementById('case-detail-summary');
        if (detailSummary) detailSummary.innerText = data.summary || 'No summary generated yet.';

        // Completion
        const detailCompletion = document.getElementById('case-detail-completion');
        if (detailCompletion) detailCompletion.innerText = `${data.completion_pct || 0}% complete`;

        // Timeline
        const timelineContainer = document.getElementById('case-detail-timeline');
        if (timelineContainer) timelineContainer.innerHTML = renderTimeline(data);

        // Reviewer notes
        const notesEl = document.getElementById('case-detail-reviewer-notes');
        if (notesEl) {
            if (data.reviewer_notes) {
                notesEl.style.display = 'block';
                notesEl.querySelector('.notes-content').innerText = data.reviewer_notes;
            } else {
                notesEl.style.display = 'none';
            }
        }

        // Store data for drawer
        detailView._caseData = data;
        detailView._caseIndex = caseIndex;

        // View Conversation button
        const viewConvoBtn = document.getElementById('view-conversation-btn');
        if (viewConvoBtn) {
            viewConvoBtn.onclick = () => openConversationDrawer(data);
        }

        // Continue Conversation button (only for draft cases)
        const continueBtn = document.getElementById('continue-conversation-btn');
        if (continueBtn) {
            if (['New', 'Draft', 'In Progress'].includes(data.status)) {
                continueBtn.style.display = 'inline-flex';
                continueBtn.onclick = () => {
                    S.sessionId = data.session_id;
                    localStorage.setItem('cpl_session_id', S.sessionId);
                    S.currentCaseId = data.case_id;
                    window.navigateTo('/chat');
                    // Reload chat history
                    loadChatHistory(data.session_id);
                };
            } else {
                continueBtn.style.display = 'none';
            }
        }

        // Delete button
        const deleteBtn = document.getElementById('delete-case-btn');
        if (deleteBtn) {
            if (['New', 'Draft', 'In Progress'].includes(data.status) && (data.completion_pct || 0) < 50) {
                deleteBtn.style.display = 'inline-flex';
                deleteBtn.onclick = () => {
                    confirmAction('Delete Case', '<p>This will permanently delete this case and all associated data. This cannot be undone.</p>', async () => {
                        try {
                            const resp = await fetch(`/api/case/${caseId}`, { method: 'DELETE', headers: getRequestHeaders() });
                            const result = await resp.json();
                            if (resp.ok) {
                                showToast('Case deleted.', 'success');
                                fetchApplicantCases();
                            } else {
                                showToast(result.error || 'Delete failed.', 'error');
                            }
                        } catch (e) {
                            showToast('Failed to delete case.', 'error');
                        }
                    }, true);
                };
            } else {
                deleteBtn.style.display = 'none';
            }
        }

    } catch (e) {
        console.error('Failed to load case detail', e);
        showToast('Failed to load case details.', 'error');
    }
}

export async function loadChatHistory(sid) {
    const chatTranscript = document.getElementById('intake-chat');
    if (!chatTranscript) return;
    chatTranscript.innerHTML = '';
    try {
        const resp = await fetch(`/api/cases`, { headers: getRequestHeaders() });
        const data = await resp.json();
        // Find the case with this session
        const matchedCase = (data.cases || []).find(c => c.session_id === sid);
        if (matchedCase) {
            const detailResp = await fetch(`/api/case/${matchedCase.case_id}`, { headers: getRequestHeaders() });
            const detail = await detailResp.json();
            if (detail.messages) {
                detail.messages.forEach(msg => {
                    const isAI = msg.role === 'assistant';
                    const div = document.createElement('div');
                    div.className = `message ${msg.role}`;
                    if (isAI) {
                        div.innerHTML = `${S.ECHO_AVATAR}<div class="message-content"><div>${formatMarkdown(msg.content)}</div></div>`;
                    } else {
                        const ini = S.applicantName ? S.applicantName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ME';
                        div.innerHTML = `<div class="avatar-small img">${ini}</div><div class="message-content"><p>${escapeHtml(msg.content)}</p></div>`;
                    }
                    chatTranscript.appendChild(div);
                });
                chatTranscript.scrollTop = chatTranscript.scrollHeight;
            }
            updateIntakeSidebar({
                case_id: detail.case_id,
                status: detail.status,
                completion_pct: detail.completion_pct,
                target_course: detail.target_course,
                summary: detail.summary,
                can_submit: (detail.completion_pct || 0) >= 80,
            });

            // Restore evidence list from DB (shows files even after page refresh)
            if (detail.evidence && detail.evidence.length > 0) {
                const list = document.getElementById('intake-evidence-list');
                if (list) {
                    list.innerHTML = '';
                    detail.evidence.forEach(ev => {
                        const icon = getFileIcon(ev.file_name);
                        list.innerHTML += `<div class="compact-file-item">
                            <i class="${icon}"></i>
                            <div class="compact-file-info"><span class="compact-file-name">${escapeHtml(ev.file_name)}</span></div>
                            <span class="badge green" style="font-size:0.6rem;">${ev.status || 'Uploaded'}</span>
                        </div>`;
                    });
                }
            }
        }
    } catch (e) {
        console.error('Failed to load chat history', e);
    }
}

function openConversationDrawer(caseData) {
    let drawer = document.getElementById('conversation-drawer');
    if (!drawer) {
        drawer = document.createElement('div');
        drawer.id = 'conversation-drawer';
        drawer.className = 'drawer-overlay';
        document.body.appendChild(drawer);
    }

    let html = `<div class="drawer-content">
        <div class="drawer-header">
            <h3>Conversation Transcript</h3>
            <button class="btn-icon drawer-close" onclick="document.getElementById('conversation-drawer').classList.remove('drawer-visible')">
                <i class="ph ph-x"></i>
            </button>
        </div>
        <div class="drawer-body">`;

    if (caseData.messages && caseData.messages.length > 0) {
        caseData.messages.forEach(msg => {
            const isAI = msg.role === 'assistant';
            html += `<div class="message ${msg.role}">
                <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg>' : 'ST'}</div>
                <div class="message-content"><div>${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</div></div>
            </div>`;
        });
    } else {
        html += '<p class="text-muted p-4">No conversation transcript available.</p>';
    }

    html += `</div></div>`;
    drawer.innerHTML = html;
    requestAnimationFrame(() => drawer.classList.add('drawer-visible'));
}

function renderTimeline(caseData) {
    const steps = [
        { name: 'Case Created', description: caseData.created_at ? formatTimestamp(caseData.created_at) : '' },
        { name: 'Intake & Evidence', description: 'Conversation with Echo to build your case.' },
        { name: 'Submitted for Review', description: 'Case sent to evaluation team.' },
        { name: 'Under Review', description: 'Evaluator reviewing your case.' },
        { name: 'Decision', description: 'Credit outcome recorded.' },
    ];

    const statusIndex = {
        'New': 0, 'Draft': 1, 'In Progress': 1, 'Ready for Review': 1,
        'Submitted': 2, 'Under Review': 3, 'Revision Requested': 3,
        'Escalated': 3,
        'Approved': 4, 'Denied': 4,
    };
    const currentStep = statusIndex[caseData.status] ?? 0;

    let html = '<div class="timeline-container vertical">';
    steps.forEach((step, i) => {
        let cls = i < currentStep ? 'completed' : i === currentStep ? 'active' : 'future';
        const indicator = cls === 'completed'
            ? '<div class="step-indicator"><i class="ph-bold ph-check"></i></div>'
            : cls === 'active'
            ? '<div class="step-indicator inner-dot"></div>'
            : '<div class="step-indicator"></div>';

        let desc = step.description;
        if (i === currentStep) {
            if (caseData.status === 'Approved') desc = '✅ Credit approved!';
            if (caseData.status === 'Denied') desc = '❌ Credit denied.';
            if (caseData.status === 'Revision Requested') desc = '⚠️ Reviewer requested changes.';
        }

        html += `<div class="timeline-step ${cls}">${indicator}<div class="step-content"><h4>${step.name}</h4><p>${desc}</p></div></div>`;
    });
    html += '</div>';
    return html;
}

export async function attemptSessionRecovery() {
    const savedSession = localStorage.getItem('cpl_session_id');
    const savedStudentId = localStorage.getItem('cpl_student_id');
    const currentPath = window.location.pathname;

    // Only recover on chat page
    if (currentPath !== '/chat' || !savedSession) return;

    try {
        // Check if we have an existing case for this session
        const resp = await fetch(`/api/session/${savedSession}/messages`);
        if (resp.ok) {
            const data = await resp.json();
            if (data.messages && data.messages.length > 0) {
                S.sessionId = savedSession;
                const chatTranscript = document.getElementById('intake-chat');
                // Reload messages into transcript
                if (chatTranscript) {
                    chatTranscript.innerHTML = '';
                    data.messages.forEach(msg => {
                        const div = document.createElement('div');
                        div.className = `message ${msg.role}`;
                        const isAI = msg.role === 'assistant';
                        div.innerHTML = `
                            <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg>' : (S.applicantName || 'ME').substring(0, 2).toUpperCase()}</div>
                            <div class="message-content"><div>${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</div></div>
                        `;
                        chatTranscript.appendChild(div);
                    });
                    chatTranscript.scrollTop = chatTranscript.scrollHeight;
                }

                // Try to restore case data
                if (savedStudentId) {
                    const casesResp = await fetch('/api/cases', { headers: getRequestHeaders() });
                    if (casesResp.ok) {
                        const casesData = await casesResp.json();
                        const activeCase = (casesData.cases || []).find(c =>
                            c.session_id === savedSession || ['Draft', 'In Progress'].includes(c.status)
                        );
                        if (activeCase) {
                            S.currentCaseId = activeCase.case_id;
                            S.currentCompletionPct = activeCase.completion_pct || 0;
                            updateIntakeSidebar({
                                ...activeCase,
                                can_submit: (activeCase.completion_pct || 0) >= 80,
                            });
                        }
                    }
                }
            }
        }
    } catch (err) {
        console.warn('Session recovery failed (non-fatal):', err);
    }
}

export function init() {
    const backToCaseList = document.getElementById('back-to-case-list');
    if (backToCaseList) {
        backToCaseList.addEventListener('click', () => {
            const detailView = document.getElementById('case-detail-view');
            const listView = document.getElementById('case-list-view');
            if (detailView) detailView.style.display = 'none';
            if (listView) listView.style.display = 'block';
        });
    }
}
