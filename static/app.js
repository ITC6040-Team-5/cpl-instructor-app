/**
 * app.js
 * Handles the static interactivity for the CPL Evaluation Prototype
 */

document.addEventListener('DOMContentLoaded', () => {

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
            e.preventDefault();

            // Remove active from all nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to clicked
            item.classList.add('active');

            // Hide all screens
            screenViews.forEach(screen => screen.classList.remove('active'));

            // Show target screen
            const targetId = item.getAttribute('data-target');
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

    function appendUserMessage(text) {
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

        // Simulate AI thinking and responding
        setTimeout(() => {
            const aiDiv = document.createElement('div');
            aiDiv.className = 'message assistant';
            aiDiv.innerHTML = `
                <div class="avatar-small">AI</div>
                <div class="message-content">
                    <p>I've noted that detail. Let me update your case record.</p>
                    <div class="action-card">
                        <i class="ph ph-file-plus" style="color:var(--status-yellow-text)"></i>
                        <span>Added "Budgeting Example" to Case Record</span>
                    </div>
                    <p>Is there any other evidence you'd like to provide for this outcome?</p>
                </div>
            `;
            chatTranscript.appendChild(aiDiv);
            chatTranscript.scrollTop = chatTranscript.scrollHeight;

            // Visually toggle the missing item in record pane
            const warningCallout = document.querySelector('.record-sidebar .callout.warning');
            if (warningCallout) {
                warningCallout.className = 'callout small';
                warningCallout.style.backgroundColor = 'var(--status-green-bg)';
                warningCallout.style.borderColor = 'var(--status-green-text)';
                warningCallout.style.color = 'var(--status-green-text)';
                warningCallout.innerHTML = '<i class="ph ph-check-circle"></i> Extracted budget competency.';
            }

            // Update progress bar
            document.querySelector('.progress-bar-fill').style.width = '80%';
            document.querySelector('.progress-text').innerText = '80% Complete';

        }, 1500);
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
});
