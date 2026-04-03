/**
 * router.js — SPA routing via History API for the NUPathway SPA.
 *
 * Exports: navigateTo (also assigned to window.navigateTo)
 * Imports route-entry hooks from cases, admin, settings, auth modules.
 * All other modules use window.navigateTo to avoid circular imports back to this file.
 */

import { S } from './state.js';
import { fetchApplicantCases } from './cases.js';
import { fetchAdminCases } from './admin.js';
import { loadSettingsTab } from './settings.js';
import { switchToReviewerNav, switchToApplicantNav } from './auth.js';

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

export function navigateTo(path, push = true) {
    // Navigate-away warning for unsaved chat below draft threshold
    if (S.chatHasUnsavedContent && window.location.pathname === '/chat' && path !== '/chat') {
        showModal({
            title: 'Unsaved Progress',
            body: '<p>Your conversation hasn\'t gathered enough information to save as a draft. If you leave now, your progress will be lost.</p><p>Continue chatting to build your case further.</p>',
            confirmText: 'Leave Anyway',
            cancelText: 'Stay',
            dangerous: true,
            onConfirm: () => {
                S.chatHasUnsavedContent = false;
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
    const breadcrumb = document.getElementById('dynamic-breadcrumb');
    if (breadcrumb) {
        breadcrumb.innerText = breadcrumbMap[path] || breadcrumbMap['/'];
    }

    // Nav highlighting — map sub-views to their parent nav item
    const navTargetMap = { 'admin-review-screen': 'admin-dashboard-screen' };
    const highlightTarget = navTargetMap[targetId] || targetId;
    const navItems = document.querySelectorAll('.nav-item');
    const activeNav = document.querySelector(`.nav-item[data-target="${highlightTarget}"]`);
    if (activeNav) {
        navItems.forEach(nav => nav.classList.remove('active'));
        activeNav.classList.add('active');
    }

    // Show/hide screens
    document.querySelectorAll('.screen-view').forEach(screen => screen.classList.remove('active'));
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
}

// Assign to window so all other modules can call window.navigateTo without importing router.js
window.navigateTo = navigateTo;

export function init() {
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
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const targetId = item.getAttribute('data-target');
            if (targetId && reverseRoutes[targetId]) {
                e.preventDefault();
                navigateTo(reverseRoutes[targetId]);
            }
        });
    });

    // Sidebar footer initial state
    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter) {
        sidebarFooter.style.opacity = '0';
        sidebarFooter.style.transform = 'translateY(10px)';
        sidebarFooter.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    }
}
