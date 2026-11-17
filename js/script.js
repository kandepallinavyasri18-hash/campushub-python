/* ==========================================================================
   CampusHub - Client-side interactivity helpers
   --------------------------------------------------------------------------
   Core business logic and page rendering have been converted to Python Flask
   server-side templates (Jinja2). This minimal client script handles only
   browser-native UI events that cannot run on the server:
     1. Panel/tab navigation switching
     2. Mobile menu toggle
     3. Password visibility toggle
     4. Modal dialogs (Ask question, Answer question, Edit answer, Question list)
     5. Action handlers (Ratings, Deletions, User toggles, Moderation)
     6. Client authentication forms (Login, Register) with helpful feedback
     7. AJAX form submission with CSRF token injection for all upload/POST forms
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. Helpers
   * ------------------------------------------------------------------ */
  var $ = function (selector, root) { return (root || document).querySelector(selector); };
  var $$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  var ROUTES = {
    home: '/index.html',
    login: '/login.html',
    register: '/register.html',
    dashboards: {
      student: '/student-dashboard.html',
      faculty: '/faculty-dashboard.html',
      admin: '/admin-dashboard.html'
    }
  };

  function roleLabel(role) {
    var labels = { student: 'Student', faculty: 'Faculty', admin: 'Admin' };
    return labels[role] || role || '';
  }

  function dashboardFor(role) {
    return ROUTES.dashboards[role] || null;
  }

  function getCsrfToken() {
    var csrfCookie = document.cookie.match(/(?:^|;\s*)campushub_csrf=([^;]+)/);
    return csrfCookie ? decodeURIComponent(csrfCookie[1]) : '';
  }

  function api(path, options) {
    options = options || {};
    var method = (options.method || 'GET').toUpperCase();
    var init = {
      method: method,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) !== -1) {
      var csrfToken = getCsrfToken();
      if (csrfToken) {
        init.headers['X-CSRF-Token'] = csrfToken;
      }
    }

    if (options.body !== undefined && options.body !== null) {
      if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
        init.body = options.body;
      } else {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }
    }

    return fetch(path, init).then(function (response) {
      return response
        .json()
        .catch(function () { return {}; })
        .then(function (data) {
          return { ok: response.ok, status: response.status, data: data || {} };
        });
    }).catch(function () {
      return {
        ok: false,
        status: 0,
        data: { message: 'Cannot reach the CampusHub server. Make sure it is running.' }
      };
    });
  }

  function showAlert(element, type, message) {
    if (!element) { return; }
    element.className = 'alert alert-' + type;
    element.textContent = message;
    element.hidden = false;
  }

  function setFieldError(input, message) {
    if (!input) { return; }
    var err = $('#' + input.id + 'Error');
    if (err) {
      err.textContent = message || '';
      err.hidden = !message;
    }
    input.classList.toggle('has-error', Boolean(message));
  }

  function clearErrors(form) {
    $$('.field-error', form).forEach(function (node) { node.hidden = true; node.textContent = ''; });
    $$('.has-error', form).forEach(function (node) { node.classList.remove('has-error'); });
  }

  /* ------------------------------------------------------------------ *
   * 2. UI: Mobile navigation, password toggle, panels
   * ------------------------------------------------------------------ */
  function initNav() {
    var toggle = $('#navToggle');
    var nav = $('#dashSidebar') || $('#primaryNav');
    if (!toggle || !nav) { return; }
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  function initPasswordToggle() {
    $$('[data-toggle-password]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-toggle-password');
        var input = document.getElementById(id);
        if (!input) { return; }
        var isText = input.type === 'text';
        input.type = isText ? 'password' : 'text';
        btn.textContent = isText ? 'Show' : 'Hide';
        btn.setAttribute('aria-label', (isText ? 'Show' : 'Hide') + ' password');
      });
    });
  }

  function initPanels() {
    var links = $$('[data-panel-target]');
    var panels = $$('.dash-panel');
    if (!links.length || !panels.length) { return; }

    function activate(name, updateHash) {
      var found = false;
      panels.forEach(function (panel) {
        var isTarget = panel.getAttribute('data-panel') === name;
        panel.hidden = !isTarget;
        panel.classList.toggle('is-active', isTarget);
        if (isTarget) { found = true; }
      });

      if (!found) { return false; }

      links.forEach(function (link) {
        var isTarget = link.getAttribute('data-panel-target') === name;
        link.classList.toggle('is-active', isTarget);
        if (isTarget) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      });

      if (updateHash && window.location.hash !== '#' + name) {
        window.location.hash = name;
      }
      return true;
    }

    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        var name = link.getAttribute('data-panel-target');
        if (activate(name, true)) { event.preventDefault(); }
      });
    });

    var initial = (window.location.hash || '').replace('#', '');
    if (!initial || !activate(initial, false)) {
      activate(panels[0].getAttribute('data-panel'), false);
    }

    window.addEventListener('hashchange', function () {
      activate((window.location.hash || '').replace('#', ''), false);
    });
  }

  /* ------------------------------------------------------------------ *
   * 3. Modal Dialogs (Text Dialog & Question List)
   * ------------------------------------------------------------------ */
  function openTextDialog(title, label, submitLabel, initialValue) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'text-dialog-backdrop';
      overlay.innerHTML = '<div class="text-dialog" role="dialog" aria-modal="true" aria-labelledby="textDialogTitle" style="background:#ffffff; color:#0f172a; border-radius:16px; padding:24px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.35); max-width:560px; width:92%;">' +
        '<form class="text-dialog-form">' +
        '<h2 id="textDialogTitle" style="color:#0f172a; margin-top:0; margin-bottom:12px; font-size:1.3rem;"></h2>' +
        '<p style="color:#475569; font-size:0.88rem; margin-bottom:6px; font-weight:600;">Details:</p>' +
        '<div class="text-dialog-label" id="textDialogQuestionBox" style="color:#0f172a; font-weight:600; font-size:1rem; margin-bottom:16px; background:#f8fafc; padding:12px 14px; border-radius:8px; border:1px solid #cbd5e1; line-height:1.5;"></div>' +
        '<label for="textDialogInput" style="display:block; color:#0f172a; font-size:0.88rem; margin-bottom:6px; font-weight:600;">Your Input:</label>' +
        '<textarea id="textDialogInput" class="input textarea" rows="4" placeholder="Type here..." style="background:#ffffff; color:#0f172a; border:1px solid #94a3b8; border-radius:8px; padding:12px; width:100%; box-sizing:border-box; font-size:0.95rem; line-height:1.5;" required></textarea>' +
        '<div class="text-dialog-actions" style="margin-top:16px; display:flex; justify-content:flex-end; gap:10px;"><button type="button" class="btn btn-outline text-dialog-cancel">Cancel</button>' +
        '<button type="submit" class="btn btn-primary text-dialog-submit"></button></div>' +
        '</form></div>';
      document.body.appendChild(overlay);
      var form = overlay.querySelector('form');
      var input = overlay.querySelector('#textDialogInput');
      overlay.querySelector('#textDialogTitle').textContent = title;
      overlay.querySelector('#textDialogQuestionBox').textContent = label;
      overlay.querySelector('.text-dialog-submit').textContent = submitLabel;
      input.value = initialValue || '';

      function close(val) {
        overlay.remove();
        resolve(val);
      }
      overlay.querySelector('.text-dialog-cancel').addEventListener('click', function () { close(''); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(''); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var val = input.value.trim();
        if (val) close(val);
      });
      input.focus();
    });
  }

  function openResourceAnswerDialog(resourceId, resourceTitle) {
    api('/api/questions').then(function (result) {
      if (!result.ok) {
        window.alert(result.data.message || 'Unable to load questions.');
        return;
      }
      var questions = (result.data.questions || []).filter(function (item) {
        return String(item.resourceId) === String(resourceId);
      });
      if (!questions.length) {
        window.alert('There are no questions asked on this resource yet.');
        return;
      }

      var overlay = document.createElement('div');
      overlay.className = 'text-dialog-backdrop';
      overlay.innerHTML = '<div class="text-dialog" role="dialog" aria-modal="true" style="max-width: 640px; width: 92%; max-height: 90vh; overflow-y: auto; background: #ffffff; color: #0f172a; border-radius: 16px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35);">' +
        '<h2 style="color:#0f172a; margin-top:0;">Questions: ' + (resourceTitle || 'Resource') + '</h2>' +
        '<p class="muted small" style="color:#475569;">Questions asked by students and their responses:</p>' +
        '<div class="resource-question-options" style="margin-top:1rem;"></div>' +
        '<div class="text-dialog-actions" style="margin-top:16px; display:flex; justify-content:flex-end;"><button type="button" class="btn btn-outline resource-answer-close">Close</button></div></div>';
      document.body.appendChild(overlay);

      var list = overlay.querySelector('.resource-question-options');
      questions.forEach(function (q) {
        var card = document.createElement('div');
        card.style.cssText = 'border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:10px; background:#f8fafc;';
        var qText = document.createElement('p');
        qText.style.cssText = 'font-weight:600; color:#0f172a; margin-bottom:6px;';
        qText.textContent = 'Q: ' + (q.text || q.question);
        var qMeta = document.createElement('p');
        qMeta.className = 'muted small';
        qMeta.textContent = 'Asked by ' + ((q.askedBy && q.askedBy.fullName) || 'Student');
        card.appendChild(qText);
        card.appendChild(qMeta);

        if (q.answer) {
          var aText = document.createElement('p');
          aText.style.cssText = 'margin-top:6px; color:#1e293b;';
          aText.textContent = 'A: ' + q.answer + ((q.answeredBy && q.answeredBy.fullName) ? ' (by ' + q.answeredBy.fullName + ')' : '');
          card.appendChild(aText);
        } else {
          var noA = document.createElement('p');
          noA.className = 'muted small';
          noA.textContent = 'Not answered yet.';
          card.appendChild(noA);
        }
        list.appendChild(card);
      });

      function closeDialog() { overlay.remove(); }
      overlay.querySelector('.resource-answer-close').addEventListener('click', closeDialog);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeDialog(); });
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. Interactive Action Handlers
   * ------------------------------------------------------------------ */
  function initActionHandlers() {
    document.addEventListener('click', function (event) {
      var target = event.target;

      // Rate resource button
      if (target.matches('.btn-rate')) {
        var resId = target.getAttribute('data-resource-id');
        var select = $('select[data-resource-id="' + resId + '"]');
        var ratingVal = select ? Number(select.value) : 5;
        api('/api/resources/' + encodeURIComponent(resId) + '/rating', {
          method: 'PUT',
          body: { rating: ratingVal }
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to submit rating.');
          }
        });
        return;
      }

      // Ask question button
      if (target.matches('.btn-ask-question')) {
        var resIdAsk = target.getAttribute('data-resource-id');
        var resTitle = target.getAttribute('data-resource-title') || 'this resource';
        openTextDialog('Ask a Question', 'Resource: ' + resTitle, 'Submit Question').then(function (text) {
          if (!text) { return; }
          api('/api/questions', {
            method: 'POST',
            body: { resourceId: resIdAsk, text: text }
          }).then(function (res) {
            if (res.ok) {
              window.location.hash = '#questions';
              window.location.reload();
            } else {
              window.alert(res.data.message || 'Unable to submit question.');
            }
          });
        });
        return;
      }

      // View question list button
      if (target.matches('.btn-view-questions')) {
        var resIdView = target.getAttribute('data-resource-id');
        var card = target.closest('.resource-card');
        var titleEl = card ? card.querySelector('h3') : null;
        openResourceAnswerDialog(resIdView, titleEl ? titleEl.textContent : '');
        return;
      }

      // Answer question button (faculty)
      if (target.matches('.btn-answer-question')) {
        var qIdAns = target.getAttribute('data-question-id');
        var qText = target.getAttribute('data-question-text') || 'Question';
        openTextDialog('Answer Question', qText, 'Submit Answer').then(function (text) {
          if (!text) { return; }
          api('/api/questions/' + encodeURIComponent(qIdAns) + '/answers', {
            method: 'POST',
            body: { text: text }
          }).then(function (res) {
            if (res.ok) {
              window.location.hash = '#questions';
              window.location.reload();
            } else {
              window.alert(res.data.message || 'Unable to post answer.');
            }
          });
        });
        return;
      }

      // Edit answer button
      if (target.matches('.btn-edit-answer')) {
        var qIdEdit = target.getAttribute('data-question-id');
        var currText = target.getAttribute('data-answer-text') || '';
        openTextDialog('Edit Answer', 'Update your response', 'Save Changes', currText).then(function (text) {
          if (!text) { return; }
          api('/api/questions/' + encodeURIComponent(qIdEdit) + '/answers', {
            method: 'PUT',
            body: { text: text }
          }).then(function (res) {
            if (res.ok) {
              window.location.reload();
            } else {
              window.alert(res.data.message || 'Unable to update answer.');
            }
          });
        });
        return;
      }

      // Delete answer button
      if (target.matches('.btn-delete-answer')) {
        var qIdDel = target.getAttribute('data-question-id');
        if (!window.confirm('Are you sure you want to delete your answer?')) { return; }
        api('/api/questions/' + encodeURIComponent(qIdDel) + '/answers', {
          method: 'DELETE'
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to delete answer.');
          }
        });
        return;
      }

      // Mark answer helpful / accept
      if (target.matches('.btn-accept-answer')) {
        var qIdAcc = target.getAttribute('data-question-id');
        api('/api/questions/' + encodeURIComponent(qIdAcc) + '/accept', {
          method: 'PUT',
          body: { accepted: true }
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to accept answer.');
          }
        });
        return;
      }

      // Delete resource button
      if (target.matches('.btn-delete-resource')) {
        var rIdDel = target.getAttribute('data-resource-id');
        if (!window.confirm('Are you sure you want to remove this resource?')) { return; }
        api('/api/resources/' + encodeURIComponent(rIdDel), {
          method: 'DELETE'
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to remove resource.');
          }
        });
        return;
      }

      // Delete submission button
      if (target.matches('.btn-delete-submission')) {
        var aIdDel = target.getAttribute('data-assignment-id');
        if (!window.confirm('Delete your assignment submission?')) { return; }
        api('/api/assignments/' + encodeURIComponent(aIdDel) + '/submission', {
          method: 'DELETE'
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to delete submission.');
          }
        });
        return;
      }

      // Delete question button (admin)
      if (target.matches('.btn-delete-question')) {
        var qIdAdminDel = target.getAttribute('data-question-id');
        if (!window.confirm('Are you sure you want to remove this question?')) { return; }
        api('/api/questions/' + encodeURIComponent(qIdAdminDel), {
          method: 'DELETE'
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to remove question.');
          }
        });
        return;
      }

      // Toggle user activation (admin)
      if (target.matches('.btn-toggle-user')) {
        var uId = target.getAttribute('data-user-id');
        var currActive = target.getAttribute('data-active') === 'true';
        api('/api/admin/users/' + encodeURIComponent(uId), {
          method: 'PATCH',
          body: { isActive: !currActive }
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to change user status.');
          }
        });
        return;
      }

      // Moderate contribution (admin)
      if (target.matches('.btn-moderate-contribution')) {
        var cId = target.getAttribute('data-contribution-id');
        if (!window.confirm('Revoke this contribution from active points?')) { return; }
        api('/api/admin/leadership/contributions/' + encodeURIComponent(cId), {
          method: 'DELETE'
        }).then(function (res) {
          if (res.ok) {
            window.location.reload();
          } else {
            window.alert(res.data.message || 'Unable to revoke contribution.');
          }
        });
        return;
      }
    });

    // Admin user live search
    var adminSearch = $('#adminUserSearch');
    var usersTbody = $('#adminUsersTableBody');
    if (adminSearch && usersTbody) {
      adminSearch.addEventListener('input', function () {
        var query = adminSearch.value.trim().toLowerCase();
        $$('tr', usersTbody).forEach(function (row) {
          var text = row.textContent.toLowerCase();
          row.style.display = (!query || text.indexOf(query) !== -1) ? '' : 'none';
        });
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 5. AJAX Form Submission with CSRF (file uploads & POST forms)
   *    Intercepts all multipart/form-data forms to add the CSRF token
   *    and show inline success/error feedback without full page reload.
   * ------------------------------------------------------------------ */
  function submitFormViaFetch(form, alertEl, submitBtn, successMsg, redirectTo) {
    var originalLabel = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
    if (alertEl) { alertEl.hidden = true; }

    var formData = new FormData(form);
    var csrfToken = getCsrfToken();

    var init = {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
      body: formData
    };
    if (csrfToken) {
      init.headers['X-CSRF-Token'] = csrfToken;
    }

    fetch(form.action, init)
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          return { ok: response.ok, status: response.status, data: data };
        });
      })
      .then(function (result) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
        if (result.ok) {
          if (alertEl) { showAlert(alertEl, 'success', successMsg || result.data.message || 'Done!'); }
          // Reload after short delay so user sees success message
          setTimeout(function () {
            if (redirectTo) {
              window.location.href = redirectTo;
            } else {
              window.location.reload();
            }
          }, 800);
        } else {
          var msg = result.data.message || 'An error occurred. Please try again.';
          if (alertEl) {
            showAlert(alertEl, 'error', msg);
          } else {
            window.alert(msg);
          }
        }
      })
      .catch(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
        var msg = 'Cannot reach the server. Please check your connection.';
        if (alertEl) { showAlert(alertEl, 'error', msg); } else { window.alert(msg); }
      });
  }

  function initUploadForms() {
    // Faculty resource upload form
    var resourceUploadForm = $('#resourceUploadForm');
    if (resourceUploadForm) {
      resourceUploadForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var alertEl = $('#resourceFormAlert');
        var submitBtn = $('#resourceSubmit');
        submitFormViaFetch(resourceUploadForm, alertEl, submitBtn, 'Resource uploaded successfully!', null);
      });
    }

    // Student resource upload form
    var studentResourceForm = $('#studentResourceUploadForm');
    if (studentResourceForm) {
      studentResourceForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var alertEl = $('#studentResourceFormAlert');
        var submitBtn = studentResourceForm.querySelector('[type="submit"]');
        submitFormViaFetch(studentResourceForm, alertEl, submitBtn, 'Resource uploaded successfully!', null);
      });
    }

    // Faculty announcement form
    var announcementForm = $('#announcementForm');
    if (announcementForm) {
      announcementForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var alertEl = $('#announcementFormAlert');
        var submitBtn = announcementForm.querySelector('[type="submit"]');
        submitFormViaFetch(announcementForm, alertEl, submitBtn, 'Announcement published successfully!', null);
      });
    }

    // Faculty assignment upload form
    var assignmentForm = $('#assignmentForm');
    if (assignmentForm) {
      assignmentForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var alertEl = $('#assignmentFormAlert');
        var submitBtn = assignmentForm.querySelector('[type="submit"]');
        submitFormViaFetch(assignmentForm, alertEl, submitBtn, 'Assignment uploaded successfully!', null);
      });
    }

    // Student assignment submission forms (multiple, one per assignment)
    $$('.assignment-submission-form').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var submitBtn = form.querySelector('[type="submit"]');
        var alertEl = form.querySelector('.submission-alert');
        // Create inline alert if not present
        if (!alertEl) {
          alertEl = document.createElement('div');
          alertEl.className = 'alert submission-alert';
          alertEl.hidden = true;
          form.insertBefore(alertEl, submitBtn);
        }
        submitFormViaFetch(form, alertEl, submitBtn, 'Assignment submitted successfully!', null);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. Authentication forms (login & register)
   * ------------------------------------------------------------------ */
  function initAuth() {
    var loginForm = $('#loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var alertBox = $('#formAlert');
        clearErrors(loginForm);

        var emailInput = $('#email');
        var passInput = $('#password');
        var roleInput = $('#expectedRole');
        var branchInput = $('#loginBranch');

        var email = (emailInput ? emailInput.value : '').trim();
        var password = (passInput ? passInput.value : '');
        var expectedRole = (roleInput ? roleInput.value : '').trim();
        var branch = (branchInput ? branchInput.value : '').trim();

        var hasError = false;
        if (!email) {
          setFieldError(emailInput, 'Email is required.');
          hasError = true;
        }
        if (!password) {
          setFieldError(passInput, 'Password is required.');
          hasError = true;
        }
        if (hasError) {
          showAlert(alertBox, 'error', 'Please enter your email and password.');
          return;
        }

        var submitBtn = $('#loginSubmit');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Logging in…'; }

        api('/api/auth/login', {
          method: 'POST',
          body: { email: email, password: password, expectedRole: expectedRole, branch: branch }
        }).then(function (result) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Login'; }
          if (!result.ok) {
            showAlert(alertBox, 'error', result.data.message || 'Login failed. Check your email and password.');
            if (result.data.code === 'EMAIL_NOT_REGISTERED') {
              setFieldError(emailInput, 'This email is not registered.');
            } else if (result.data.code === 'BRANCH_MISMATCH') {
              setFieldError(branchInput, result.data.message);
            } else if (result.status === 401) {
              setFieldError(passInput, result.data.message || 'Incorrect password.');
            }
            return;
          }
          var user = result.data.user || {};
          var target = dashboardFor(user.role) || '/index.html';
          showAlert(alertBox, 'success', 'Logged in successfully. Opening dashboard…');
          window.location.href = target;
        });
      });
    }

    var regForm = $('#registerForm');
    if (regForm) {
      regForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var alertBox = $('#formAlert');
        clearErrors(regForm);

        var nameInput = $('#fullName');
        var emailInput = $('#email');
        var passInput = $('#password');
        var confirmPassInput = $('#confirmPassword');
        var branchInput = $('#branch');
        var rollInput = $('#rollNumber');
        var roleSelected = $('input[name="role"]:checked', regForm);

        var fullName = (nameInput ? nameInput.value : '').trim();
        var email = (emailInput ? emailInput.value : '').trim();
        var password = (passInput ? passInput.value : '');
        var confirmPassword = (confirmPassInput ? confirmPassInput.value : '');
        var branch = (branchInput ? branchInput.value : '').trim();
        var rollNumber = (rollInput ? rollInput.value : '').trim();
        var role = roleSelected ? roleSelected.value : 'student';

        var hasError = false;
        if (!fullName) { setFieldError(nameInput, 'Full name is required.'); hasError = true; }
        if (!email) { setFieldError(emailInput, 'Email is required.'); hasError = true; }
        if (!password || password.length < 6) { setFieldError(passInput, 'Password must be at least 6 characters.'); hasError = true; }
        if (password !== confirmPassword) { setFieldError(confirmPassInput, 'Passwords do not match.'); hasError = true; }
        if (!branch) { setFieldError(branchInput, 'Please select your branch.'); hasError = true; }

        if (hasError) {
          showAlert(alertBox, 'error', 'Please correct the highlighted fields.');
          return;
        }

        var submitBtn = $('#registerSubmit');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Registering…'; }

        api('/api/auth/register', {
          method: 'POST',
          body: {
            fullName: fullName,
            email: email,
            password: password,
            confirmPassword: confirmPassword,
            branch: branch,
            rollNumber: rollNumber,
            role: role
          }
        }).then(function (result) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Register'; }
          if (!result.ok) {
            showAlert(alertBox, 'error', result.data.message || 'Registration failed.');
            return;
          }
          window.location.href = '/login.html?registered=1';
        });
      });
    }

    // Header session status on public pages
    var authSlot = $('[data-auth-slot="header"]');
    if (authSlot) {
      api('/api/auth/me').then(function (result) {
        if (result.ok && result.data && result.data.authenticated) {
          var user = result.data.user;
          var dash = dashboardFor(user.role);
          authSlot.innerHTML = '<a href="' + dash + '" class="btn btn-outline btn-sm">Dashboard</a> ' +
            '<a href="/logout" class="btn btn-ghost btn-sm" data-logout>Logout</a>';
        }
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 7. Initialization
   * ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initPasswordToggle();
    initPanels();
    initActionHandlers();
    initUploadForms();
    initAuth();
  });
})();
