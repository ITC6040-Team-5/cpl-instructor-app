/**
 * evidence.js — File upload (paperclip) for the NUPathway SPA.
 *
 * Handles: evidence file input creation, paperclip button, browse links, upload to /api/evidence/upload.
 */

import { S } from './state.js';
import { escapeHtml, getFileIcon } from './utils.js';
import { appendUserMessage } from './chat.js';

export function init() {
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
    document.querySelectorAll('.dropzone .btn-secondary, .mini-dropzone a').forEach(btn => {
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
            formData.append('session_id', S.sessionId);
            if (S.currentCaseId) formData.append('case_id', S.currentCaseId);

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
                    const chatTranscript = document.getElementById('intake-chat');
                    if (chatTranscript) {
                        const attachDiv = document.createElement('div');
                        attachDiv.className = 'message user';
                        attachDiv.innerHTML = `<div class="avatar-small img">ME</div><div class="message-content"><p>📎 <em>${escapeHtml(data.filename)}</em> uploaded</p></div>`;
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
}
