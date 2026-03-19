/**
 * app.js — NUPathway MVP Frontend
 * Handles SPA routing, dynamic data fetching, chat, and admin review.
 */

document.addEventListener('DOMContentLoaded', () => {

    // ─────────────────────────────────────────────────
    // 0. Session State
    // ─────────────────────────────────────────────────
    let sessionId = localStorage.getItem('cpl_session_id');
    if (!sessionId) {
        sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('cpl_session_id', sessionId);
    }
    let currentCaseId = null; // Set when chat creates a Draft case

    // ─────────────────────────────────────────────────
    // 1. SPA Router
    // ─────────────────────────────────────────────────
    const navItems = document.querySelectorAll('.nav-item');
    const screenViews = document.querySelectorAll('.screen-view');
    const breadcrumb = document.getElementById('dynamic-breadcrumb');

    const routes = {
        '/': 'home-screen',
        '/chat': 'intake-screen',
        '/cases': 'case-history-screen',
        '/admin': 'admin-dashboard-screen',
    };
    const reverseRoutes = {
        'home-screen': '/',
        'intake-screen': '/chat',
        'case-history-screen': '/cases',
        'admin-dashboard-screen': '/admin',
        'admin-review-screen': '/admin/review',
    };

    window.navigateTo = function (path, push = true) {
        let targetId = routes[path];
        if (!targetId) {
            if (path.startsWith('/admin/review')) targetId = 'admin-review-screen';
            else targetId = 'home-screen';
        }

        if (push && path !== window.location.pathname) {
            window.history.pushState({ targetId }, "", path);
        }

        // Update nav highlighting (skip sub-routes)
        if (targetId !== 'admin-review-screen') {
            const activeNav = document.querySelector(`.nav-item[data-target="${targetId}"]`);
            if (activeNav) {
                navItems.forEach(nav => nav.classList.remove('active'));
                activeNav.classList.add('active');
                const sectionName = activeNav.closest('.nav-section')?.querySelector('.nav-section-title')?.innerText || '';
                const itemName = activeNav.innerText.trim().replace(/\n.*$/, '');
                if (breadcrumb) breadcrumb.innerText = `${sectionName} / ${itemName}`;
            }
        }

        // Show/hide screens
        screenViews.forEach(screen => screen.classList.remove('active'));
        const targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.classList.add('active');

        // Toggle sidebar footer visibility
        const footer = document.querySelector('.sidebar-footer');
        if (footer) {
            footer.style.opacity = path === '/chat' ? '1' : '0';
            footer.style.transform = path === '/chat' ? 'translateY(0)' : 'translateY(10px)';
        }

        // Route-entry data hooks
        if (path === '/cases') fetchApplicantCases();
        if (path === '/admin') {
            fetchAdminCases();
            switchToReviewerNav();
        }
        if (path === '/' || path === '/chat' || path === '/cases') {
            switchToApplicantNav();
        }
    };

    window.addEventListener('popstate', () => {
        navigateTo(window.location.pathname, false);
    });

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const appContainer = document.querySelector('.app-container');
    if (sidebarToggle && appContainer) {
        sidebarToggle.addEventListener('click', () => {
            appContainer.classList.toggle('collapsed');
        });
    }

    // Nav item click → router
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-target');
            if (targetId && reverseRoutes[targetId]) {
                e.preventDefault();
                navigateTo(reverseRoutes[targetId]);
            }
        });
    });

    // ─────────────────────────────────────────────────
    // 2. Chat Logic
    // ─────────────────────────────────────────────────
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send');
    const chatTranscript = document.getElementById('intake-chat');

    async function appendUserMessage(text) {
        if (!text.trim()) return;

        // Render user bubble
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        msgDiv.innerHTML = `
            <div class="avatar-small img">JS</div>
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
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, session_id: sessionId })
            });
            const data = await response.json();
            chatTranscript.removeChild(loadingDiv);

            // Track case ID from backend
            if (data.case_id) {
                currentCaseId = data.case_id;
                updateIntakeSidebar(data.case_id);
            }

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
            const errDiv = document.createElement('div');
            errDiv.className = 'message assistant';
            errDiv.innerHTML = `<div class="avatar-small bg-ai"><i class="ph-fill ph-sparkle text-white"></i></div><div class="message-content"><p style="color: var(--status-red-text);">Error connecting to backend. Please try again.</p></div>`;
            chatTranscript.appendChild(errDiv);
            chatTranscript.scrollTop = chatTranscript.scrollHeight;
        }
    }

    function updateIntakeSidebar(caseId) {
        const el = (id) => document.getElementById(id);
        if (el('intake-case-id')) el('intake-case-id').innerText = caseId;
        if (el('intake-case-status')) el('intake-case-status').innerText = 'Draft';
    }

    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', () => appendUserMessage(chatInput.value));
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') appendUserMessage(chatInput.value);
        });
    }

    // ─────────────────────────────────────────────────
    // 3. Homepage Interactions
    // ─────────────────────────────────────────────────
    const promptSuggestions = document.querySelectorAll('.prompt-suggestion');
    const landingComposerInput = document.querySelector('.composer-textarea');
    const landingSendBtn = document.querySelector('.composer-send-btn');

    function initiateChatFromLanding(promptText) {
        if (!promptText.trim()) return;

        // Fresh session for new conversation
        sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('cpl_session_id', sessionId);
        currentCaseId = null;

        // Clear chat area
        if (chatTranscript) chatTranscript.innerHTML = '';

        // Reset intake sidebar
        const el = (id) => document.getElementById(id);
        if (el('intake-case-id')) el('intake-case-id').innerText = '—';
        if (el('intake-case-status')) el('intake-case-status').innerText = 'No active case';
        if (el('intake-case-summary')) el('intake-case-summary').innerText = 'Start a conversation to begin building your case.';
        if (el('intake-target-course')) el('intake-target-course').innerText = '—';

        navigateTo('/chat');
        setTimeout(() => appendUserMessage(promptText), 200);
    }

    promptSuggestions.forEach(suggestion => {
        suggestion.addEventListener('click', () => {
            initiateChatFromLanding(suggestion.dataset.prompt);
        });
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

    // "New Case" button in topbar — starts a new conversation
    const primaryBtn = document.getElementById('primary-action-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => {
            initiateChatFromLanding('I want to start a new evaluation case.');
        });
    }

    // ─────────────────────────────────────────────────
    // 4. Case History (Applicant View)
    // ─────────────────────────────────────────────────
    async function fetchApplicantCases() {
        const container = document.getElementById('case-list-container');
        const emptyState = document.getElementById('case-list-empty');
        if (!container) return;

        try {
            const response = await fetch('/api/cases');
            const data = await response.json();
            container.innerHTML = '';

            if (!data.cases || data.cases.length === 0) {
                container.innerHTML = `<div class="text-center text-muted p-4">
                    <i class="ph ph-folder-open" style="font-size: 2rem;"></i>
                    <p class="mt-2">No cases yet. Start a conversation to create your first case.</p>
                </div>`;
                return;
            }

            data.cases.forEach(c => {
                const badgeClass = getBadgeClass(c.status);
                const div = document.createElement('div');
                div.className = 'case-list-item';
                div.innerHTML = `
                    <div class="case-list-left">
                        <div class="case-id font-mono">${c.case_id}</div>
                        <div class="case-info">
                            <strong>${c.target_course || 'Not yet determined'}</strong>
                            <span class="text-sm text-muted">${c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                        </div>
                    </div>
                    <div class="case-list-right">
                        <span class="badge ${badgeClass}">${c.status}</span>
                        ${c.confidence_score ? `<div class="flex-align-center gap-2 text-sm">
                            <div class="progress-bar-bg small" style="width: 80px;">
                                <div class="progress-bar-fill ${c.confidence_score >= 70 ? 'green' : 'yellow'}" style="width: ${c.confidence_score}%;"></div>
                            </div>
                            ${c.confidence_score}%
                        </div>` : ''}
                        <i class="ph ph-caret-right text-muted"></i>
                    </div>
                `;
                div.addEventListener('click', () => loadCaseDetail(c.case_id));
                container.appendChild(div);
            });
        } catch (e) {
            console.error('Failed to fetch cases', e);
        }
    }

    async function loadCaseDetail(caseId) {
        const caseListView = document.getElementById('case-list-view');
        const caseDetailView = document.getElementById('case-detail-view');
        if (caseListView) caseListView.style.display = 'none';
        if (caseDetailView) caseDetailView.style.display = 'block';

        try {
            const response = await fetch(`/api/case/${caseId}`);
            const data = await response.json();
            if (data.error) return;

            // Populate the timeline dynamically based on case status
            const statusMain = caseDetailView.querySelector('.status-main .card');
            if (statusMain) {
                statusMain.innerHTML = renderTimeline(data);
            }
        } catch (e) {
            console.error('Failed to load case detail', e);
        }
    }

    function renderTimeline(caseData) {
        const steps = [
            { name: 'Draft Started', description: caseData.created_at ? new Date(caseData.created_at).toLocaleDateString() : 'Date unknown' },
            { name: 'Intake & Evidence', description: 'Conversation with Echo to build your case.' },
            { name: 'Submitted for Review', description: 'Case sent to evaluation team.' },
            { name: 'Under Review', description: 'Evaluator reviewing your case.' },
            { name: 'Decision', description: 'Credit outcome recorded.' },
        ];

        const statusOrder = ['Draft', 'Draft', 'Submitted', 'Under Review', 'Approved'];
        const statusIndex = {
            'Draft': 1,
            'Submitted': 2,
            'Under Review': 3,
            'Info Requested': 3,
            'Approved': 4,
            'Denied': 4,
        };
        const currentStep = statusIndex[caseData.status] || 0;

        let html = '<div class="timeline-container vertical">';
        steps.forEach((step, i) => {
            let stepClass = 'future';
            if (i < currentStep) stepClass = 'completed';
            else if (i === currentStep) stepClass = 'active';

            const indicator = stepClass === 'completed'
                ? '<div class="step-indicator"><i class="ph-bold ph-check"></i></div>'
                : stepClass === 'active'
                ? '<div class="step-indicator inner-dot"></div>'
                : '<div class="step-indicator"></div>';

            let desc = step.description;
            if (i === currentStep && caseData.status === 'Approved') desc = '✅ Credit approved!';
            if (i === currentStep && caseData.status === 'Denied') desc = '❌ Credit denied.';
            if (i === currentStep && caseData.status === 'Info Requested') desc = '⚠️ Additional information requested.';

            html += `<div class="timeline-step ${stepClass}">
                ${indicator}
                <div class="step-content">
                    <h4>${step.name}</h4>
                    <p>${desc}</p>
                </div>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    const backToCaseList = document.getElementById('back-to-case-list');
    if (backToCaseList) {
        backToCaseList.addEventListener('click', () => {
            const caseDetailView = document.getElementById('case-detail-view');
            const caseListView = document.getElementById('case-list-view');
            if (caseDetailView) caseDetailView.style.display = 'none';
            if (caseListView) caseListView.style.display = 'block';
        });
    }

    // ─────────────────────────────────────────────────
    // 5. Admin Dashboard
    // ─────────────────────────────────────────────────
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
                            <strong>${c.applicant}</strong>
                        </div>
                    </td>
                    <td>${c.target_course || '—'}</td>
                    <td><span class="badge ${badgeClass}">${c.status}</span></td>
                    <td>
                        <div class="flex-align-center gap-2 text-sm">
                            <div class="progress-bar-bg small">
                                <div class="progress-bar-fill ${(c.confidence_score || 0) >= 70 ? 'green' : 'yellow'}" style="width: ${c.confidence_score || 0}%;"></div>
                            </div>
                            ${c.confidence_score || 0}%
                        </div>
                    </td>
                    <td>${c.assignee || '—'}</td>
                    <td><button class="btn-icon"><i class="ph ph-caret-right"></i></button></td>
                `;
                tbody.appendChild(tr);
            });

            // Update the tab count
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

            // Header
            const nameEl = document.getElementById('review-applicant-name');
            const subEl = document.getElementById('review-case-subhead');
            if (nameEl) nameEl.innerText = data.applicant || 'Unknown';
            if (subEl) subEl.innerText = `${data.case_id} • ${data.target_course || '—'}`;

            // Case Record pane
            const el = (id) => document.getElementById(id);
            if (el('review-case-summary')) el('review-case-summary').innerText = data.summary || 'No summary available.';
            if (el('review-target-course')) el('review-target-course').innerText = data.target_course || '—';
            if (el('review-confidence')) el('review-confidence').innerText = data.confidence_score ? `${data.confidence_score}%` : '—';
            if (el('review-case-status')) el('review-case-status').innerText = data.status || '—';

            // Transcript pane
            const transcriptBody = document.getElementById('review-transcript-body');
            if (transcriptBody && data.messages) {
                if (data.messages.length === 0) {
                    transcriptBody.innerHTML = '<p class="text-muted p-4">No conversation transcript available.</p>';
                } else {
                    transcriptBody.innerHTML = '';
                    data.messages.forEach(msg => {
                        const isAI = msg.role === 'assistant';
                        const div = document.createElement('div');
                        div.className = `message ${msg.role}`;
                        div.innerHTML = `
                            <div class="avatar-small ${isAI ? '' : 'img'}">${isAI ? 'AI' : 'ST'}</div>
                            <div class="message-content"><p>${escapeHtml(msg.content)}</p></div>
                        `;
                        transcriptBody.appendChild(div);
                    });
                }
            }

            // Evidence pane
            const evidenceList = document.getElementById('review-evidence-list');
            if (evidenceList && data.evidence) {
                if (data.evidence.length === 0) {
                    evidenceList.innerHTML = '<p class="text-muted text-sm">No evidence files attached.</p>';
                } else {
                    evidenceList.innerHTML = '';
                    data.evidence.forEach(ev => {
                        const icon = getFileIcon(ev.file_name);
                        evidenceList.innerHTML += `<div class="file-item"><i class="${icon}"></i> ${ev.file_name}</div>`;
                    });
                }
            }

        } catch (e) {
            console.error('Failed to load case for review', e);
        }
    }

    // Review back button
    const reviewBackBtn = document.getElementById('review-back-btn');
    if (reviewBackBtn) {
        reviewBackBtn.addEventListener('click', () => navigateTo('/admin'));
    }

    // Review actions
    const approveBtn = document.querySelector('.review-topbar .btn-primary');
    const denyBtn = document.querySelector('.review-topbar .btn-secondary.text-danger');

    async function handleReviewAction(decision) {
        const caseId = window.currentReviewCaseId;
        if (!caseId) {
            alert('No case selected.');
            return;
        }
        const notes = document.getElementById('review-notes-input')?.value || '';

        try {
            const response = await fetch(`/api/case/${caseId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision, notes })
            });
            const data = await response.json();
            if (data.status === 'success') {
                alert(`Case ${caseId}: ${data.new_status || decision}`);
                fetchAdminCases();
                navigateTo('/admin');
            }
        } catch (error) {
            console.error('Review action failed', error);
            alert('Review action failed.');
        }
    }

    if (approveBtn) approveBtn.addEventListener('click', () => handleReviewAction('Approve'));
    if (denyBtn) denyBtn.addEventListener('click', () => handleReviewAction('Deny'));

    // ─────────────────────────────────────────────────
    // 6. Role Switcher
    // ─────────────────────────────────────────────────
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
    }

    function switchToApplicantNav() {
        isReviewer = false;
        if (reviewerNavWrapper) reviewerNavWrapper.style.display = 'none';
        if (applicantNavWrapper) applicantNavWrapper.style.display = 'block';
        if (profileAvatar) profileAvatar.innerText = 'JS';
        if (profileName) profileName.innerText = 'Jane Student';
        if (profileRole) profileRole.innerText = 'Applicant';
    }

    if (roleSwitchBtn) {
        roleSwitchBtn.addEventListener('click', () => {
            if (isReviewer) {
                navigateTo('/');
            } else {
                navigateTo('/admin');
            }
        });
    }

    // ─────────────────────────────────────────────────
    // 7. Evidence Upload
    // ─────────────────────────────────────────────────
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

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
                    body: formData
                });
                const data = await response.json();
                if (data.status === 'success') {
                    // Update the evidence list in intake sidebar
                    const list = document.getElementById('intake-evidence-list');
                    if (list) {
                        if (list.querySelector('.text-muted')) list.innerHTML = '';
                        const icon = getFileIcon(data.filename);
                        list.innerHTML += `<div class="compact-file-item">
                            <i class="${icon}"></i>
                            <div class="compact-file-info">
                                <span class="compact-file-name">${data.filename}</span>
                            </div>
                            <span class="badge green" style="font-size: 0.6rem;">Uploaded</span>
                        </div>`;
                    }
                }
            } catch (error) {
                console.error('Upload failed', error);
                alert('Upload failed. Please try again.');
            }
            fileInput.value = ''; // Reset for next upload
        }
    });

    // ─────────────────────────────────────────────────
    // 8. Admin Toggles & Tabs
    // ─────────────────────────────────────────────────
    const toggles = document.querySelectorAll('.toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('click', function () {
            this.classList.toggle('active');
        });
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

    // ─────────────────────────────────────────────────
    // 9. Utilities
    // ─────────────────────────────────────────────────
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.innerText = text;
        return div.innerHTML;
    }

    function formatMarkdown(text) {
        // Basic markdown: bold, italic, line breaks
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    function getBadgeClass(status) {
        const map = {
            'Draft': 'gray',
            'Submitted': 'blue',
            'Needs Review': 'yellow',
            'Under Review': 'blue',
            'Info Requested': 'yellow',
            'Approved': 'green',
            'Denied': 'red',
        };
        return map[status] || 'gray';
    }

    function getFileIcon(filename) {
        if (!filename) return 'ph-fill ph-file';
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'pdf': 'ph-fill ph-file-pdf',
            'doc': 'ph-fill ph-file-text',
            'docx': 'ph-fill ph-file-text',
            'png': 'ph-fill ph-image',
            'jpg': 'ph-fill ph-image',
            'jpeg': 'ph-fill ph-image',
            'xls': 'ph-fill ph-file-xls',
            'xlsx': 'ph-fill ph-file-xls',
            'txt': 'ph-fill ph-file-text',
            'zip': 'ph-fill ph-file-zip',
        };
        return icons[ext] || 'ph-fill ph-file';
    }

    // ─────────────────────────────────────────────────
    // 10. BOOT — Deep-link support
    // ─────────────────────────────────────────────────
    navigateTo(window.location.pathname, false);
});
