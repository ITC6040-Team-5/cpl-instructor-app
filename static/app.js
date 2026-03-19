/**
 * app.js
 * Handles the static interactivity for the CPL Evaluation Prototype
 */

document.addEventListener('DOMContentLoaded', () => {

    // 0. Session Initialization
    let sessionId = localStorage.getItem('cpl_session_id');
    if (!sessionId) {
        sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('cpl_session_id', sessionId);
    }

    // 1. Navigation Logic (SPA View Switching)
    const navItems = document.querySelectorAll('.nav-item');
    const screenViews = document.querySelectorAll('.screen-view');
    const breadcrumb = document.getElementById('dynamic-breadcrumb');

    // Sidebar Toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const appContainer = document.querySelector('.app-container');

    if (sidebarToggle && appContainer) {
        sidebarToggle.addEventListener('click', () => {
            appContainer.classList.toggle('collapsed');
        });
    }

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-target');
            if (!targetId) {
                // Let normal browser navigation handle links without a target screen
                return;
            }

            e.preventDefault();

            // Remove active from all nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to clicked
            item.classList.add('active');

            // Hide all screens
            screenViews.forEach(screen => screen.classList.remove('active'));

            // Show target screen
            document.getElementById(targetId).classList.add('active');

            // Update Breadcrumb
            const sectionName = item.closest('.nav-section')?.querySelector('.nav-section-title')?.innerText || '';
            const itemName = item.innerText.trim().replace(/\n.*$/, ''); // clean up badge text
            breadcrumb.innerText = `${sectionName} / ${itemName}`;

            // Gap #2: Reveal sidebar profile when entering authenticated context (intake)
            if (targetId === 'intake-screen' || targetId === 'status-screen') {
                const footer = document.querySelector('.sidebar-footer');
                if (footer) {
                    footer.style.opacity = '1';
                    footer.style.transform = 'translateY(0)';
                }
            }
        });
    });


    // 2. Mock Chat Interaction (Intake Screen)
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send');
    const chatTranscript = document.getElementById('intake-chat');

    async function appendUserMessage(text) {
        if (!text.trim()) return;

        // Create user message HTML
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        msgDiv.innerHTML = `
            <div class="avatar-small img">JS</div>
            <div class="message-content">
                <p>${text}</p>
            </div>
        `;

        chatTranscript.appendChild(msgDiv);
        chatInput.value = '';
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        // Add loading state
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message assistant loading-indicator';
        loadingDiv.innerHTML = `<div class="avatar-small">AI</div><div class="message-content"><p class="text-muted"><i class="ph ph-spinner ph-spin"></i> Processing...</p></div>`;
        chatTranscript.appendChild(loadingDiv);
        chatTranscript.scrollTop = chatTranscript.scrollHeight;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, session_id: sessionId })
            });
            const data = await response.json();
            
            // Remove loading
            chatTranscript.removeChild(loadingDiv);

            const aiDiv = document.createElement('div');
            aiDiv.className = 'message assistant';
            aiDiv.innerHTML = `
                <div class="avatar-small bg-ai"><i class="ph-fill ph-sparkle text-white"></i></div>
                <div class="message-content">
                    <p>${data.answer || 'Sorry, I could not process that.'}</p>
                </div>
            `;
            chatTranscript.appendChild(aiDiv);
            chatTranscript.scrollTop = chatTranscript.scrollHeight;

            // Mocking the progress update visually as before
            if (document.querySelector('.progress-bar-fill')) {
                document.querySelector('.progress-bar-fill').style.width = '80%';
                if (document.querySelector('.progress-text')) document.querySelector('.progress-text').innerText = '80% Complete';
            }

        } catch (error) {
            chatTranscript.removeChild(loadingDiv);
            const errDiv = document.createElement('div');
            errDiv.className = 'message assistant';
            errDiv.innerHTML = `<div class="avatar-small">AI</div><div class="message-content"><p style="color: red;">Error connecting to backend.</p></div>`;
            chatTranscript.appendChild(errDiv);
            chatTranscript.scrollTop = chatTranscript.scrollHeight;
        }
    }

    if (chatSendBtn && chatInput) {
        chatSendBtn.addEventListener('click', () => appendUserMessage(chatInput.value));
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') appendUserMessage(chatInput.value);
        });
    }

    // 3. Mock Primary Actions
    const primaryBtn = document.getElementById('primary-action-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => {
            // Reset session: return to conversational landing
            document.querySelector('.nav-item[data-target="home-screen"]').click();
        });
    }

    // 4. Admin Toggles interaction
    const toggles = document.querySelectorAll('.toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('click', function () {
            this.classList.toggle('active');
        });
    });

    // 4b. Record Sidebar Tab Switching
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

    // 4c. Gap #2: Sidebar profile starts hidden, revealed on intake navigation (simulating post-auth)
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter) {
        sidebarFooter.style.opacity = '0';
        sidebarFooter.style.transform = 'translateY(10px)';
        sidebarFooter.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    }

    // 4d. Gap #4: Case History drill-down
    const caseListItems = document.querySelectorAll('.case-list-item');
    const caseListView = document.getElementById('case-list-view');
    const caseDetailView = document.getElementById('case-detail-view');
    const backToCaseList = document.getElementById('back-to-case-list');

    caseListItems.forEach(item => {
        item.addEventListener('click', () => {
            if (caseListView) caseListView.style.display = 'none';
            if (caseDetailView) caseDetailView.style.display = 'block';
        });
    });

    if (backToCaseList) {
        backToCaseList.addEventListener('click', () => {
            if (caseDetailView) caseDetailView.style.display = 'none';
            if (caseListView) caseListView.style.display = 'block';
        });
    }

    // 5. Conversational Landing Page Interactions
    const promptSuggestions = document.querySelectorAll('.prompt-suggestion');
    const landingComposerInput = document.querySelector('.composer-textarea');
    const landingSendBtn = document.querySelector('.composer-send-btn');

    function initiateChatFromLanding(promptText) {
        if (!promptText.trim()) return;

        // Directly switch to intake screen (no sidebar nav-item exists for it)
        screenViews.forEach(screen => screen.classList.remove('active'));
        document.getElementById('intake-screen').classList.add('active');

        // Update breadcrumb
        breadcrumb.innerText = 'Applicant View / Guided Intake';

        // Deactivate nav items (intake is not in sidebar)
        navItems.forEach(nav => nav.classList.remove('active'));

        // Reveal sidebar profile (post-auth simulation)
        const footer = document.querySelector('.sidebar-footer');
        if (footer) {
            footer.style.opacity = '1';
            footer.style.transform = 'translateY(0)';
        }

        // Populate chat input safely
        setTimeout(() => {
            if (chatInput) {
                chatInput.value = promptText;
                chatInput.focus();
            }
        }, 300); // Wait for transition
    }

    if (promptSuggestions.length > 0) {
        promptSuggestions.forEach(suggestion => {
            suggestion.addEventListener('click', () => {
                initiateChatFromLanding(suggestion.dataset.prompt);
            });
        });
    }

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

    // 6. Role Switcher for Prototype Toggle
    const roleSwitchBtn = document.getElementById('role-switch-btn');
    const applicantNavWrapper = document.getElementById('applicant-nav-wrapper');
    const reviewerNavWrapper = document.getElementById('reviewer-nav-wrapper');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileName = document.getElementById('profile-name');
    const profileRole = document.getElementById('profile-role');

    let isReviewer = false;

    if (roleSwitchBtn) {
        roleSwitchBtn.addEventListener('click', () => {
            isReviewer = !isReviewer;

            if (isReviewer) {
                // Switch to Reviewer Portal
                applicantNavWrapper.style.display = 'none';
                reviewerNavWrapper.style.display = 'block';
                profileAvatar.innerText = 'AR';
                profileName.innerText = 'Admin Reviewer';
                profileRole.innerText = 'Reviewer';
                const dashboardTab = document.querySelector('.nav-item[data-target="admin-dashboard-screen"]');
                if (dashboardTab) dashboardTab.click();
                if (typeof fetchAdminCases === 'function') fetchAdminCases();
            } else {
                // Switch to Applicant View
                reviewerNavWrapper.style.display = 'none';
                applicantNavWrapper.style.display = 'block';
                profileAvatar.innerText = 'JS';
                profileName.innerText = 'Jane Student';
                profileRole.innerText = 'Applicant';
                const homeTab = document.querySelector('.nav-item[data-target="home-screen"]');
                if (homeTab) homeTab.click();
            }
        });
    }

    // Initialize initial state (prevent jumpiness on first load)
    document.querySelector('.nav-item.active').click();

    // 7. Evidence Upload Logic Stub
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
            // Disable dropzone while uploading
            const dropzone = document.querySelector('.dropzone'); // Assuming a dropzone element exists
            if (dropzone) {
                dropzone.style.opacity = '0.5';
                dropzone.style.pointerEvents = 'none';
            }

            const formData = new FormData();
            formData.append('file', file);
            
            // Pass the active conversational session id to bind orphaned uploads
            // before the LLM formally generates the Case record.
            // Assuming 'sessionId' is available in the global scope or defined elsewhere
            if (typeof sessionId !== 'undefined') { // Check if sessionId is defined
                formData.append('session_id', sessionId);
            }
            if (window.currentCaseId) {
                formData.append('case_id', window.currentCaseId);
            }

            try {
                const response = await fetch('/api/evidence/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();
                if (data.status === 'success') {
                    // Just show a native alert for now to prove end-to-end integration works
                    alert('Backend Upload Triggered: ' + data.filename);
                }
            } catch (error) {
                console.error('Upload failed', error);
                alert('Backend Upload Failed');
            }
        }
    });

    // 8. Admin Review Logic
    const approveBtn = document.querySelector('.review-topbar .btn-primary');
    const denyBtn = document.querySelector('.review-topbar .btn-secondary.text-danger');
    
    async function fetchAdminCases() {
        const tbody = document.querySelector('#admin-dashboard-screen .data-table tbody');
        if (!tbody) return;
        
        try {
            const response = await fetch('/api/admin/cases');
            const data = await response.json();
            
            if (data.cases) {
                tbody.innerHTML = '';
                data.cases.forEach(c => {
                    const badgeClass = c.status === 'Approved' ? 'green' : (c.status === 'Denied' ? 'red' : 'yellow');
                    
                    const tr = document.createElement('tr');
                    tr.className = 'clickable-row';
                    tr.addEventListener('click', async () => {
                        window.currentReviewCaseId = c.case_id;
                        document.querySelector('[data-target="admin-review-screen"]').click();
                        
                        try {
                            const detailRes = await fetch(`/api/case/${c.case_id}`);
                            const detailData = await detailRes.json();
                            if (!detailData.error) {
                                const nameHeader = document.querySelector('#admin-review-screen h2.mb-0');
                                const subhead = document.querySelector('#admin-review-screen .text-muted.mb-0');
                                if (nameHeader) nameHeader.innerText = detailData.applicant;
                                if (subhead) subhead.innerText = `${detailData.case_id} • ${detailData.target_course}`;
                            }
                        } catch(e) {
                            console.error("Could not fetch case details", e);
                        }
                    });
                    
                    tr.innerHTML = `
                        <td class="font-mono text-sm">${c.case_id}</td>
                        <td>
                            <div class="flex-align-center gap-2">
                                <div class="avatar-small img">${c.applicant.substring(0,2).toUpperCase()}</div>
                                <strong>${c.applicant}</strong>
                            </div>
                        </td>
                        <td>${c.target_course}</td>
                        <td><span class="badge ${badgeClass}">${c.status}</span></td>
                        <td>
                            <div class="flex-align-center gap-2 text-sm">
                                <div class="progress-bar-bg small">
                                    <div class="progress-bar-fill green" style="width: ${c.confidence_score || 0}%;"></div>
                                </div>
                                ${c.confidence_score || 0}%
                            </div>
                        </td>
                        <td>${c.assignee}</td>
                        <td><button class="btn-icon"><i class="ph ph-caret-right"></i></button></td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        } catch (e) {
            console.error("Failed to fetch cases", e);
        }
    }

    async function handleReviewAction(decision) {
        try {
            const caseId = window.currentReviewCaseId || "CPL-8991"; // Fallback to prototype hardcode
            const response = await fetch(`/api/case/${caseId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision })
            });
            const data = await response.json();
            if (data.status === 'success') {
                alert(`Backend Review Triggered: Case ${caseId} marked as ${decision}.`);
                fetchAdminCases();
                document.querySelector('.nav-item[data-target="admin-dashboard-screen"]').click();
            }
        } catch (error) {
            console.error('Review action failed', error);
            alert('Backend Review Failed');
        }
    }

    if (approveBtn) approveBtn.addEventListener('click', () => handleReviewAction('Approve'));
    if (denyBtn) denyBtn.addEventListener('click', () => handleReviewAction('Deny'));
});

