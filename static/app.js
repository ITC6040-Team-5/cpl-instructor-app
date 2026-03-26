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
    // Echo avatar — Eve-inspired inline SVG (oval head + pill eyes), no CDN dependency
    const ECHO_AVATAR = `<div class="avatar-small bg-ai"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="10" cy="10.5" rx="7" ry="8" fill="rgba(255,255,255,0.12)" stroke="white" stroke-width="1.4"/><rect x="4.5" y="9" width="4" height="2.5" rx="1.25" fill="white"/><rect x="11.5" y="9" width="4" height="2.5" rx="1.25" fill="white"/></svg></div>`;

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

    function getAdminHeaders() {
        const h = { 'Content-Type': 'application/json' };
        const token = sessionStorage.getItem('cpl_admin_token');
        if (token) h['X-Admin-Token'] = token;
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
        '/admin': 'Reviewer Portal / Case Queue',
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
        // Map sub-views to their parent nav item
        const navTargetMap = {
            'admin-review-screen': 'admin-dashboard-screen',
        };
        const highlightTarget = navTargetMap[targetId] || targetId;
        const activeNav = document.querySelector(`.nav-item[data-target="${highlightTarget}"]`);
        if (activeNav) {
            navItems.forEach(nav => nav.classList.remove('active'));
            activeNav.classList.add('active');
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

        // Chat screen: zero out screens-container padding so split-layout fills viewport
        const screensContainer = document.querySelector('.screens-container');
        if (screensContainer) {
            if (path === '/chat') {
                screensContainer.style.padding = '0';
                screensContainer.style.overflow = 'hidden';
            } else {
                screensContainer.style.padding = '';
                screensContainer.style.overflow = '';
            }
        }

        // Route-entry hooks
        if (path === '/cases') fetchApplicantCases();
        if (path === '/admin') { fetchAdminCases(); switchToReviewerNav(); }
        if (path === '/admin/settings') { loadSettingsTab(); switchToReviewerNav(); }
        if (path === '/' || path === '/chat' || path === '/cases') switchToApplicantNav();

        // Toggle primary action button visibility based on mode
        const primaryBtn = document.getElementById('primary-action-btn');
        if (primaryBtn) {
            primaryBtn.style.display = path.startsWith('/admin') ? 'none' : '';
        }
    };

    window.addEventListener('popstate', () => navigateTo(window.location.pathname, false));

    // Left sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const appContainer = document.querySelector('.app-container');
    if (sidebarToggle && appContainer) {
        sidebarToggle.addEventListener('click', () => appContainer.classList.toggle('collapsed'));
    }

    // Record sidebar (chat screen right panel) collapse toggle
    const recordSidebarToggle = document.getElementById('record-sidebar-toggle');
    const recordSidebar = document.getElementById('record-sidebar');
    if (recordSidebarToggle && recordSidebar) {
        recordSidebarToggle.addEventListener('click', () => {
            const isCollapsed = recordSidebar.classList.toggle('collapsed');
            recordSidebarToggle.querySelector('i').className = isCollapsed
                ? 'ph ph-caret-left'
                : 'ph ph-caret-right';
        });
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
        loadingDiv.innerHTML = `${ECHO_AVATAR}<div class="message-content"><p class="text-muted"><i class="ph ph-spinner ph-spin"></i> Echo is thinking...</p></div>`;
        chatTranscript.appendChild(loadingDiv);
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        try {
            const payload = { message: text, session_id: sessionId };
            if (applicantName) payload.applicant_name = applicantName;
            if (studentId) payload.student_id = studentId;

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(payload),
            });

            // Swap loading indicator for the assistant bubble
            chatTranscript.removeChild(loadingDiv);
            const aiDiv = document.createElement('div');
            aiDiv.className = 'message assistant';
            const msgContent = document.createElement('div');
            msgContent.className = 'message-content';
            const textP = document.createElement('p');
            msgContent.appendChild(textP);
            aiDiv.innerHTML = ECHO_AVATAR;
            aiDiv.appendChild(msgContent);
            chatTranscript.appendChild(aiDiv);

            // Consume SSE stream token-by-token
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullAnswer = '';
            let doneEvt = null;

            streamLoop: while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // hold back incomplete last line

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const evt = JSON.parse(line.slice(6));
                        if (evt.error) {
                            showToast(evt.error, 'error');
                            textP.style.color = 'var(--status-red-text)';
                            textP.innerText = evt.error;
                            break streamLoop;
                        }
                        if (evt.token) {
                            fullAnswer += evt.token;
                            textP.innerHTML = formatMarkdown(fullAnswer);
                            chatTranscript.scrollTop = chatTranscript.scrollHeight;
                        }
                        if (evt.done) {
                            doneEvt = evt;
                            break streamLoop;
                        }
                    } catch (_) { /* skip malformed SSE lines */ }
                }
            }

            if (!fullAnswer && !doneEvt) {
                textP.innerText = 'Sorry, I could not process that.';
            }

            // Apply state from the final done event
            const meta = doneEvt || {};
            if (meta.case_id) currentCaseId = meta.case_id;
            if (meta.completion_pct !== undefined) currentCompletionPct = meta.completion_pct;
            if (meta.applicant_name && !applicantName) {
                applicantName = meta.applicant_name;
                localStorage.setItem('cpl_applicant_name', applicantName);
                updateProfileDisplay();
            }
            if (meta.student_id && !studentId) {
                studentId = meta.student_id;
                localStorage.setItem('cpl_student_id', studentId);
            }
            chatHasUnsavedContent = !meta.draft_saved;
            if (meta.draft_saved && meta.status === 'Draft') {
                if (!sessionStorage.getItem(`draft_toast_${sessionId}`)) {
                    showToast('Draft saved — you can return to this case later.', 'success');
                    sessionStorage.setItem(`draft_toast_${sessionId}`, '1');
                }
            }
            if (meta.case_id) updateIntakeSidebar(meta);

        } catch (error) {
            if (chatTranscript.contains(loadingDiv)) chatTranscript.removeChild(loadingDiv);
            showToast('Error connecting to backend. Please try again.', 'error');
            const errDiv = document.createElement('div');
            errDiv.className = 'message assistant';
            errDiv.innerHTML = `${ECHO_AVATAR}<div class="message-content"><p style="color: var(--status-red-text);">Connection error. Please try again.</p></div>`;
            chatTranscript.appendChild(errDiv);
        }
    }

    function updateIntakeSidebar(data) {
        const el = (id) => document.getElementById(id);

        if (el('intake-case-id')) el('intake-case-id').innerText = data.case_id || '—';
        if (el('intake-case-status')) el('intake-case-status').innerText = data.status || 'New';
        if (el('intake-target-course')) el('intake-target-course').innerText = data.target_course || '—';
        if (el('intake-case-summary')) el('intake-case-summary').innerText = data.summary || 'Building case from conversation...';

        // Update chat header with case title when course is known
        const chatHeaderTitle = document.querySelector('.chat-header h2');
        if (chatHeaderTitle && data.case_id) {
            const seq = data.case_id.split('-').pop();
            const course = data.target_course && data.target_course !== '—' ? ` — ${data.target_course}` : '';
            chatHeaderTitle.innerText = `Case #${seq}${course}`;
        }

        // Claimed Competencies tags
        if (data.claimed_competencies) {
            try {
                const competencies = typeof data.claimed_competencies === 'string'
                    ? JSON.parse(data.claimed_competencies)
                    : data.claimed_competencies;
                const section = el('intake-competencies-section');
                const list = el('intake-competencies-list');
                if (section && list && competencies && competencies.length > 0) {
                    section.style.display = 'block';
                    list.innerHTML = competencies.map(c =>
                        `<span class="competency-tag confirmed">${escapeHtml(c)}</span>`
                    ).join('');
                }
            } catch(e) { /* non-fatal */ }
        }

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

        // Fix 6: Check if user has existing draft to resume
        const resumeKeywords = ['resume', 'continue', 'draft', 'my draft', 'existing'];
        const isResumeAttempt = resumeKeywords.some(k => promptText.toLowerCase().includes(k));

        if (isResumeAttempt && studentId) {
            // Try to find existing draft and navigate to it
            fetch('/api/cases', { headers: getRequestHeaders() })
                .then(r => r.json())
                .then(data => {
                    const draft = (data.cases || []).find(c => ['Draft', 'In Progress', 'New'].includes(c.status));
                    if (draft && draft.session_id) {
                        sessionId = draft.session_id;
                        localStorage.setItem('cpl_session_id', sessionId);
                        currentCaseId = draft.case_id;
                        currentCompletionPct = draft.completion_pct || 0;
                        chatHasUnsavedContent = false;
                        if (chatTranscript) chatTranscript.innerHTML = '';
                        navigateTo('/chat');
                        showToast('Resuming your existing draft.', 'info');
                        // Load existing messages
                        appendUserMessage(promptText);
                    } else {
                        // No draft found, start fresh
                        _startFreshChat(promptText);
                    }
                })
                .catch(() => _startFreshChat(promptText));
            return;
        }

        _startFreshChat(promptText);
    }

    function _startFreshChat(promptText) {
        // Fresh session
        sessionId = 'session_' + crypto.randomUUID().slice(0, 12);
        localStorage.setItem('cpl_session_id', sessionId);
        
        // Fix for identity bleed: Treat as completely fresh unless restoring session
        localStorage.removeItem('cpl_applicant_name');
        localStorage.removeItem('cpl_student_id');
        applicantName = '';
        studentId = '';

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
                            div.innerHTML = `<div class="avatar-small bg-ai"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg></div><div class="message-content"><p>${formatMarkdown(msg.content)}</p></div>`;
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
                    <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg>' : 'ST'}</div>
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
    let _allAdminCases = []; // cache for client-side filtering
    let _adminSortKey = 'updated_at';
    let _adminSortAsc = false;
    let _adminFilter = 'all';

    function formatTimestamp(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                 + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        } catch { return ts; }
    }

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

    function renderAdminTable() {
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
                <td class="font-mono text-sm">${c.case_id}</td>
                <td>
                    <div class="flex-align-center gap-2">
                        <div class="avatar-small img">${initials}</div>
                        <div>
                            <strong>${c.applicant || 'Unknown'}</strong>
                            ${c.student_id ? `<span class="text-xs text-muted" style="display:block">${c.student_id}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td>${c.target_course || '—'}</td>
                <td><span class="badge ${badgeClass}">${c.status}</span></td>
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
                <td class="text-sm text-muted">${formatTimestamp(c.updated_at)}</td>
                <td><button class="btn-icon"><i class="ph ph-caret-right"></i></button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    async function fetchAdminCases() {
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
                        <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg>' : (data.applicant_name || 'ST').substring(0, 2).toUpperCase()}</div>
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

            // Load per-case reviewer checks (W3)
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

    // Persist reviewer checks on change
    document.getElementById('check-rubric-assessed')?.addEventListener('change', saveReviewerChecks);
    document.getElementById('check-identity-verified')?.addEventListener('change', saveReviewerChecks);

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

    // Review actions
    const reviewBackBtn = document.getElementById('review-back-btn');
    if (reviewBackBtn) reviewBackBtn.addEventListener('click', () => navigateTo('/admin'));

    const approveBtn = document.getElementById('admin-approve-btn');
    const denyBtn = document.getElementById('admin-deny-btn');
    const revisionBtn = document.getElementById('request-revision-btn');

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

    // ── Knowledge Base CRUD ────────────────────────────────────────
    async function loadKnowledgeBase() {
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

    window.deleteKBEntry = async function(id) {
        try {
            const resp = await fetch(`/api/admin/knowledge/${id}`, { method: 'DELETE', headers: getAdminHeaders() });
            if (resp.ok) { showToast('Entry removed.', 'success'); loadKnowledgeBase(); }
            else showToast('Failed to remove entry.', 'error');
        } catch(e) { showToast('Failed to remove entry.', 'error'); }
    };

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


    // ═══════════════════════════════════════════════════
    // 7. Role Switcher + Admin Authentication
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

    // Admin login modal logic
    function showAdminLoginModal() {
        const modal = document.getElementById('admin-login-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        const emailEl = document.getElementById('admin-login-email');
        if (emailEl) { emailEl.value = ''; emailEl.focus(); }
        const pwEl = document.getElementById('admin-login-password');
        if (pwEl) pwEl.value = '';
        const errEl = document.getElementById('admin-login-error');
        if (errEl) errEl.style.display = 'none';
    }

    function hideAdminLoginModal() {
        const modal = document.getElementById('admin-login-modal');
        if (modal) modal.style.display = 'none';
    }

    function resetStudentSession() {
        // Clear any draft toast flag for the current session before changing session ID
        sessionStorage.removeItem(`draft_toast_${sessionId}`);

        // Generate a fresh session ID
        const newSessionId = 'session_' + crypto.randomUUID().slice(0, 12);

        // Reset localStorage identity — existing DB records are untouched
        localStorage.removeItem('cpl_applicant_name');
        localStorage.removeItem('cpl_student_id');
        localStorage.setItem('cpl_session_id', newSessionId);

        // Reset in-memory state
        sessionId = newSessionId;
        applicantName = '';
        studentId = '';
        currentCaseId = null;
        currentCompletionPct = 0;
        chatHasUnsavedContent = false;

        // Clear chat transcript
        if (chatTranscript) chatTranscript.innerHTML = '';

        // Reset intake sidebar to blank state
        updateIntakeSidebar({ case_id: '—', status: 'New', completion_pct: 0, can_submit: false });

        // Update profile display to anonymous
        updateProfileDisplay();

        // Close modal and return to home
        hideAdminLoginModal();
        navigateTo('/');

        showToast('Student session reset. Ready for a fresh demo.', 'success');
    }

    document.getElementById('reset-student-btn')?.addEventListener('click', resetStudentSession);

    async function attemptAdminLogin() {
        const email = document.getElementById('admin-login-email')?.value?.trim() || '';
        const password = document.getElementById('admin-login-password')?.value || '';
        const errEl = document.getElementById('admin-login-error');

        if (!email || !password) {
            if (errEl) { errEl.textContent = 'Please enter both email and password.'; errEl.style.display = 'block'; }
            return;
        }

        try {
            // Hash password with SHA-256 before sending (frontend-side securing)
            const msgBuffer = new TextEncoder().encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashedPassword = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            const resp = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: hashedPassword }),
            });
            const data = await resp.json();
            if (resp.ok && data.token) {
                sessionStorage.setItem('cpl_admin_token', data.token);
                hideAdminLoginModal();
                showToast(data.message || 'Signed in as reviewer.', 'success');
                navigateTo('/admin');
            } else {
                if (errEl) { errEl.textContent = data.error || 'Invalid credentials.'; errEl.style.display = 'block'; }
            }
        } catch (e) {
            if (errEl) { errEl.textContent = 'Login failed. Please try again.'; errEl.style.display = 'block'; }
        }
    }

    function handleAdminLogout() {
        const token = sessionStorage.getItem('cpl_admin_token');
        if (token) {
            fetch('/api/admin/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
            }).catch(() => {});
        }
        sessionStorage.removeItem('cpl_admin_token');
        navigateTo('/');
    }

    // Wire login modal buttons
    document.getElementById('admin-login-submit')?.addEventListener('click', attemptAdminLogin);
    document.getElementById('admin-login-cancel')?.addEventListener('click', hideAdminLoginModal);
    document.getElementById('admin-login-close')?.addEventListener('click', hideAdminLoginModal);
    document.getElementById('admin-login-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptAdminLogin();
    });

    if (roleSwitchBtn) {
        roleSwitchBtn.addEventListener('click', () => {
            if (isReviewer) {
                handleAdminLogout();
            } else {
                // Show login modal instead of direct toggle
                showAdminLoginModal();
            }
        });
    }

    // On page load, check if admin token exists for admin routes
    if (window.location.pathname.startsWith('/admin')) {
        const token = sessionStorage.getItem('cpl_admin_token');
        if (!token) {
            // Redirect to home if no admin token
            navigateTo('/', false);
        }
    }


    // ═══════════════════════════════════════════════════
    // 7b. Escalation Drawer (W4)
    // ═══════════════════════════════════════════════════
    const escalateBtn = document.getElementById('admin-escalate-btn');
    const escalationDrawer = document.getElementById('escalation-drawer');
    const escalationCloseBtn = document.getElementById('escalation-drawer-close');
    const escalationPrepareBtn = document.getElementById('escalation-prepare-btn');

    function openEscalationDrawer() {
        const caseId = window.currentReviewCaseId;
        if (!caseId) { showToast('No case selected.', 'warning'); return; }
        const caseRef = document.getElementById('escalation-case-ref');
        const applicantEl = document.getElementById('escalation-applicant');
        if (caseRef) caseRef.textContent = caseId;
        if (applicantEl) {
            applicantEl.textContent = document.getElementById('review-applicant-name')?.textContent || '—';
        }
        if (escalationDrawer) {
            requestAnimationFrame(() => escalationDrawer.classList.add('drawer-visible'));
        }
    }

    function closeEscalationDrawer() {
        if (escalationDrawer) escalationDrawer.classList.remove('drawer-visible');
    }

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
                    navigateTo('/admin');
                } else {
                    showToast(data.error || 'Failed to record escalation.', 'error');
                }
            } catch (e) {
                showToast('Failed to record escalation.', 'error');
            }
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
        if (!text) return '';
        // Bold and italic
        let result = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');

        // Numbered lists: lines starting with "1. ", "2. " etc.
        result = result.replace(/((?:^\d+\.\s+.+(?:\n|$))+)/gm, (match) => {
            const items = match.trim().split('\n').map(line =>
                `<li>${line.replace(/^\d+\.\s+/, '')}</li>`
            ).join('');
            return `<ol>${items}</ol>`;
        });

        // Bullet lists: lines starting with "- " or "• "
        result = result.replace(/((?:^[-•]\s+.+(?:\n|$))+)/gm, (match) => {
            const items = match.trim().split('\n').map(line =>
                `<li>${line.replace(/^[-•]\s+/, '')}</li>`
            ).join('');
            return `<ul>${items}</ul>`;
        });

        // Paragraph breaks (double newline) → paragraph gap
        result = result.replace(/\n\n+/g, '</p><p>');
        // Single newlines → <br>
        result = result.replace(/\n/g, '<br>');

        return result;
    }



    function getBadgeClass(status) {
        const map = {
            'New': 'gray', 'Draft': 'gray', 'In Progress': 'blue',
            'Ready for Review': 'blue', 'Submitted': 'blue',
            'Under Review': 'yellow', 'Revision Requested': 'yellow',
            'Escalated': 'orange',
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
    // 11. Global Search Bar (Fix 9)
    // ═══════════════════════════════════════════════════
    const globalSearchInput = document.getElementById('global-search-input');
    if (globalSearchInput) {
        globalSearchInput.addEventListener('keypress', async (e) => {
            if (e.key !== 'Enter') return;
            const query = globalSearchInput.value.trim();
            if (!query) return;

            // Only search if user has admin token
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

    // ═══════════════════════════════════════════════════
    // 12. Session Recovery on Refresh (Fix 10)
    // ═══════════════════════════════════════════════════
    async function attemptSessionRecovery() {
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
                    sessionId = savedSession;
                    // Reload messages into transcript
                    if (chatTranscript) {
                        chatTranscript.innerHTML = '';
                        data.messages.forEach(msg => {
                            const div = document.createElement('div');
                            div.className = `message ${msg.role}`;
                            const isAI = msg.role === 'assistant';
                            div.innerHTML = `
                                <div class="avatar-small ${isAI ? 'bg-ai' : 'img'}">${isAI ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.7 5.3 L12 7 L7.7 8.7 L7 13 L6.3 8.7 L2 7 L6.3 5.3 Z" fill="white" opacity="0.95"/></svg>' : (applicantName || 'ME').substring(0, 2).toUpperCase()}</div>
                                <div class="message-content"><p>${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</p></div>
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
                                currentCaseId = activeCase.case_id;
                                currentCompletionPct = activeCase.completion_pct || 0;
                                updateIntakeSidebar(activeCase);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('Session recovery failed (non-fatal):', err);
        }
    }


    // ═══════════════════════════════════════════════════
    // 13. Boot
    // ═══════════════════════════════════════════════════
    updateProfileDisplay();
    navigateTo(window.location.pathname, false);

    // Attempt session recovery after initial navigation
    attemptSessionRecovery();
});
