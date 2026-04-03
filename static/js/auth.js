/**
 * auth.js — Role switcher and admin authentication for the NUPathway SPA.
 *
 * Exports: switchToReviewerNav, switchToApplicantNav, updateProfileDisplay, handleAdminLogout
 * Uses window.navigateTo (router.js), window.updateIntakeSidebar (chat.js) to avoid circular deps.
 * Assigns window.updateProfileDisplay so chat.js can call it without importing.
 */

import { S } from './state.js';

let isReviewer = window.location.pathname.startsWith('/admin');

export function switchToReviewerNav() {
    isReviewer = true;
    const applicantNavWrapper = document.getElementById('applicant-nav-wrapper');
    const reviewerNavWrapper = document.getElementById('reviewer-nav-wrapper');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileName = document.getElementById('profile-name');
    const profileRole = document.getElementById('profile-role');
    if (applicantNavWrapper) applicantNavWrapper.style.display = 'none';
    if (reviewerNavWrapper) reviewerNavWrapper.style.display = 'block';
    if (profileAvatar) profileAvatar.innerText = 'AR';
    if (profileName) profileName.innerText = 'Admin Reviewer';
    if (profileRole) profileRole.innerText = 'Reviewer';
    const switchLabel = document.getElementById('role-switch-label');
    if (switchLabel) switchLabel.innerText = 'Switch to Applicant';
}

export function switchToApplicantNav() {
    isReviewer = false;
    const reviewerNavWrapper = document.getElementById('reviewer-nav-wrapper');
    const applicantNavWrapper = document.getElementById('applicant-nav-wrapper');
    if (reviewerNavWrapper) reviewerNavWrapper.style.display = 'none';
    if (applicantNavWrapper) applicantNavWrapper.style.display = 'block';
    updateProfileDisplay();
    const switchLabel = document.getElementById('role-switch-label');
    if (switchLabel) switchLabel.innerText = 'Switch to Reviewer';
}

export function updateProfileDisplay() {
    const profileAvatar = document.getElementById('profile-avatar');
    const profileName = document.getElementById('profile-name');
    const profileRole = document.getElementById('profile-role');
    const name = S.applicantName || 'Applicant';
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'AP';
    if (profileAvatar) profileAvatar.innerText = initials;
    if (profileName) profileName.innerText = name;
    if (profileRole) profileRole.innerText = 'Applicant';
}

// Assigned to window so chat.js can call it without importing (avoids circular dep)
window.updateProfileDisplay = updateProfileDisplay;

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
    sessionStorage.removeItem(`draft_toast_${S.sessionId}`);

    // Generate a fresh session ID
    const newSessionId = 'session_' + crypto.randomUUID().slice(0, 12);

    // Reset localStorage identity — existing DB records are untouched
    localStorage.removeItem('cpl_applicant_name');
    localStorage.removeItem('cpl_student_id');
    localStorage.setItem('cpl_session_id', newSessionId);

    // Reset in-memory state
    S.sessionId = newSessionId;
    S.applicantName = '';
    S.studentId = '';
    S.currentCaseId = null;
    S.currentCompletionPct = 0;
    S.chatHasUnsavedContent = false;

    // Clear chat transcript
    const chatTranscript = document.getElementById('intake-chat');
    if (chatTranscript) chatTranscript.innerHTML = '';

    // Reset intake sidebar to blank state via window assignment (avoids circular dep with chat.js)
    if (typeof window.updateIntakeSidebar === 'function') {
        window.updateIntakeSidebar({ case_id: '—', status: 'New', completion_pct: 0, can_submit: false });
    }

    // Update profile display to anonymous
    updateProfileDisplay();

    // Close modal and return to home
    hideAdminLoginModal();
    window.navigateTo('/');

    showToast('Student session reset. Ready for a fresh demo.', 'success');
}

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
            window.navigateTo('/admin');
        } else {
            if (errEl) { errEl.textContent = data.error || 'Invalid credentials.'; errEl.style.display = 'block'; }
        }
    } catch (e) {
        if (errEl) { errEl.textContent = 'Login failed. Please try again.'; errEl.style.display = 'block'; }
    }
}

export function handleAdminLogout() {
    const token = sessionStorage.getItem('cpl_admin_token');
    if (token) {
        fetch('/api/admin/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        }).catch(() => {});
    }
    sessionStorage.removeItem('cpl_admin_token');
    window.navigateTo('/');
}

export function init() {
    // Wire login modal buttons
    document.getElementById('admin-login-submit')?.addEventListener('click', attemptAdminLogin);
    document.getElementById('admin-login-cancel')?.addEventListener('click', hideAdminLoginModal);
    document.getElementById('admin-login-close')?.addEventListener('click', hideAdminLoginModal);
    document.getElementById('admin-login-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptAdminLogin();
    });

    document.getElementById('reset-student-btn')?.addEventListener('click', resetStudentSession);

    const roleSwitchBtn = document.getElementById('role-switch-btn');
    if (roleSwitchBtn) {
        roleSwitchBtn.addEventListener('click', () => {
            if (isReviewer) {
                handleAdminLogout();
            } else {
                showAdminLoginModal();
            }
        });
    }

    // On page load, check if admin token exists for admin routes
    if (window.location.pathname.startsWith('/admin')) {
        const token = sessionStorage.getItem('cpl_admin_token');
        if (!token) {
            window.navigateTo('/', false);
        }
    }
}
