/**
 * app.js — Entry point for the NUPathway SPA (ES Module).
 *
 * Imports all modules and runs the boot sequence inside DOMContentLoaded.
 * loaded as <script type="module"> — always deferred, DOM is ready on execution.
 */

import { initMarked } from './utils.js';
import { updateProfileDisplay, init as initAuth } from './auth.js';
import { init as initRouter, navigateTo } from './router.js';
import { init as initChat } from './chat.js';
import { init as initHome } from './home.js';
import { init as initCases, attemptSessionRecovery } from './cases.js';
import { init as initAdmin } from './admin.js';
import { init as initSettings } from './settings.js';
import { init as initEvidence } from './evidence.js';

document.addEventListener('DOMContentLoaded', () => {
    // Initialize marked.js (CDN loaded as classic script before this module)
    initMarked();

    // Wire all event listeners
    initRouter();
    initAuth();
    initChat();
    initHome();
    initCases();
    initAdmin();
    initSettings();
    initEvidence();

    // Boot sequence
    updateProfileDisplay();
    navigateTo(window.location.pathname, false);
    attemptSessionRecovery();
});
