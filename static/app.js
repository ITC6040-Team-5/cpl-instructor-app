/**
 * app.js — NUPathway SPA Frontend
 *
 * Responsibilities:
 *  - SPA routing (History API)
 *  - Chat orchestration with identity + completion tracking
 *  - Case history with detail view and conversation drawer
 *  - Admin dashboard, review, and settings
 *  - Evidence upload via paperclip
 *  - Navigate-away warning for unsaved sessions
 */

document.addEventListener('DOMContentLoaded', () => {

    // ═══════════════════════════════════════════════════
    // 0. State
    // ═══════════════════════════════════════════════════
    let sessionId = localStorage.getItem('cpl_session_id');
    if (!sessionId) {
        sessionId = 'session_' + crypto.randomUUID().slice(0, 12);
        localStorage.setItem('cpl_session_id', sessionId);
    }

    let currentCaseId = null;
    let currentCompletionPct = 0;
    let chatHasUnsavedContent = false;  // True when below draft threshold

    // Identity from localStorage (persisted across sessions)
    let applicantName = localStorage.getItem('cpl_applicant_name') || '';
    let studentId = localStorage.getItem('cpl_student_id') || '';

    function getRequestHeaders() {
        const h = { 'Content-Type': 'application/json' };
        if (applicantName) h['X-Applicant-Name'] = applicantName;
        if (studentId) h['X-Student-Id'] = studentId;
        return h;
    }

    // ═══════════════════════════════════════════════════
    // 1. SPA Router
    // ═══════════════════════════════════════════════════
    const navItems = document.querySelectorAll('.nav-item');
    const screenViews = document.querySelectorAll('.screen-view');
    const breadcrumb = document.getElementById('dynamic-breadcrumb');

    const routes = {
        '/': 'home-screen',
        '/chat': 'intake-screen',
        '/cases': 'case-history-screen',
        '/admin': 'admin-dashboard-screen',
        '/admin/settings': 'admin-settings-screen',
    };

    const reverseRoutes = {
        'home-screen': '/',
        'intake-screen': '/chat',
        'case-history-screen': '/cases',
        'admin-dashboard-screen': '/admin',
        'admin-review-screen': '/admin/review',
        'admin-settings-screen': '/admin/settings',
    };

    const breadcrumbMap = {
        '/': 'Applicant View / Home',
        '/chat': 'Applicant View / New Evaluation',
        '/cases': 'Applicant View / Case History',
        '/admin': 'Reviewer Portal / Dashboard Queue',
        '/admin/review': 'Reviewer Portal / Case Review',
        '/admin/settings': 'Reviewer Portal / Settings',
    };

    window.navigateTo = function (path, push = true) {
        // Navigate-away warning for unsaved chat below draft threshold
        if (chatHasUnsavedContent && window.location.pathname === '/chat' && path !== '/chat') {
            showModal({
                title: 'Unsaved Progress',
                body: '<p>Your conversation hasn\'t gathered enough information to save as a draft. If you leave now, your progress will be lost.</p><p>Continue chatting to build your case further.</p>',
                confirmText: 'Leave Anyway',
                cancelText: 'Stay',
                dangerous: true,
                onConfirm: () => {
                    chatHasUnsavedContent = false;
                    navigateTo(path, push);
                },
            });
            return;
        }

        let targetId = routes[path];
        if (!targetId) {
            if (path.startsWith('/admin/review')) targetId = 'admin-review-screen';
            else if (path.startsWith('/cases/')) targetId = 'case-history-screen';
            else targetId = 'home-screen';
        }

        if (push && path !== window.location.pathname) {
            window.history.pushState({ targetId }, "", path);
        }

        // Breadcrumb
        if (breadcrumb) {
            breadcrumb.innerText = breadcrumbMap[path] || breadcrumbMap['/'];
        }

        // Nav highlighting
        if (targetId !== 'admin-review-screen') {
            const activeNav = document.querySelector(`.nav-item[data-target="${targetId}"]`);
            if (activeNav) {
                navItems.forEach(nav => nav.classList.remove('active'));
                activeNav.classList.add('active');
            }
        }

        // Show/hide screens
        screenViews.forEach(screen => screen.classList.remove('active'));
        const targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.classList.add('active');

        // Sidebar footer transition
        const footer = document.querySelector('.sidebar-footer');
        if (footer) {
            footer.style.opacity = path === '/chat' ? '1' : '0';
            footer.style.transform = path === '/chat' ? 'translateY(0)' : 'translateY(10px)';
        }

        // Route-entry hooks
        if (path === '/cases') fetchApplicantCases();
        if (path === '/admin') { fetchAdminCases(); switchToReviewerNav(); }
        if (path === '/admin/settings') { loadSettingsTab(); switchToReviewerNav(); }
        if (path === '/' || path === '/chat' || path === '/cases') switchToApplicantNav();
    };

    window.addEventListener('popstate', () => navigateTo(window.location.pathname, false));

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const appContainer = document.querySelector('.app-container');
    if (sidebarToggle && appContainer) {
        sidebarToggle.addEventListener('click', () => appContainer.classList.toggle('collapsed'));
    }

    // Nav item clicks
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-target');
            if (targetId && reverseRoutes[targetId]) {
                e.preventDefault();
                navigateTo(reverseRoutes[targetId]);
            }
        });
    });


    // ═══════════════════════════════════════════════════
    // 2. Chat Logic
    // ═══════════════════════════════════════════════════
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send');
    const chatTranscript = document.getElementById('intake-chat');

    async function appendUserMessage(text) {
        if (!text.trim()) return;

        // Render user bubble
        const initials = applicantName ? applicantName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ME';
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        msgDiv.innerHTML = `
            <div class="avatar-small img">${initials}</div>
            <div class="message-content"><p>${escapeHtml(text)}</p></div>
        `;
        chatTranscript.appendChild(msgDiv);
        chatInput.value = '';
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        // Loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message assistant loading-indicator';
        loadingDiv.innerHTML = `<div class="avatar-small bg-ai"><i class="ph-fill ph-sparkle text-white"></i></div><div class="message-content"><p class="text-muted"><i class="ph ph-spinner ph-spin"></i> Echo is thinking...</p></div>`;
        chatTranscript.appendChild(loadingDiv);
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        try {
            const payload = {
                message: text,
                session_id: sessionId,
            };
            // Send identity if we have it
            if (applicantName) payload.applicant_name = applicantName;
            if (studentId) payload.student_id = studentId;

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            chatTranscript.removeChild(loadingDiv);

            if (data.error) {
                showToast(data.error, 'error');
                return;
            }

            // Update state from response
            if (data.case_id) currentCaseId = data.case_id;
            if (data.completion_pct !== undefined) currentCompletionPct = data.completion_pct;

            // Track identity from extraction
            if (data.applicant_name && !applicantName) {
                applicantName = data.applicant_name;
                localStorage.setItem('cpl_applicant_name', applicantName);
                updateProfileDisplay();
            }
            if (data.student_id && !studentId) {
                studentId = data.student_id;
                localStorage.setItem('cpl_student_id', studentId);
            }

            // Update unsaved content flag
            chatHasUnsavedContent = !data.draft_saved;

            // Draft saved notification
            if (data.draft_saved && data.status === 'Draft') {
                // Show one-time toast when first crossing threshold
                if (!sessionStorage.getItem(`draft_toast_${sessionId}`)) {
                    showToast('Draft saved — you can return to this case later.', 'success');
                    sessionStorage.setItem(`draft_toast_${sessionId}`, '1');
                }
            }

            // Update intake sidebar
            updateIntakeSidebar(data);

            // Render assistant bubble
            const aiDiv = document.createElement('div');
            aiDiv.className = 'message assistant';
            aiDiv.innerHTML = `
                <div class="avatar-small bg-ai"><i class="ph-fill ph-sparkle text-white"></i></div>
                <div class="message-content"><p>${formatMarkdown(data.answer || 'Sorry, I could not process that.')}</p></div>
            `;
            chatTranscript.appendChild(aiDiv);
            chatTranscript.scrollTop = chatTranscript.scrollHeight;

        } catch (error) {
            chatTranscript.removeChild(loadingDiv);
            showToast('Error connecting to backend. Please try again.', 'error');
            const errDiv = document.createElement('div');
            errDiv.className = 'message assistant';
            errDiv.innerHTML = `<div class="avatar-small bg-ai"><i class="ph-fill ph-sparkle text-white"></i></div><div class="message-content"><p style="color: var(--status-red-text);">Connection error. Please try again.</p></div>`;
            chatTranscript.appendChild(errDiv);
        }
    }

    function updateIntakeSidebar(data) {
        const el = (id) => document.getElementById(id);

        if (el('intake-case-id')) el('intake-case-id').innerText = data.case_id || '—';
        if (el('intake-case-status')) el('intake-case-status').innerText = data.status || 'New';
        if (el('intake-target-course')) el('intake-target-course').innerText = data.target_course || '—';
        if (el('intake-case-summary')) el('intake-case-summary').innerText = data.summary || 'Building case from conversation...';

        // Progress bar
        const pct = data.completion_pct || 0;
        const progressFill = document.querySelector('.record-footer .progress-bar-fill');
        const progressText = document.querySelector('.record-footer .progress-text');
        if (progressFill) progressFill.style.width = pct + '%';
        if (progressText) progressText.innerText = pct + '% Complete';

        // Submit button gating
        const submitBtn = document.getElementById('submit-for-review-btn');
        if (submitBtn) {
            submitBtn.disabled = !data.can_submit;
            submitBtn.title = data.can_submit ? 'Submit your case for review' : `Case must be at least 80% complete (currently ${pct}%)`;
        }
    }

    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', () => appendUserMessage(chatInput.value));
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') appendUserMessage(chatInput.value);
        });
    }

    // Submit for Review button
    const submitReviewBtn = document.getElementById('submit-for-review-btn');
    if (submitReviewBtn) {
        submitReviewBtn.addEventListener('click', async () => {
            if (!currentCaseId) return showToast('No active case.', 'warning');

            showModal({
                title: 'Submit for Review',
                body: '<p>Are you ready to submit your case for evaluation?</p><p class="text-sm text-muted">Note: Submission does not guarantee approval. A reviewer will evaluate your case and make the final decision.</p>',
                confirmText: 'Submit',
                onConfirm: async () => {
                    try {
                        const resp = await fetch(`/api/case/${currentCaseId}/submit`, {
                            method: 'POST',
                            headers: getRequestHeaders(),
                        });
                        const data = await resp.json();
                        if (resp.ok) {
                            showToast(data.message || 'Case submitted!', 'success');
                            updateIntakeSidebar({ ...data, completion_pct: currentCompletionPct, can_submit: false });
                            chatHasUnsavedContent = false;
                        } else {
                            showToast(data.error || 'Submission failed.', 'error');
                        }
                    } catch (e) {
                        showToast('Failed to submit case.', 'error');
                    }
                },
            });
        });
    }


    // ═══════════════════════════════════════════════════
    // 3. Homepage Interactions
    // ═══════════════════════════════════════════════════
    const promptSuggestions = document.querySelectorAll('.prompt-suggestion');
    const landingComposerInput = document.querySelector('.composer-textarea');
    const landingSendBtn = document.querySelector('.composer-send-btn');

    function initiateChatFromLanding(promptText) {
        if (!promptText.trim()) return;

        // Fresh session
        sessionId = 'session_' + crypto.randomUUID().slice(0, 12);
        localStorage.setItem('cpl_session_id', sessionId);
        currentCaseId = null;
        currentCompletionPct = 0;
        chatHasUnsavedContent = false;
        sessionStorage.removeItem(`draft_toast_${sessionId}`);

        // Clear chat
        if (chatTranscript) chatTranscript.innerHTML = '';

        // Reset sidebar
        updateIntakeSidebar({ case_id: '—', status: 'New', completion_pct: 0, can_submit: false });

        navigateTo('/chat');
        setTimeout(() => appendUserMessage(promptText), 200);
    }

    promptSuggestions.forEach(s => {
        s.addEventListener('click', () => initiateChatFromLanding(s.dataset.prompt));
    });

    if (landingSendBtn && landingComposerInput) {
        landingSendBtn.addEventListener('click', () => {
            initiateChatFromLanding(landingComposerInput.value);
            landingComposerInput.value = '';
        });
        landingComposerInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                initiateChatFromLanding(landingComposerInput.value);
                landingComposerInput.value = '';
            }
        });
    }

    // New Case button
    const primaryBtn = document.getElementById('primary-action-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => initiateChatFromLanding('I want to start a new evaluation case.'));
    }


    // ═══════════════════════════════════════════════════
    // 4. Case History (Applicant)
    // ═══════════════════════════════════════════════════
    async function fetchApplicantCases() {
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

    async function loadCaseDetail(caseId, caseIndex) {
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
                        sessionId = data.session_id;
                        localStorage.setItem('cpl_session_id', sessionId);
                        currentCaseId = data.case_id;
                        navigateTo('/chat');
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

    async function loadChatHistory(sid) {
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
                            div.innerHTML = `<div class="avatar-small bg-ai"><i class="ph-fill ph-sparkle text-white"></i></div><div class="message-content"><p>${formatMarkdown(msg.content)}</p></div>`;
                        } else {
                            const ini = applicantName ? applicantName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ME';
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
            }
        } catch (e) {
            console.error('Failed to load chat history', e);
        }
    }

    // Conversation Drawer
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
                    <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<i class="ph-fill ph-sparkle text-white"></i>' : 'ST'}</div>
                    <div class="message-content"><p>${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</p></div>
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

    const backToCaseList = document.getElementById('back-to-case-list');
    if (backToCaseList) {
        backToCaseList.addEventListener('click', () => {
            const detailView = document.getElementById('case-detail-view');
            const listView = document.getElementById('case-list-view');
            if (detailView) detailView.style.display = 'none';
            if (listView) listView.style.display = 'block';
        });
    }


    // ═══════════════════════════════════════════════════
    // 5. Admin Dashboard
    // ═══════════════════════════════════════════════════
    async function fetchAdminCases() {
        const tbody = document.querySelector('#admin-dashboard-screen .data-table tbody');
        if (!tbody) return;

        try {
            const response = await fetch('/api/admin/cases');
            const data = await response.json();
            tbody.innerHTML = '';

            if (!data.cases || data.cases.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">No cases in the queue.</td></tr>';
                return;
            }

            data.cases.forEach(c => {
                const badgeClass = getBadgeClass(c.status);
                const initials = (c.applicant || 'UN').substring(0, 2).toUpperCase();
                const tr = document.createElement('tr');
                tr.className = 'clickable-row';
                tr.addEventListener('click', () => openAdminReview(c.case_id));
                tr.innerHTML = `
                    <td class="font-mono text-sm">${c.case_id}</td>
                    <td>
                        <div class="flex-align-center gap-2">
                            <div class="avatar-small img">${initials}</div>
                            <strong>${c.applicant || 'Unknown'}</strong>
                        </div>
                    </td>
                    <td>${c.target_course || '—'}</td>
                    <td><span class="badge ${badgeClass}">${c.status}</span></td>
                    <td>
                        <div class="flex-align-center gap-2 text-sm">
                            <div class="progress-bar-bg small">
                                <div class="progress-bar-fill ${(c.confidence_score || 0) >= 70 ? 'green' : 'yellow'}" style="width: ${c.confidence_score || 0}%;"></div>
                            </div>
                            ${c.confidence_score || '—'}
                        </div>
                    </td>
                    <td>${c.assignee || '—'}</td>
                    <td><button class="btn-icon"><i class="ph ph-caret-right"></i></button></td>
                `;
                tbody.appendChild(tr);
            });

            const tab = document.querySelector('#admin-dashboard-screen .tab.active');
            if (tab) tab.innerText = `All Cases (${data.cases.length})`;
        } catch (e) {
            console.error('Failed to fetch admin cases', e);
        }
    }

    async function openAdminReview(caseId) {
        window.currentReviewCaseId = caseId;
        navigateTo('/admin/review');

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
                        <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<i class="ph-fill ph-sparkle text-white"></i>' : (data.applicant_name || 'ST').substring(0, 2).toUpperCase()}</div>
                        <div class="message-content"><p>${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</p></div>
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
                    evidenceList.innerHTML += `<div class="file-item"><i class="${icon}"></i> ${ev.file_name} <span class="badge ${statusBadge}" style="font-size:0.6rem;">${ev.status}</span></div>`;
                });
            }
        } catch (e) {
            console.error('Failed to load case for review', e);
        }
    }

    // Review actions
    const reviewBackBtn = document.getElementById('review-back-btn');
    if (reviewBackBtn) reviewBackBtn.addEventListener('click', () => navigateTo('/admin'));

    const approveBtn = document.querySelector('.review-topbar .btn-primary');
    const denyBtn = document.querySelector('.review-topbar .btn-secondary.text-danger');
    const revisionBtn = document.getElementById('request-revision-btn');

    async function handleReviewAction(decision) {
        const caseId = window.currentReviewCaseId;
        if (!caseId) return showToast('No case selected.', 'warning');

        const notes = document.getElementById('review-notes-input')?.value || '';

        try {
            const response = await fetch(`/api/case/${caseId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision, notes }),
            });
            const data = await response.json();
            if (response.ok && data.status === 'success') {
                showToast(`Case ${decision.toLowerCase()}d successfully.`, 'success');
                fetchAdminCases();
                navigateTo('/admin');
            } else {
                showToast(data.error || 'Action failed.', 'error');
            }
        } catch (error) {
            showToast('Review action failed.', 'error');
        }
    }

    if (approveBtn) approveBtn.addEventListener('click', () => handleReviewAction('Approve'));
    if (denyBtn) denyBtn.addEventListener('click', () => handleReviewAction('Deny'));
    if (revisionBtn) revisionBtn.addEventListener('click', () => handleReviewAction('Request Revision'));


    // ═══════════════════════════════════════════════════
    // 6. Settings Tab
    // ═══════════════════════════════════════════════════
    async function loadSettingsTab() {
        try {
            const resp = await fetch('/api/admin/settings');
            const settings = await resp.json();

            const el = (id) => document.getElementById(id);
            if (el('setting-university-name')) el('setting-university-name').value = settings.university_name || '';
            if (el('setting-draft-threshold')) el('setting-draft-threshold').value = settings.draft_save_threshold || '30';
            if (el('setting-submit-threshold')) el('setting-submit-threshold').value = settings.submit_threshold || '80';
            if (el('setting-delete-threshold')) el('setting-delete-threshold').value = settings.delete_allowed_below || '50';

            // Toggles
            const strict = el('toggle-strict-domain');
            if (strict) strict.classList.toggle('active', settings.strict_domain_mode === 'true');
            const evidence = el('toggle-require-evidence');
            if (evidence) evidence.classList.toggle('active', settings.require_evidence_links === 'true');
        } catch (e) {
            console.error('Failed to load settings', e);
        }
    }

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
            };

            try {
                const resp = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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


    // ═══════════════════════════════════════════════════
    // 7. Role Switcher
    // ═══════════════════════════════════════════════════
    const roleSwitchBtn = document.getElementById('role-switch-btn');
    const applicantNavWrapper = document.getElementById('applicant-nav-wrapper');
    const reviewerNavWrapper = document.getElementById('reviewer-nav-wrapper');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileName = document.getElementById('profile-name');
    const profileRole = document.getElementById('profile-role');

    let isReviewer = window.location.pathname.startsWith('/admin');

    function switchToReviewerNav() {
        isReviewer = true;
        if (applicantNavWrapper) applicantNavWrapper.style.display = 'none';
        if (reviewerNavWrapper) reviewerNavWrapper.style.display = 'block';
        if (profileAvatar) profileAvatar.innerText = 'AR';
        if (profileName) profileName.innerText = 'Admin Reviewer';
        if (profileRole) profileRole.innerText = 'Reviewer';
        const switchLabel = document.getElementById('role-switch-label');
        if (switchLabel) switchLabel.innerText = 'Switch to Applicant';
    }

    function switchToApplicantNav() {
        isReviewer = false;
        if (reviewerNavWrapper) reviewerNavWrapper.style.display = 'none';
        if (applicantNavWrapper) applicantNavWrapper.style.display = 'block';
        updateProfileDisplay();
        const switchLabel = document.getElementById('role-switch-label');
        if (switchLabel) switchLabel.innerText = 'Switch to Reviewer';
    }

    function updateProfileDisplay() {
        const name = applicantName || 'Applicant';
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'AP';
        if (profileAvatar) profileAvatar.innerText = initials;
        if (profileName) profileName.innerText = name;
        if (profileRole) profileRole.innerText = 'Applicant';
    }

    if (roleSwitchBtn) {
        roleSwitchBtn.addEventListener('click', () => {
            if (isReviewer) navigateTo('/');
            else navigateTo('/admin');
        });
    }


    // ═══════════════════════════════════════════════════
    // 8. Evidence Upload (Paperclip)
    // ═══════════════════════════════════════════════════
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.jpeg,.jpg,.png,.pdf,.doc,.docx,.md';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Wire paperclip button in chat input area
    const paperclipBtn = document.getElementById('chat-attach-btn');
    if (paperclipBtn) {
        paperclipBtn.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.click();
        });
    }

    // Also wire browse links in evidence tab
    const browseBtns = document.querySelectorAll('.dropzone .btn-secondary, .mini-dropzone a');
    browseBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            fileInput.click();
        });
    });

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const formData = new FormData();
            formData.append('file', file);
            formData.append('session_id', sessionId);
            if (currentCaseId) formData.append('case_id', currentCaseId);

            try {
                const response = await fetch('/api/evidence/upload', {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();
                if (response.ok && data.status === 'success') {
                    showToast(`${data.filename} uploaded successfully.`, 'success');

                    // Update evidence list in intake sidebar
                    const list = document.getElementById('intake-evidence-list');
                    if (list) {
                        if (list.querySelector('.text-muted')) list.innerHTML = '';
                        const icon = getFileIcon(data.filename);
                        list.innerHTML += `<div class="compact-file-item">
                            <i class="${icon}"></i>
                            <div class="compact-file-info"><span class="compact-file-name">${data.filename}</span></div>
                            <span class="badge green" style="font-size: 0.6rem;">Uploaded</span>
                        </div>`;
                    }

                    // Show attachment bubble in chat
                    if (chatTranscript) {
                        const attachDiv = document.createElement('div');
                        attachDiv.className = 'message user';
                        attachDiv.innerHTML = `<div class="avatar-small img">ME</div><div class="message-content"><p>📎 <em>${data.filename}</em> uploaded</p></div>`;
                        chatTranscript.appendChild(attachDiv);
                        chatTranscript.scrollTop = chatTranscript.scrollHeight;
                    }
                } else {
                    showToast(data.error || 'Upload failed.', 'error');
                }
            } catch (error) {
                showToast('Upload failed. Please try again.', 'error');
            }
            fileInput.value = '';
        }
    });


    // ═══════════════════════════════════════════════════
    // 9. Admin Toggles & Tabs
    // ═══════════════════════════════════════════════════
    const toggles = document.querySelectorAll('.toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('click', function () { this.classList.toggle('active'); });
    });

    const recordTabs = document.querySelectorAll('.record-tab');
    const recordTabContents = document.querySelectorAll('.record-tab-content');
    recordTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            recordTabs.forEach(t => t.classList.remove('active'));
            recordTabContents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });

    // Sidebar footer transition
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter) {
        sidebarFooter.style.opacity = '0';
        sidebarFooter.style.transform = 'translateY(10px)';
        sidebarFooter.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    }


    // ═══════════════════════════════════════════════════
    // 10. Utilities
    // ═══════════════════════════════════════════════════
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.innerText = text;
        return div.innerHTML;
    }

    function formatMarkdown(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    function formatTimestamp(ts) {
        try {
            const d = new Date(ts);
            return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch { return ts; }
    }

    function getBadgeClass(status) {
        const map = {
            'New': 'gray', 'Draft': 'gray', 'In Progress': 'blue',
            'Ready for Review': 'blue', 'Submitted': 'blue',
            'Under Review': 'yellow', 'Revision Requested': 'yellow',
            'Approved': 'green', 'Denied': 'red',
        };
        return map[status] || 'gray';
    }

    function getFileIcon(filename) {
        if (!filename) return 'ph-fill ph-file';
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'pdf': 'ph-fill ph-file-pdf', 'doc': 'ph-fill ph-file-text', 'docx': 'ph-fill ph-file-text',
            'png': 'ph-fill ph-image', 'jpg': 'ph-fill ph-image', 'jpeg': 'ph-fill ph-image',
            'md': 'ph-fill ph-file-text',
        };
        return icons[ext] || 'ph-fill ph-file';
    }


    // ═══════════════════════════════════════════════════
    // 11. Boot
    // ═══════════════════════════════════════════════════
    updateProfileDisplay();
    navigateTo(window.location.pathname, false);
});
