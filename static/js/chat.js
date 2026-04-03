/**
 * chat.js — Chat orchestration for the NUPathway SPA.
 *
 * Exports: appendUserMessage, updateIntakeSidebar
 * Uses window.updateProfileDisplay (auth.js) to avoid circular imports.
 * Assigns window.updateIntakeSidebar so auth.js can call it without importing.
 */

import { S } from './state.js';
import { escapeHtml, formatMarkdown, getRequestHeaders } from './utils.js';

export function updateIntakeSidebar(data) {
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

// Assigned to window so auth.js can call it without importing (avoids circular dep)
window.updateIntakeSidebar = updateIntakeSidebar;

export async function appendUserMessage(text) {
    if (!text.trim()) return;

    const chatTranscript = document.getElementById('intake-chat');
    const chatInput = document.getElementById('chat-input');

    // Render user bubble
    const initials = S.applicantName ? S.applicantName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : 'ME';
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';
    msgDiv.innerHTML = `
        <div class="avatar-small img">${initials}</div>
        <div class="message-content"><p>${escapeHtml(text)}</p></div>
    `;
    chatTranscript.appendChild(msgDiv);
    if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; }
    chatTranscript.scrollTop = chatTranscript.scrollHeight;

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant loading-indicator';
    loadingDiv.innerHTML = `${S.ECHO_AVATAR}<div class="message-content"><p class="text-muted"><i class="ph ph-spinner ph-spin"></i> Echo is thinking...</p></div>`;
    chatTranscript.appendChild(loadingDiv);
    chatTranscript.scrollTop = chatTranscript.scrollHeight;

    try {
        const payload = { message: text, session_id: S.sessionId };
        if (S.applicantName) payload.applicant_name = S.applicantName;
        if (S.studentId) payload.student_id = S.studentId;

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
        const textP = document.createElement('div'); // div not p — marked outputs block HTML
        msgContent.appendChild(textP);
        aiDiv.innerHTML = S.ECHO_AVATAR;
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
        if (meta.case_id) S.currentCaseId = meta.case_id;
        if (meta.completion_pct !== undefined) S.currentCompletionPct = meta.completion_pct;
        if (meta.applicant_name && !S.applicantName) {
            S.applicantName = meta.applicant_name;
            localStorage.setItem('cpl_applicant_name', S.applicantName);
            if (typeof window.updateProfileDisplay === 'function') window.updateProfileDisplay();
        }
        if (meta.student_id && !S.studentId) {
            S.studentId = meta.student_id;
            localStorage.setItem('cpl_student_id', S.studentId);
        }
        S.chatHasUnsavedContent = !meta.draft_saved;
        if (meta.draft_saved && meta.status === 'Draft') {
            if (!sessionStorage.getItem(`draft_toast_${S.sessionId}`)) {
                showToast('Draft saved — you can return to this case later.', 'success');
                sessionStorage.setItem(`draft_toast_${S.sessionId}`, '1');
            }
        }
        if (meta.case_id) updateIntakeSidebar(meta);

    } catch (error) {
        const chatTranscript = document.getElementById('intake-chat');
        if (chatTranscript && chatTranscript.contains(loadingDiv)) chatTranscript.removeChild(loadingDiv);
        showToast('Error connecting to backend. Please try again.', 'error');
        const errDiv = document.createElement('div');
        errDiv.className = 'message assistant';
        errDiv.innerHTML = `${S.ECHO_AVATAR}<div class="message-content"><p style="color: var(--status-red-text);">Connection error. Please try again.</p></div>`;
        if (chatTranscript) chatTranscript.appendChild(errDiv);
    }
}

export function init() {
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send');

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
            if (!S.currentCaseId) return showToast('No active case.', 'warning');

            showModal({
                title: 'Submit for Review',
                body: '<p>Are you ready to submit your case for evaluation?</p><p class="text-sm text-muted">Note: Submission does not guarantee approval. A reviewer will evaluate your case and make the final decision.</p>',
                confirmText: 'Submit',
                onConfirm: async () => {
                    try {
                        const resp = await fetch(`/api/case/${S.currentCaseId}/submit`, {
                            method: 'POST',
                            headers: getRequestHeaders(),
                        });
                        const data = await resp.json();
                        if (resp.ok) {
                            showToast(data.message || 'Case submitted!', 'success');
                            updateIntakeSidebar({ ...data, completion_pct: S.currentCompletionPct, can_submit: false });
                            S.chatHasUnsavedContent = false;
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

    // Record tabs (chat screen right panel tabs)
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
}
