const FEEDBACK_WORKER_URL = "https://myplanfeedback.eliabungata.workers.dev";
    const FEEDBACK_HINT_KEY = "planBoardFeedbackHintDismissed";

    function dismissFeedbackHint(){
      try{ localStorage.setItem(FEEDBACK_HINT_KEY, '1'); }catch(e){}
      const hint = document.getElementById('feedbackHint');
      if(hint) hint.classList.add('feedback-hint-hidden');
    }

    // Positions the hand relative to the feedback button's ACTUAL measured
    // rect (getBoundingClientRect), not a guessed pixel width. This is the
    // only reliable fix: any hardcoded `right` value drifts out of sync
    // the moment the button's text/padding/icon changes or the viewport
    // is resized, and when it drifts far enough the button (higher
    // z-index) sits on top of the hand and hides it completely.
    function positionFeedbackHint(){
      const hint = document.getElementById('feedbackHint');
      const fab = document.getElementById('feedbackFab');
      if(!hint || !fab) return;
      if(hint.classList.contains('feedback-hint-hidden')) return;

      const fabRect = fab.getBoundingClientRect();
      if(fabRect.width === 0 && fabRect.height === 0) return; // fab not visible/laid out yet

      const gap = 6; // breathing room between hand and button edge
      const hintHalfHeight = hint.getBoundingClientRect().height / 2 || 15;
      const rightOffset = window.innerWidth - fabRect.left + gap;
      const bottomOffset = window.innerHeight - fabRect.bottom + (fabRect.height / 2) - hintHalfHeight; // vertically centered on the button

      hint.style.right = rightOffset + 'px';
      hint.style.bottom = bottomOffset + 'px';
      hint.classList.add('feedback-hint-ready');
    }

    (function initFeedbackHint(){
      let dismissed = false;
      try{ dismissed = localStorage.getItem(FEEDBACK_HINT_KEY) === '1'; }catch(e){}
      if(dismissed){
        const hint = document.getElementById('feedbackHint');
        if(hint) hint.classList.add('feedback-hint-hidden');
        return;
      }
      positionFeedbackHint();
      // Re-measure after fonts/webfonts finish swapping (can change button
      // width) and whenever the viewport changes.
      window.addEventListener('resize', positionFeedbackHint);
      window.addEventListener('load', positionFeedbackHint);
      if(document.fonts && document.fonts.ready){
        document.fonts.ready.then(positionFeedbackHint);
      }
      setTimeout(positionFeedbackHint, 300); // safety net for late layout shifts
    })();

    function openFeedback(){
      dismissFeedbackHint();
      document.getElementById('feedbackOverlay').classList.add('open');
      document.getElementById('feedbackStatus').textContent = '';
      document.getElementById('feedbackStatus').className = 'feedback-status';
      setTimeout(() => document.getElementById('feedbackText').focus(), 50);
    }
    function closeFeedback(){
      document.getElementById('feedbackOverlay').classList.remove('open');
    }

    function sendFeedback(){
      const textEl = document.getElementById('feedbackText');
      const comment = textEl.value.trim();
      const statusEl = document.getElementById('feedbackStatus');
      const btn = document.getElementById('feedbackSendBtn');
      if(!comment){
        statusEl.textContent = 'Please write something first.';
        statusEl.className = 'feedback-status err';
        return;
      }

      let view = (typeof currentView !== 'undefined') ? currentView : 'unknown';

      const payload = {
        comment: comment,
        view: view,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        website: document.getElementById('feedbackHoneypot').value
      };

      btn.disabled = true;
      statusEl.textContent = 'Sending...';
      statusEl.className = 'feedback-status';

      fetch(FEEDBACK_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        btn.disabled = false;
        if(ok && data.success !== false){
          statusEl.textContent = 'Thanks — got it!';
          statusEl.className = 'feedback-status ok';
          textEl.value = '';
          setTimeout(closeFeedback, 1200);
        } else {
          statusEl.textContent = "Couldn't send — try again.";
          statusEl.className = 'feedback-status err';
        }
      })
      .catch(() => {
        btn.disabled = false;
        statusEl.textContent = "Couldn't send — try again.";
        statusEl.className = 'feedback-status err';
      });
    }

    // ---------- Custom confirm modal (replaces native confirm()) ----------
    let _confirmAction = null;
    function showConfirmModal(title, message, onConfirm){
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      _confirmAction = onConfirm;
      document.getElementById('confirmOverlay').classList.add('open');
    }
    function closeConfirmModal(){
      document.getElementById('confirmOverlay').classList.remove('open');
      _confirmAction = null;
    }
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
      const action = _confirmAction;
      closeConfirmModal();
      if(action) action();
    });
    document.addEventListener('keydown', (e) => {
      const overlayOpen = document.getElementById('confirmOverlay').classList.contains('open');
      if(!overlayOpen) return;
      if(e.key === 'Escape') closeConfirmModal();
      else if(e.key === 'Enter'){
        e.preventDefault();
        document.getElementById('confirmDeleteBtn').click();
      }
    });
