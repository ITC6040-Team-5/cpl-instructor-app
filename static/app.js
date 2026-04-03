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
    // Echo avatar — 4-pointed star on sienna→gold gradient (no CDN dependency)
    const ECHO_AVATAR = `<div class="echo-avatar"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 1 L7.8 5.2 L12 7 L7.8 8.8 L7 13 L6.2 8.8 L2 7 L6.2 5.2 Z" fill="white" opacity="0.95"/></svg></div>`;

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
        '/evidence': 'evidence-screen',
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
        '/evidence': 'Applicant View / Evidence Vault',
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

        // Full-bleed screens: zero out container padding so layouts fill viewport correctly
        const screensContainer = document.querySelector('.screens-container');
        if (screensContainer) {
            const fullBleed = path === '/chat'
                || path.startsWith('/admin/review')
                || path === '/admin';
            if (fullBleed) {
                screensContainer.style.padding = '0';
                screensContainer.style.overflow = 'hidden';
            } else {
                screensContainer.style.padding = '';
                screensContainer.style.overflow = '';
            }
        }

        // Route-entry hooks
        if (path === '/') { renderRecentCasesStrip(); exitSessionMode(); }
        if (path === '/cases') { fetchApplicantCases(); exitSessionMode(); }
        if (path === '/evidence') { loadEvidenceVault(); exitSessionMode(); }
        if (path === '/admin') { fetchAdminCases(); switchToReviewerNav(); }
        if (path === '/admin/settings') { loadSettingsTab(); switchToReviewerNav(); }
        if (path === '/' || path === '/chat' || path === '/cases' || path === '/evidence') switchToApplicantNav();
        // On /chat restore session context if case is active
        if (path === '/chat' && currentCaseId) {
            enterSessionMode(currentCaseId, applicantName);
        }

        // Update topbar nav active state
        renderTopbarNav(path.startsWith('/admin') ? 'reviewer' : 'applicant', path);

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

    // Build avatar HTML for a given role
    function makeAvatarHTML(role) {
        if (role === 'echo') return ECHO_AVATAR;
        const initials = applicantName
            ? applicantName.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2)
            : 'YO';
        return `<div class="user-chat-avatar">${escapeHtml(initials)}</div>`;
    }

    function makeSenderLabel(role) {
        if (role === 'echo') return `<div class="script-sender echo">Echo</div>`;
        const first = applicantName ? applicantName.split(' ')[0] : 'You';
        return `<div class="script-sender user">${escapeHtml(first)}</div>`;
    }

    async function appendScriptMessage(text) {
        if (!text.trim()) return;

        // User message — avatar + sender label + prose
        const userRow = document.createElement('div');
        userRow.className = 'script-message';
        userRow.innerHTML = `
            <div class="script-avatar-col">${makeAvatarHTML('user')}</div>
            <div class="script-body">
                ${makeSenderLabel('user')}
                <div class="script-prose">${escapeHtml(text)}</div>
            </div>
        `;
        chatTranscript.appendChild(userRow);
        chatInput.value = '';
        chatInput.style.height = 'auto';
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        // Echo loading row — avatar + sender + typing indicator
        const loadingRow = document.createElement('div');
        loadingRow.className = 'script-message';
        loadingRow.innerHTML = `
            <div class="script-avatar-col">${ECHO_AVATAR}</div>
            <div class="script-body">
                <div class="script-sender echo">Echo</div>
                <div class="script-prose"><span class="script-typing">● RESPONDING</span></div>
            </div>
        `;
        chatTranscript.appendChild(loadingRow);
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        // Disable send button while waiting
        if (chatSendBtn) chatSendBtn.disabled = true;

        try {
            const payload = { message: text, session_id: sessionId };
            if (applicantName) payload.applicant_name = applicantName;
            if (studentId) payload.student_id = studentId;

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(payload),
            });

            // Swap loading row for Echo's real response row (built with DOM for proseEl ref)
            chatTranscript.removeChild(loadingRow);
            const echoRow = document.createElement('div');
            echoRow.className = 'script-message';
            const avatarCol = document.createElement('div');
            avatarCol.className = 'script-avatar-col';
            avatarCol.innerHTML = ECHO_AVATAR;
            const bodyEl = document.createElement('div');
            bodyEl.className = 'script-body';
            const senderEl = document.createElement('div');
            senderEl.className = 'script-sender echo';
            senderEl.textContent = 'Echo';
            const proseEl = document.createElement('div');
            proseEl.className = 'script-prose';
            bodyEl.appendChild(senderEl);
            bodyEl.appendChild(proseEl);
            echoRow.appendChild(avatarCol);
            echoRow.appendChild(bodyEl);
            chatTranscript.appendChild(echoRow);

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
                            proseEl.style.color = 'var(--color-denied)';
                            proseEl.innerText = evt.error;
                            break streamLoop;
                        }
                        if (evt.token) {
                            fullAnswer += evt.token;
                            proseEl.innerHTML = formatMarkdown(fullAnswer);
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
                proseEl.innerText = 'Sorry, I could not process that.';
            }

            // Manila highlight — emerges 600ms after stream completes
            setTimeout(() => {
                echoRow.querySelectorAll('.manila').forEach(el => el.classList.add('active'));
            }, 600);

            // Apply state from the final done event
            const meta = doneEvt || {};
            if (meta.case_id) currentCaseId = meta.case_id;
            if (meta.completion_pct !== undefined) currentCompletionPct = meta.completion_pct;
            if (meta.applicant_name && !applicantName) {
                applicantName = meta.applicant_name;
                localStorage.setItem('cpl_applicant_name', applicantName);
                updateProfileDisplay();
                updateUserAvatar(applicantName);
                // Update studio context bar + session context
                enterSessionMode(meta.case_id, meta.applicant_name);
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
            if (meta.case_id) {
                updateIntakeSidebar(meta);
                enterSessionMode(meta.case_id, meta.applicant_name || applicantName);
            }

        } catch (error) {
            if (chatTranscript.contains(loadingRow)) chatTranscript.removeChild(loadingRow);
            showToast('Error connecting to backend. Please try again.', 'error');
            const errRow = document.createElement('div');
            errRow.className = 'script-message';
            errRow.innerHTML = `
                <div class="script-avatar-col">${ECHO_AVATAR}</div>
                <div class="script-body">
                    <div class="script-sender echo">Echo</div>
                    <div class="script-prose" style="color: var(--color-denied);">Connection error. Please try again.</div>
                </div>
            `;
            chatTranscript.appendChild(errRow);
        } finally {
            if (chatSendBtn) chatSendBtn.disabled = false;
        }
    }

    // Keep old name as alias for backward compat with any remaining call sites
    const appendUserMessage = appendScriptMessage;

    function updateIntakeSidebar(data) {
        const el = (id) => document.getElementById(id);

        if (el('intake-case-id')) el('intake-case-id').innerText = data.case_id || '—';
        if (el('intake-case-status')) el('intake-case-status').innerText = data.status || 'New';
        if (el('intake-target-course')) el('intake-target-course').innerText = data.target_course || '—';

        // Summary — show the area when a real summary arrives
        const summaryArea = el('intake-summary-area');
        const summaryText = el('intake-case-summary');
        if (summaryText && data.summary && data.summary.length > 10) {
            summaryText.innerText = data.summary;
            if (summaryArea) summaryArea.style.display = 'block';
        }

        // Rail header status badge
        const statusBadge = el('rail-status-badge');
        if (statusBadge && data.status) statusBadge.innerText = data.status;

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
                // Also populate the insight rail
                openInsightRail(competencies, data);
            } catch(e) { /* non-fatal */ }
        }

        // Progress bar — update both old sidebar (if present) and new insight rail footer
        const pct = data.completion_pct || 0;
        const progressFill = document.getElementById('studio-progress-fill') || document.querySelector('.record-footer .progress-bar-fill');
        const progressText = document.getElementById('studio-progress-text') || document.querySelector('.record-footer .progress-text');
        if (progressFill) progressFill.style.width = pct + '%';
        if (progressText) progressText.innerText = pct + '% Complete';

        // Submit button gating
        const submitBtn = document.getElementById('submit-for-review-btn');
        if (submitBtn) {
            submitBtn.disabled = !data.can_submit;
            submitBtn.title = data.can_submit ? 'Submit your case for review' : `Case must be at least 80% complete (currently ${pct}%)`;
        }
    }

    function openInsightRail(competencies, data) {
        const rail = document.getElementById('insight-rail');
        const content = document.getElementById('insight-cards-container');
        if (!rail || !content) return;

        // Build competency cards
        const cards = [];
        if (competencies && competencies.length > 0) {
            competencies.forEach(c => {
                cards.push(`<div class="insight-card-v3">
                    <div class="insight-card-category">Competency <span class="insight-conf-badge">EXTRACTED</span></div>
                    <div class="insight-card-body">${escapeHtml(c)}</div>
                </div>`);
            });
            content.innerHTML = cards.join('');
            rail.classList.add('open'); // expand rail width when insights arrive
        }

        // Always update the visible case meta section when data is available
        if (data) {
            const el = id => document.getElementById(id);
            if (data.target_course && data.target_course !== '—') {
                if (el('intake-target-course')) el('intake-target-course').innerText = data.target_course;
            }
            if (data.case_id) {
                if (el('intake-case-id')) el('intake-case-id').innerText = data.case_id;
            }
        }
    }

    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', () => {
            appendUserMessage(chatInput.value);
            chatInput.style.height = 'auto';
        });

        // Auto-resize textarea up to 3 lines
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 84) + 'px';
        });

        // Enter sends, Shift+Enter adds newline
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                appendUserMessage(chatInput.value);
                chatInput.style.height = 'auto';
            }
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
    // 3b. Recent Cases Strip (Landing screen)
    // ═══════════════════════════════════════════════════
    async function renderRecentCasesStrip() {
        const strip = document.getElementById('recent-cases-strip');
        const list = document.getElementById('recent-cases-list');
        if (!strip || !list) return;
        try {
            const resp = await fetch('/api/cases', { headers: getRequestHeaders() });
            if (!resp.ok) return;
            const data = await resp.json();
            const cases = (data.cases || []).slice(0, 3);
            if (cases.length === 0) { strip.style.display = 'none'; return; }
            list.innerHTML = cases.map(c => {
                const seq = c.case_id ? c.case_id.split('-').pop() : '—';
                const course = c.target_course && c.target_course !== '—' ? c.target_course : 'Course TBD';
                return `<div class="recent-case-row">
                    <span class="recent-case-id">${escapeHtml(c.case_id || '—')}</span>
                    <span class="recent-case-name">${escapeHtml(course)}</span>
                    <a class="recent-case-resume" href="/chat"
                       onclick="event.preventDefault(); navigateTo('/chat');">Resume →</a>
                </div>`;
            }).join('');
            strip.style.display = 'block';
        } catch (e) {
            strip.style.display = 'none';
        }
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
                container.innerHTML = `
                    <div class="docket-card-v3" style="cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:160px;gap:0.5rem;"
                         onclick="navigateTo('/chat')">
                        <span style="font-size:1.5rem;color:var(--color-border);">+</span>
                        <span style="font-family:var(--font-display);font-style:italic;color:var(--color-muted);font-size:0.95rem;">Start your first evaluation</span>
                    </div>
                `;
                return;
            }

            data.cases.forEach((c, idx) => {
                const pct = c.completion_pct || 0;
                const courseName = c.target_course || 'Untitled case';
                const div = document.createElement('div');
                div.className = 'docket-card-v3';
                div.innerHTML = `
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
                        <span class="docket-card-id">${escapeHtml(c.case_id)}</span>
                        <span class="badge ${getBadgeClass(c.status)}" style="font-size:10px;">${escapeHtml(c.status)}</span>
                    </div>
                    <div class="docket-card-name">${escapeHtml(courseName)}</div>
                    <div style="font-family:var(--font-mono);font-size:10px;color:var(--color-muted);margin-bottom:0.75rem;">${c.created_at ? formatTimestamp(c.created_at) : ''}</div>
                    <div class="progress-bar-track" style="height:3px;">
                        <div class="progress-bar-fill" style="width:${pct}%;height:3px;"></div>
                    </div>
                    <div style="font-family:var(--font-mono);font-size:10px;color:var(--color-muted);margin-top:0.25rem;">${pct}% complete</div>
                `;
                div.addEventListener('click', () => loadCaseDetail(c.case_id, c.index || idx + 1));
                container.appendChild(div);
            });

            // New Case card at the end
            const newCard = document.createElement('div');
            newCard.className = 'docket-card-v3';
            newCard.style.cssText = 'cursor:pointer;border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:160px;gap:0.5rem;';
            newCard.innerHTML = `<span style="font-size:1.5rem;color:var(--color-border);">+</span><span style="font-family:var(--font-display);font-style:italic;color:var(--color-muted);font-size:0.9rem;">New evaluation</span>`;
            newCard.addEventListener('click', () => navigateTo('/chat'));
            container.appendChild(newCard);
        } catch (e) {
            console.error('Failed to fetch cases', e);
            showToast('Failed to load cases.', 'error');
        }
    }

    async function loadEvidenceVault() {
        const claimsList = document.getElementById('vault-claims-list');
        const claimsCount = document.getElementById('vault-claims-count');
        const evidenceGrid = document.getElementById('vault-evidence-grid');

        if (!currentCaseId) {
            if (claimsList) claimsList.innerHTML = '<p class="text-muted" style="font-style:italic;font-size:var(--text-sm);padding:var(--space-4) 0;">No active case. Start a Studio session first.</p>';
            if (evidenceGrid) evidenceGrid.innerHTML = '<p class="text-muted" style="font-style:italic;font-size:var(--text-sm);grid-column:1/-1;">No active case.</p>';
            return;
        }

        try {
            const resp = await fetch(`/api/case/${currentCaseId}`, { headers: getRequestHeaders() });
            if (!resp.ok) return;
            const data = await resp.json();

            // Populate claims from claimed_competencies
            if (claimsList) {
                const comps = data.claimed_competencies
                    ? (typeof data.claimed_competencies === 'string' ? JSON.parse(data.claimed_competencies) : data.claimed_competencies)
                    : [];
                if (comps && comps.length > 0) {
                    if (claimsCount) claimsCount.textContent = `${comps.length} EXTRACTED`;
                    claimsList.innerHTML = comps.map(c => `
                        <div class="claim-card">
                            <div class="claim-competency">${escapeHtml(c)}</div>
                            <div class="claim-link-status">Extracted from conversation</div>
                        </div>`).join('');
                } else {
                    if (claimsCount) claimsCount.textContent = '0 EXTRACTED';
                    claimsList.innerHTML = '<p class="text-muted" style="font-style:italic;font-size:var(--text-sm);padding:var(--space-4) 0;">No competencies identified yet. Continue your Studio session.</p>';
                }
            }

            // Populate evidence grid
            if (evidenceGrid) {
                const evidence = data.evidence || [];
                if (evidence.length === 0) {
                    evidenceGrid.innerHTML = '<p class="text-muted" style="font-style:italic;font-size:var(--text-sm);grid-column:1/-1;">No evidence files yet.</p>';
                } else {
                    evidenceGrid.innerHTML = evidence.map(ev => {
                        const ext = ev.file_name.split('.').pop().toLowerCase();
                        const isLinked = ev.status === 'Uploaded';
                        const downloadUrl = `/api/evidence/download/${currentCaseId}/${encodeURIComponent(ev.file_name)}`;
                        const iconClass = ext === 'pdf' ? 'ph-fill ph-file-pdf' : ext === 'png' || ext === 'jpg' || ext === 'jpeg' ? 'ph-fill ph-image' : 'ph-fill ph-file-text';
                        return `
                            <div class="evidence-file-card">
                                <div class="evidence-thumb">
                                    <i class="${iconClass}" style="font-size:2rem;color:var(--color-muted);"></i>
                                </div>
                                <div class="evidence-file-meta">
                                    <div class="evidence-file-name" title="${escapeHtml(ev.file_name)}">${escapeHtml(ev.file_name.length > 22 ? ev.file_name.substring(0,20)+'…' : ev.file_name)}</div>
                                    <a href="${downloadUrl}" target="_blank" rel="noopener" style="display:block;margin-top:2px;">
                                        <span class="evidence-link-badge ${isLinked ? 'linked' : 'unlinked'}">${isLinked ? 'Uploaded' : 'Pending'}</span>
                                    </a>
                                </div>
                            </div>`;
                    }).join('');
                }
            }
        } catch (e) {
            console.warn('loadEvidenceVault error:', e);
        }
    }

    // Wire vault upload button
    document.addEventListener('click', (e) => {
        if (e.target.closest('#vault-upload-btn')) {
            document.getElementById('vault-file-input')?.click();
        }
    });
    const vaultFileInput = document.getElementById('vault-file-input');
    if (vaultFileInput) {
        vaultFileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || !files.length || !currentCaseId) return;
            for (const file of files) {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('case_id', currentCaseId);
                try {
                    const resp = await fetch('/api/evidence/upload', { method: 'POST', body: formData });
                    const result = await resp.json();
                    if (result.error) { showToast(`Upload failed: ${result.error}`, 'error'); }
                    else { showToast(`Uploaded: ${file.name}`, 'success'); }
                } catch(err) { showToast('Upload failed', 'error'); }
            }
            vaultFileInput.value = '';
            loadEvidenceVault();
        });
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
                        const row = document.createElement('div');
                        row.className = 'script-message';
                        if (isAI) {
                            const avatarCol = document.createElement('div');
                            avatarCol.className = 'script-avatar-col';
                            avatarCol.innerHTML = ECHO_AVATAR;
                            const body = document.createElement('div');
                            body.className = 'script-body';
                            body.innerHTML = `<div class="script-sender echo">Echo</div><div class="script-prose">${formatMarkdown(msg.content)}</div>`;
                            row.appendChild(avatarCol);
                            row.appendChild(body);
                        } else {
                            row.innerHTML = `
                                <div class="script-avatar-col">${makeAvatarHTML('user')}</div>
                                <div class="script-body">
                                    ${makeSenderLabel('user')}
                                    <div class="script-prose">${escapeHtml(msg.content)}</div>
                                </div>`;
                        }
                        chatTranscript.appendChild(row);
                    });
                    chatTranscript.scrollTop = chatTranscript.scrollHeight;
                }
                updateIntakeSidebar({
                    case_id: detail.case_id,
                    status: detail.status,
                    completion_pct: detail.completion_pct,
                    target_course: detail.target_course,
                    summary: detail.summary,
                    claimed_competencies: detail.claimed_competencies,
                    can_submit: (detail.completion_pct || 0) >= 80,
                });
                if (detail.case_id) enterSessionMode(detail.case_id, detail.applicant_name || applicantName);

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
            <div class="drawer-body script-transcript" style="padding: var(--space-4);">`;

        if (caseData.messages && caseData.messages.length > 0) {
            const drawerName = caseData.applicant_name || applicantName || 'Student';
            const drawerInitials = drawerName.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2);
            const drawerFirst = drawerName.split(' ')[0];
            caseData.messages.forEach(msg => {
                const isAI = msg.role === 'assistant';
                if (isAI) {
                    html += `<div class="script-message">
                        <div class="script-avatar-col">${ECHO_AVATAR}</div>
                        <div class="script-body">
                            <div class="script-sender echo">Echo</div>
                            <div class="script-prose">${formatMarkdown(msg.content)}</div>
                        </div>
                    </div>`;
                } else {
                    html += `<div class="script-message">
                        <div class="script-avatar-col"><div class="user-chat-avatar">${escapeHtml(drawerInitials)}</div></div>
                        <div class="script-body">
                            <div class="script-sender user">${escapeHtml(drawerFirst)}</div>
                            <div class="script-prose">${escapeHtml(msg.content)}</div>
                        </div>
                    </div>`;
                }
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

    // ── Card view renderer ────────────────────────────────────────────────
    function renderAdminCards() {
        const container = document.getElementById('queue-card-view');
        if (!container) return;
        const cases = getFilteredCases();
        if (cases.length === 0) {
            container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
                <div class="empty-state-icon"><i class="ph ph-clipboard-text"></i></div>
                <div class="empty-state-title">The queue is clear.</div>
                <div class="empty-state-body">No cases are awaiting review.</div>
            </div>`;
            return;
        }
        container.innerHTML = cases.map(c => {
            const conf = c.confidence_score != null ? Math.round(c.confidence_score) : null;
            const pct = Math.round(c.completion_pct || 0);
            return `<div class="docket-card-v3" onclick="openAdminReview('${escapeHtml(c.case_id)}')">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
                    <span class="docket-card-id">${escapeHtml(c.case_id)}</span>
                    <span class="badge ${getBadgeClass(c.status)}" style="font-size:10px;">${escapeHtml(c.status)}</span>
                </div>
                <div class="docket-card-name">${escapeHtml(c.applicant || c.applicant_name || '—')}</div>
                <div class="docket-card-course">${escapeHtml(c.target_course || 'Course TBD')}</div>
                <div style="margin-top:0.75rem;">
                    <div class="progress-bar-track" style="height:3px;margin-bottom:0.25rem;">
                        <div class="progress-bar-fill" style="width:${pct}%;height:3px;"></div>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <span style="font-family:var(--font-mono);font-size:10px;color:var(--color-muted);">${pct}%</span>
                        ${conf !== null ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--color-approved);background:var(--color-approved-bg);border-radius:var(--radius-xs);padding:1px 5px;">AI ${conf}%</span>` : ''}
                    </div>
                </div>
                <span class="docket-card-arrow">↗</span>
            </div>`;
        }).join('');
    }

    // ── View toggle handler ───────────────────────────────────────────────
    let _currentQueueView = 'list';
    const viewToggle = document.getElementById('queue-view-toggle');
    if (viewToggle) {
        viewToggle.addEventListener('click', (e) => {
            const btn = e.target.closest('.view-btn');
            if (!btn) return;
            const view = btn.dataset.view;
            if (view === _currentQueueView) return;
            _currentQueueView = view;
            viewToggle.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
            const listView = document.getElementById('queue-list-view');
            const cardView = document.getElementById('queue-card-view');
            if (view === 'card') {
                if (listView) listView.style.display = 'none';
                if (cardView) cardView.style.display = 'grid';
                renderAdminCards();
            } else {
                if (listView) listView.style.display = '';
                if (cardView) cardView.style.display = 'none';
                renderAdminTable();
            }
        });
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
                            navigateTo('/admin');
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
            // Default to card view — switch to card grid
            _currentQueueView = 'card';
            const listView = document.getElementById('queue-list-view');
            const cardView = document.getElementById('queue-card-view');
            if (listView) listView.style.display = 'none';
            if (cardView) { cardView.style.display = 'grid'; }
            const viewBtns = document.querySelectorAll('#queue-view-toggle .view-btn');
            viewBtns.forEach(b => b.classList.toggle('active', b.dataset.view === 'card'));
            renderAdminCards();
            // Populate stats sidebar
            const total = _allAdminCases.length;
            const needsReview = _allAdminCases.filter(c => ['Submitted', 'Under Review'].includes(c.status)).length;
            const confScores = _allAdminCases.filter(c => c.confidence_score != null).map(c => c.confidence_score);
            const avgConf = confScores.length ? Math.round(confScores.reduce((a,b) => a+b, 0) / confScores.length) : null;
            const statTotal = document.getElementById('stat-total');
            const statNR = document.getElementById('stat-needs-review');
            const statConf = document.getElementById('stat-avg-conf');
            if (statTotal) statTotal.textContent = total;
            if (statNR) statNR.textContent = needsReview;
            if (statConf) statConf.textContent = avgConf !== null ? avgConf + '%' : '—';
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
        if (_currentQueueView === 'card') renderAdminCards();
        else renderAdminTable();
    });

    // Search handler
    document.getElementById('admin-search-input')?.addEventListener('input', () => {
        if (_currentQueueView === 'card') renderAdminCards();
        else renderAdminTable();
    });

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

    function renderLifecycleTimeline(status, createdAt) {
        const steps = [
            { label: 'Case Created', sub: createdAt ? formatTimestamp(createdAt) : null },
            { label: 'Intake & Evidence', sub: null },
            { label: 'Submitted for Review', sub: null },
            { label: 'Under Review', sub: null },
            { label: 'Decision', sub: null },
        ];
        const statusOrder = ['New','Draft','In Progress','Ready for Review','Submitted','Under Review','Revision Requested','Escalated','Approved','Denied'];
        const idx = statusOrder.indexOf(status);
        const activeStep = idx >= 8 ? 4 : idx >= 5 ? 3 : idx >= 4 ? 2 : idx >= 1 ? 1 : 0;

        const html = steps.map((step, i) => {
            const done = i < activeStep;
            const current = i === activeStep;
            const variant = current && status === 'Revision Requested' ? 'revision'
                          : current && status === 'Escalated' ? 'escalated'
                          : current && status === 'Approved' ? 'approved'
                          : current && status === 'Denied' ? 'denied' : '';
            return `<div class="lifecycle-step${done ? ' done' : ''}${current ? ' current' : ''}${variant ? ' ' + variant : ''}">
                <div class="lifecycle-dot"></div>
                <div class="lifecycle-content">
                    <div class="lifecycle-label">${step.label}</div>
                    ${step.sub ? `<div class="lifecycle-sub">${step.sub}</div>` : ''}
                </div>
            </div>`;
        }).join('');
        return `<div class="lifecycle-title">EVALUATION LIFECYCLE</div>${html}`;
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
            if (el('review-applicant-name-detail')) el('review-applicant-name-detail').innerText = data.applicant_name || '—';
            if (el('review-case-subhead')) el('review-case-subhead').innerText = `${data.case_id} • ${data.target_course || '—'}`;
            if (el('review-case-subhead-transcript')) el('review-case-subhead-transcript').innerText = `${data.case_id} • ${data.target_course || '—'}`;
            if (el('review-case-id-label')) el('review-case-id-label').innerText = data.case_id || '—';
            if (el('review-meta-completion')) el('review-meta-completion').innerText = `${data.completion_pct || 0}%`;
            // Lifecycle timeline
            const lifecycleEl = el('review-lifecycle');
            if (lifecycleEl) lifecycleEl.innerHTML = renderLifecycleTimeline(data.status, data.created_at);
            if (el('review-case-summary')) el('review-case-summary').innerText = data.summary || 'No summary available.';
            if (el('review-target-course')) el('review-target-course').innerText = data.target_course || '—';
            if (el('review-confidence')) el('review-confidence').innerText = data.confidence_score ? `${data.confidence_score}%` : '—';
            if (el('review-case-status')) el('review-case-status').innerText = data.status || '—';

            // Transcript — script format
            const transcriptBody = document.getElementById('review-transcript-body');
            if (transcriptBody && data.messages) {
                if (data.messages.length === 0) {
                    transcriptBody.innerHTML = '<p class="text-muted p-4" style="font-style:italic;">No transcript available.</p>';
                } else {
                    transcriptBody.className = 'script-transcript';
                    transcriptBody.innerHTML = '';
                    const studentName = data.applicant_name || 'Student';
                    const studentInitials = studentName.trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().slice(0, 2);
                    const studentFirst = studentName.split(' ')[0];
                    data.messages.forEach(msg => {
                        const isAI = msg.role === 'assistant';
                        const row = document.createElement('div');
                        row.className = 'script-message';
                        if (isAI) {
                            const avatarCol = document.createElement('div');
                            avatarCol.className = 'script-avatar-col';
                            avatarCol.innerHTML = ECHO_AVATAR;
                            const body = document.createElement('div');
                            body.className = 'script-body';
                            body.innerHTML = `<div class="script-sender echo">Echo</div><div class="script-prose">${formatMarkdown(msg.content)}</div>`;
                            row.appendChild(avatarCol);
                            row.appendChild(body);
                        } else {
                            row.innerHTML = `
                                <div class="script-avatar-col"><div class="user-chat-avatar">${escapeHtml(studentInitials)}</div></div>
                                <div class="script-body">
                                    <div class="script-sender user">${escapeHtml(studentFirst)}</div>
                                    <div class="script-prose">${escapeHtml(msg.content)}</div>
                                </div>`;
                        }
                        transcriptBody.appendChild(row);
                    });
                }
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

            // Competency Assessment (right pane top section)
            const compSection = document.getElementById('review-competency-section');
            const compList = document.getElementById('review-competency-list');
            if (compSection && compList && data.claimed_competencies) {
                try {
                    const comps = typeof data.claimed_competencies === 'string'
                        ? JSON.parse(data.claimed_competencies)
                        : data.claimed_competencies;
                    if (comps && comps.length > 0) {
                        compSection.style.display = 'block';
                        compList.innerHTML = comps.map(c => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--color-vellum);border-radius:var(--radius-sm);border-left:2px solid var(--color-primary);">
                                <span style="font-family:var(--font-sans);font-size:var(--text-sm);color:var(--color-ink);">${escapeHtml(c)}</span>
                                <span style="font-family:var(--font-mono);font-size:10px;background:var(--color-approved-bg);color:var(--color-approved);border-radius:var(--radius-xs);padding:1px 6px;">CLAIMED</span>
                            </div>`).join('');
                    }
                } catch(e) { /* non-fatal */ }
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
                if (decision === 'Approve') {
                    // Show CERTIFY stamp before navigating away
                    const stamp = document.getElementById('certify-stamp');
                    if (stamp) {
                        stamp.classList.add('visible');
                        setTimeout(() => {
                            stamp.classList.remove('visible');
                            fetchAdminCases();
                            navigateTo('/admin');
                        }, 1800);
                    } else {
                        fetchAdminCases();
                        navigateTo('/admin');
                    }
                    showToast('Case certified successfully.', 'success');
                } else {
                    showToast(`Case ${decision.toLowerCase()}d successfully.`, 'success');
                    fetchAdminCases();
                    navigateTo('/admin');
                }
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
    // 7. Topbar Navigation Renderer
    // ═══════════════════════════════════════════════════
    function renderTopbarNav(role, currentPath) {
        const nav = document.getElementById('topbar-nav');
        if (!nav) return;
        const links = role === 'reviewer'
            ? [
                { href: '/admin',          label: 'Workspaces' },
                { href: '/admin/settings', label: 'Settings'   }
              ]
            : [
                { href: '/',         label: 'Home'      },
                { href: '/chat',     label: 'Studio'    },
                { href: '/cases',    label: 'Dossiers'  },
                { href: '/evidence', label: 'Evidence'  }
              ];
        nav.innerHTML = links.map(l =>
            `<a href="${l.href}" class="topbar-link${currentPath === l.href ? ' active' : ''}"
                onclick="event.preventDefault(); navigateTo('${l.href}');">${l.label}</a>`
        ).join('');
    }

    // 7b. Role Switcher + Admin Authentication
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
        if (switchLabel) switchLabel.innerText = 'Applicant';
        // Hide sidebar on admin routes — nav lives in topbar
        appContainer.classList.add('admin-mode');
        appContainer.classList.remove('applicant-mode');
        renderTopbarNav('reviewer', window.location.pathname);
    }

    function switchToApplicantNav() {
        isReviewer = false;
        if (reviewerNavWrapper) reviewerNavWrapper.style.display = 'none';
        if (applicantNavWrapper) applicantNavWrapper.style.display = 'block';
        updateProfileDisplay();
        const switchLabel = document.getElementById('role-switch-label');
        if (switchLabel) switchLabel.innerText = 'Reviewer';
        // Hide sidebar on applicant routes — nav lives in topbar
        appContainer.classList.add('applicant-mode');
        appContainer.classList.remove('admin-mode');
        exitSessionMode();
        renderTopbarNav('applicant', window.location.pathname);
    }

    function updateProfileDisplay() {
        const name = applicantName || 'Applicant';
        const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'AP';
        if (profileAvatar) profileAvatar.innerText = initials;
        if (profileName) profileName.innerText = name;
        if (profileRole) profileRole.innerText = 'Applicant';
        updateUserAvatar(applicantName);
    }

    function updateUserAvatar(name) {
        const el = document.getElementById('topbar-user-avatar');
        if (!el) return;
        if (!name) { el.textContent = '?'; return; }
        const parts = name.trim().split(' ');
        const initials = parts.length >= 2
            ? parts[0][0] + parts[parts.length - 1][0]
            : parts[0].substring(0, 2);
        el.textContent = initials.toUpperCase();
    }

    function enterSessionMode(caseId, studentName) {
        // Show session context in topbar center, hide nav links
        const nav = document.getElementById('topbar-nav');
        const ctx = document.getElementById('session-context');
        if (nav) nav.style.display = 'none';
        if (ctx) {
            ctx.style.display = 'flex';
            const idEl = ctx.querySelector('.session-id');
            const nameEl = ctx.querySelector('.session-name');
            if (idEl && caseId) idEl.textContent = caseId;
            if (nameEl && studentName) nameEl.textContent = studentName;
        }
        // Update studio context bar inside the chat screen
        const studioBar = document.getElementById('studio-context-bar');
        const studioId = document.getElementById('studio-bar-case-id');
        const studioName = document.getElementById('studio-bar-student-name');
        if (studioBar) studioBar.style.display = 'flex';
        if (studioId && caseId) studioId.textContent = caseId;
        if (studioName && studentName) studioName.textContent = studentName;
    }

    function exitSessionMode() {
        const nav = document.getElementById('topbar-nav');
        const ctx = document.getElementById('session-context');
        if (nav) nav.style.display = '';
        if (ctx) ctx.style.display = 'none';
    }

    // Gear dropdown toggle
    const gearBtn = document.getElementById('gear-btn');
    const gearDropdown = document.getElementById('gear-dropdown');
    if (gearBtn && gearDropdown) {
        gearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            gearDropdown.classList.toggle('open');
        });
        document.addEventListener('click', () => gearDropdown.classList.remove('open'));
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

                    // Show attachment row in chat transcript
                    if (chatTranscript) {
                        const attachDiv = document.createElement('div');
                        attachDiv.className = 'script-message';
                        attachDiv.innerHTML = `
                            <div class="script-avatar-col">${makeAvatarHTML('user')}</div>
                            <div class="script-body">
                                ${makeSenderLabel('user')}
                                <div class="script-prose">📎 <em>${escapeHtml(data.filename)}</em> uploaded as evidence.</div>
                            </div>`;
                        chatTranscript.appendChild(attachDiv);
                        chatTranscript.scrollTop = chatTranscript.scrollHeight;
                    }

                    // Auto-trigger Echo to acknowledge the uploaded file
                    setTimeout(() => {
                        appendUserMessage(`I've just uploaded "${data.filename}" as supporting evidence for my case.`);
                    }, 400);
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

    // Configure marked once at init: GFM (GitHub Flavored Markdown) + line breaks
    if (typeof marked !== 'undefined') {
        marked.use({ breaks: true, gfm: true });
    }

    function formatMarkdown(text) {
        if (!text) return '';
        if (typeof marked !== 'undefined') {
            return marked.parse(text);
        }
        // Fallback if CDN fails to load
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
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

    // Global search bar removed from topbar (element no longer in DOM)

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
                            div.className = 'script-message';
                            const isAI = msg.role === 'assistant';
                            div.innerHTML = `
                                <div class="script-avatar-col">${isAI ? ECHO_AVATAR : makeAvatarHTML('user')}</div>
                                <div class="script-body">
                                    ${isAI ? '<div class="script-sender echo">Echo</div>' : makeSenderLabel('user')}
                                    <div class="script-prose">${isAI ? formatMarkdown(msg.content) : escapeHtml(msg.content)}</div>
                                </div>
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


    // ═══════════════════════════════════════════════════
    // 13. Boot
    // ═══════════════════════════════════════════════════
    updateProfileDisplay();
    navigateTo(window.location.pathname, false);

    // Attempt session recovery after initial navigation
    attemptSessionRecovery();
});
