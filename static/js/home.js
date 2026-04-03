/**
 * home.js — Homepage interactions for the NUPathway SPA.
 *
 * Handles: prompt suggestions, landing composer send, primary action button.
 * Uses window.navigateTo (router.js) to avoid importing router.js.
 */

import { S } from './state.js';
import { getRequestHeaders } from './utils.js';
import { appendUserMessage, updateIntakeSidebar } from './chat.js';

export function initiateChatFromLanding(promptText) {
    if (!promptText.trim()) return;

    // Check if user has existing draft to resume
    const resumeKeywords = ['resume', 'continue', 'draft', 'my draft', 'existing'];
    const isResumeAttempt = resumeKeywords.some(k => promptText.toLowerCase().includes(k));

    if (isResumeAttempt && S.studentId) {
        // Try to find existing draft and navigate to it
        fetch('/api/cases', { headers: getRequestHeaders() })
            .then(r => r.json())
            .then(data => {
                const draft = (data.cases || []).find(c => ['Draft', 'In Progress', 'New'].includes(c.status));
                if (draft && draft.session_id) {
                    S.sessionId = draft.session_id;
                    localStorage.setItem('cpl_session_id', S.sessionId);
                    S.currentCaseId = draft.case_id;
                    S.currentCompletionPct = draft.completion_pct || 0;
                    S.chatHasUnsavedContent = false;
                    const chatTranscript = document.getElementById('intake-chat');
                    if (chatTranscript) chatTranscript.innerHTML = '';
                    window.navigateTo('/chat');
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

export function _startFreshChat(promptText) {
    // Fresh session
    S.sessionId = 'session_' + crypto.randomUUID().slice(0, 12);
    localStorage.setItem('cpl_session_id', S.sessionId);

    // Fix for identity bleed: Treat as completely fresh unless restoring session
    localStorage.removeItem('cpl_applicant_name');
    localStorage.removeItem('cpl_student_id');
    S.applicantName = '';
    S.studentId = '';

    S.currentCaseId = null;
    S.currentCompletionPct = 0;
    S.chatHasUnsavedContent = false;
    sessionStorage.removeItem(`draft_toast_${S.sessionId}`);

    // Clear chat
    const chatTranscript = document.getElementById('intake-chat');
    if (chatTranscript) chatTranscript.innerHTML = '';

    // Reset sidebar
    updateIntakeSidebar({ case_id: '—', status: 'New', completion_pct: 0, can_submit: false });

    window.navigateTo('/chat');
    setTimeout(() => appendUserMessage(promptText), 200);
}

export function init() {
    // Prompt suggestion chips
    document.querySelectorAll('.prompt-suggestion').forEach(s => {
        s.addEventListener('click', () => initiateChatFromLanding(s.dataset.prompt));
    });

    // Landing composer send button
    const landingSendBtn = document.querySelector('.composer-send-btn');
    const landingComposerInput = document.querySelector('.composer-textarea');
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

    // New Case button (topbar primary action)
    const primaryBtn = document.getElementById('primary-action-btn');
    if (primaryBtn) {
        primaryBtn.addEventListener('click', () => initiateChatFromLanding('I want to start a new evaluation case.'));
    }
}
