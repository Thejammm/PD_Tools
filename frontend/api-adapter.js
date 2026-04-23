/**
 * API adapter for PD Scope tool.
 *
 * Strategy: "Online + local draft".
 *  - Auto-saves a draft to localStorage every few seconds while the user works.
 *  - On explicit save, pushes to the server (primary source of truth).
 *  - On load, shows the list from the server. Also offers to resume a local draft if one exists.
 *
 * The app's original saveAssessment / loadAssessment / renderSavedAssessments / deleteAssessment
 * functions are replaced below. The original `state` object and `restoreState` are reused.
 */
(function () {
  const DRAFT_KEY = 'pd-scope-draft';
  const AUTO_SAVE_MS = 5000;

  // ---------- Auth gate ----------
  (async function gate() {
    try {
      const { user } = await window.api.me();
      injectHeader(user);
    } catch {
      // Not logged in; api.js already redirects on 401, but if /me isn't called via api.js,
      // do an explicit redirect here.
      window.location.href = 'index.html';
    }
  })();

  function injectHeader(user) {
    const host = document.querySelector('.header');
    if (!host) return;
    const right = document.createElement('div');
    right.style.cssText = 'display:flex;gap:8px;align-items:center';
    right.innerHTML = `
      <span style="font-size:12px;opacity:.9">${escapeHtml(user.email)}</span>
      ${user.role === 'admin' ? '<a href="admin.html" style="color:#fff;background:rgba(255,255,255,.15);padding:6px 12px;border-radius:6px;text-decoration:none;font-size:12px">Admin</a>' : ''}
      <button id="__logout" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer">Log out</button>
    `;
    host.style.display = 'flex';
    host.style.justifyContent = 'space-between';
    host.style.alignItems = 'center';
    host.appendChild(right);
    document.getElementById('__logout').addEventListener('click', async () => {
      saveDraftNow();
      try { await window.api.logout(); } catch {}
      window.location.href = 'index.html';
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- Local draft (auto-save) ----------
  function saveDraftNow() {
    try {
      if (typeof state === 'undefined') return;
      if (typeof collectProjectDetails === 'function') {
        try { collectProjectDetails(); } catch {}
      }
      const payload = { state, timestamp: new Date().toISOString() };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('draft save failed:', e.message);
    }
  }
  setInterval(saveDraftNow, AUTO_SAVE_MS);
  window.addEventListener('beforeunload', saveDraftNow);

  function getDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function clearDraft() { localStorage.removeItem(DRAFT_KEY); }

  // Offer draft recovery on load, once the app has finished initialising.
  setTimeout(async () => {
    const draft = getDraft();
    if (!draft) return;
    const ageMin = Math.round((Date.now() - new Date(draft.timestamp).getTime()) / 60000);
    if (draft.state && confirm(`You have an unsaved draft from ${ageMin} min ago. Resume it?`)) {
      if (typeof restoreState === 'function') restoreState(draft.state);
    } else {
      clearDraft();
    }
  }, 300);

  // ---------- Server save/load (overrides) ----------
  // These replace the originals defined in app.html.

  let currentAssessmentId = null; // if set, `saveAssessment` updates instead of creating.

  window.saveAssessment = async function () {
    try {
      if (typeof collectProjectDetails === 'function') collectProjectDetails();
      const name = (state.project.name || 'Unnamed assessment').trim();
      if (currentAssessmentId) {
        await window.api.updateAssessment(currentAssessmentId, { name, state });
      } else {
        const { assessment } = await window.api.createAssessment(name, state);
        currentAssessmentId = assessment.id;
      }
      clearDraft();
      alert('Saved to server: ' + name);
      window.renderSavedAssessments();
    } catch (err) {
      alert('Save failed: ' + err.message + '\nYour work is kept as a local draft.');
    }
  };

  window.renderSavedAssessments = async function () {
    const el = document.getElementById('saved-assessments');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--text-light);font-style:italic">Loading…</p>';
    try {
      const { assessments } = await window.api.listAssessments();
      if (!assessments.length) {
        el.innerHTML = '<p style="color:var(--text-light);font-style:italic">No saved assessments yet.</p>';
        return;
      }
      let html = '<p style="font-size:12px;font-weight:600;color:var(--primary);margin-bottom:8px">SAVED ASSESSMENTS</p>';
      assessments.forEach((a) => {
        const updated = new Date(a.updated_at).toLocaleDateString('en-GB');
        html += `<div class="designer-card"><div class="designer-info"><h4>${escapeHtml(a.name)}</h4><p>Updated: ${updated}</p></div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-primary btn-small" data-load="${a.id}">Load</button>
            <button class="btn btn-red btn-small" data-del="${a.id}">Delete</button>
          </div></div>`;
      });
      el.innerHTML = html;
      el.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => window.loadAssessment(b.dataset.load)));
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => window.deleteAssessment(b.dataset.del)));
    } catch (err) {
      el.innerHTML = `<p style="color:#c0392b">Could not load saved assessments: ${escapeHtml(err.message)}</p>`;
    }
  };

  window.loadAssessment = async function (id) {
    try {
      const { assessment } = await window.api.getAssessment(id);
      if (typeof restoreState === 'function') restoreState(assessment.state);
      currentAssessmentId = assessment.id;
      clearDraft();
      alert('Loaded: ' + assessment.name);
    } catch (err) {
      alert('Load failed: ' + err.message);
    }
  };

  window.deleteAssessment = async function (id) {
    if (!confirm('Delete this assessment? This cannot be undone.')) return;
    try {
      await window.api.deleteAssessment(id);
      if (currentAssessmentId === id) currentAssessmentId = null;
      await window.renderSavedAssessments();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  // On load, populate the list (replaces the localStorage scan the app did at init).
  document.addEventListener('DOMContentLoaded', () => window.renderSavedAssessments());
  // Also try now in case DOMContentLoaded already fired.
  if (document.readyState !== 'loading') window.renderSavedAssessments();
})();
