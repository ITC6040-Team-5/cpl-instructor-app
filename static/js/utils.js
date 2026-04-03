/**
 * utils.js — Shared utility functions for the NUPathway SPA.
 */

import { S } from './state.js';

export function getRequestHeaders() {
    const h = { 'Content-Type': 'application/json' };
    if (S.applicantName) h['X-Applicant-Name'] = S.applicantName;
    if (S.studentId) h['X-Student-Id'] = S.studentId;
    return h;
}

export function getAdminHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const token = sessionStorage.getItem('cpl_admin_token');
    if (token) h['X-Admin-Token'] = token;
    return h;
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
}

// Configure marked once at init: GFM (GitHub Flavored Markdown) + line breaks
export function initMarked() {
    if (typeof marked !== 'undefined') {
        marked.use({ breaks: true, gfm: true });
    }
}

export function formatMarkdown(text) {
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

export function getBadgeClass(status) {
    const map = {
        'New': 'gray', 'Draft': 'gray', 'In Progress': 'blue',
        'Ready for Review': 'blue', 'Submitted': 'blue',
        'Under Review': 'yellow', 'Revision Requested': 'yellow',
        'Escalated': 'orange',
        'Approved': 'green', 'Denied': 'red',
    };
    return map[status] || 'gray';
}

export function getFileIcon(filename) {
    if (!filename) return 'ph-fill ph-file';
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': 'ph-fill ph-file-pdf', 'doc': 'ph-fill ph-file-text', 'docx': 'ph-fill ph-file-text',
        'png': 'ph-fill ph-image', 'jpg': 'ph-fill ph-image', 'jpeg': 'ph-fill ph-image',
        'md': 'ph-fill ph-file-text',
    };
    return icons[ext] || 'ph-fill ph-file';
}

export function formatTimestamp(ts) {
    if (!ts) return '—';
    try {
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
             + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch { return ts; }
}
