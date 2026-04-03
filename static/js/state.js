/**
 * state.js — Shared mutable state for the NUPathway SPA.
 *
 * All modules import the same `S` object reference. Mutating S.property
 * is visible to all importers — this is the standard ES module state pattern.
 */

function initSessionId() {
    let sid = localStorage.getItem('cpl_session_id');
    if (!sid) {
        sid = 'session_' + crypto.randomUUID().slice(0, 12);
        localStorage.setItem('cpl_session_id', sid);
    }
    return sid;
}

export const S = {
    // Echo avatar — ✦ (U+2726 Black Four Pointed Star), no CDN dependency
    ECHO_AVATAR: `<div class="avatar-small bg-ai" style="font-size:0.85rem;line-height:1;">✦</div>`,

    sessionId: initSessionId(),
    currentCaseId: null,
    currentCompletionPct: 0,
    chatHasUnsavedContent: false,

    // Identity from localStorage (persisted across sessions)
    applicantName: localStorage.getItem('cpl_applicant_name') || '',
    studentId: localStorage.getItem('cpl_student_id') || '',
};
