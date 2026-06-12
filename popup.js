/**
 * popup.js — Azure DevOps integration (replaces GitHub)
 * Manages ADO settings: Org URL, Project, PAT, default field values
 */

/********************************
 * TAB SWITCHING
 ********************************/
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');

        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.getElementById(`${tabName}Tab`).classList.add('active');

        if (tabName === 'settings') {
            loadAdoSettings();
        }
    });
});

/********************************
 * ADO SETTINGS — LOAD & SAVE
 ********************************/

function loadAdoSettings() {
    // Read DIRECTLY from chrome.storage.local — never go through background.js
    // Service worker can be killed/restarted by Chrome, losing in-memory state
    // and returning empty defaults that silently wipe all the UI fields.
    chrome.storage.local.get(['adoConfig'], (data) => {
        const cfg    = data.adoConfig || {};
        const fields = cfg.defaultFields || {};

        document.getElementById('enableAdo').checked       = cfg.enabled || false;
        document.getElementById('adoOrgUrl').value         = cfg.orgUrl  || 'https://dev.azure.com/sompoit';
        document.getElementById('adoProject').value        = cfg.project || 'Endurance';
        document.getElementById('adoPat').value            = cfg.pat     || '';

        document.getElementById('fieldAreaPath').value      = fields['System.AreaPath']               || 'Endurance';
        document.getElementById('fieldIterationPath').value = fields['System.IterationPath']          || 'Endurance';
        document.getElementById('fieldTags').value          = fields['System.Tags']                   || 'bddrecorder';
        document.getElementById('fieldSegment').value       = fields['Endurance.SDLCLite.Segment']    || 'Insurance';
        document.getElementById('fieldBusinessArea').value  = fields['Custom.BusinessArea']           || 'Underwriting';
        document.getElementById('fieldBusinessUnit').value  = fields['Endurance.Common.BusinessUnit'] || 'Canada Energy';
        document.getElementById('fieldProject').value       = fields['Endurance.Common.Project']      || 'Canada Domestic';
        document.getElementById('fieldApplication').value   = fields['Endurance.SDLC.Application']    || 'Policy - GuideWire';

        document.getElementById('fieldChangeRequestId').value = cfg.changeRequestId || '';
        document.getElementById('fieldTestPlanId').value      = cfg.testPlanId  || '';
        document.getElementById('fieldTestSuiteId').value     = cfg.testSuiteId || '';

        document.getElementById('fieldSeverity').value = cfg.defaultSeverity || '3 - Medium';
        document.getElementById('fieldPriority').value = String(cfg.defaultPriority || '3');

        // Use displayed field values for status — not raw cfg which may have
        // been partially saved by the old broken background.js path.
        updateAdoStatus(
            cfg.enabled,
            cfg.orgUrl || 'https://dev.azure.com/sompoit',
            cfg.project || 'Endurance',
            cfg.pat
        );
    });
}

function updateAdoStatus(enabled, orgUrl, project, pat) {
    const statusEl = document.getElementById('adoStatus');
    const hasConnection = orgUrl && project && pat;

    if (enabled && hasConnection) {
        statusEl.className = 'ado-status connected';
        statusEl.innerText = `✅ ADO: ${project} (enabled)`;
    } else if (enabled && !hasConnection) {
        statusEl.className = 'ado-status disconnected';
        statusEl.innerText = '⚠️ ADO enabled but PAT is missing — enter it below and Save';
    } else if (!enabled && hasConnection) {
        statusEl.className = 'ado-status disconnected';
        statusEl.innerText = '⚪ ADO configured but disabled — tick "Enable" and Save to activate';
    } else {
        statusEl.className = 'ado-status disconnected';
        statusEl.innerText = '⚪ Azure DevOps: Not configured — fill in details below';
    }
}

// Save ADO Configuration
document.getElementById('saveAdoConfig').addEventListener('click', () => {
    const enabled   = document.getElementById('enableAdo').checked;
    const orgUrl    = document.getElementById('adoOrgUrl').value.trim().replace(/\/$/, '');
    const project   = document.getElementById('adoProject').value.trim();
    const pat       = document.getElementById('adoPat').value.trim();
    const severity  = document.getElementById('fieldSeverity').value;
    const priority  = document.getElementById('fieldPriority').value;

    if (enabled) {
        if (!orgUrl || !project || !pat) {
            showMessage('Please fill in Org URL, Project, and PAT to enable ADO export', 'error');
            return;
        }
        if (!orgUrl.startsWith('https://dev.azure.com/')) {
            showMessage('Org URL must start with https://dev.azure.com/', 'warning');
            return;
        }
    }

    // Warn if ADO enabled but Change Request ID is blank
    const changeRequestId = document.getElementById('fieldChangeRequestId').value.trim() || null;
    if (enabled && !changeRequestId) {
        showMessage('⚠️ Warning: Change Request ID is blank. Your ADO project requires it — work item creation will fail.', 'warning');
    }

    const config = {
        enabled,
        orgUrl,
        project,
        pat,
        changeRequestId: changeRequestId,
        testPlanId:  parseInt(document.getElementById('fieldTestPlanId').value.trim(), 10)  || null,
        testSuiteId: parseInt(document.getElementById('fieldTestSuiteId').value.trim(), 10) || null,
        defaultSeverity: severity,
        defaultPriority: parseInt(priority, 10),
        defaultFields: {
            "System.AreaPath":                document.getElementById('fieldAreaPath').value.trim()      || 'Endurance',
            "System.TeamProject":             project,
            "System.IterationPath":           document.getElementById('fieldIterationPath').value.trim() || 'Endurance',
            "System.Tags":                    document.getElementById('fieldTags').value.trim()          || 'bddrecorder',
            "Endurance.SDLCLite.Segment":     document.getElementById('fieldSegment').value.trim(),
            "Custom.BusinessArea":            document.getElementById('fieldBusinessArea').value.trim(),
            "Endurance.Common.Project":       document.getElementById('fieldProject').value.trim(),
            "Endurance.Common.BusinessUnit":  document.getElementById('fieldBusinessUnit').value.trim(),
            "Endurance.SDLC.Application":     document.getElementById('fieldApplication').value.trim()
        }
    };

    // Write DIRECTLY to chrome.storage.local — don't go through background.js
    // Also notify background.js so its in-memory adoConfig stays in sync,
    // but storage write succeeds regardless of whether the service worker is alive.
    chrome.storage.local.set({ adoConfig: config }, () => {
        if (chrome.runtime.lastError) {
            showMessage('Failed to save ADO settings: ' + chrome.runtime.lastError.message, 'error');
            return;
        }
        showMessage('✅ ADO settings saved successfully!', 'success');
        updateAdoStatus(enabled, orgUrl, project, pat);
        // Best-effort sync to background in-memory state (fire and forget)
        chrome.runtime.sendMessage({ action: "saveAdoConfig", config }, () => {
            void chrome.runtime.lastError; // suppress "no listener" errors
        });
    });
});

// Test ADO Connection
document.getElementById('testAdoConnection').addEventListener('click', () => {
    const orgUrl  = document.getElementById('adoOrgUrl').value.trim().replace(/\/$/, '');
    const project = document.getElementById('adoProject').value.trim();
    const pat     = document.getElementById('adoPat').value.trim();

    if (!orgUrl || !project || !pat) {
        showMessage('Please fill in Org URL, Project, and PAT before testing', 'warning');
        return;
    }

    const btn = document.getElementById('testAdoConnection');
    btn.disabled = true;
    btn.innerText = '🔄 Testing...';

    chrome.runtime.sendMessage(
        { action: "testAdoConnection", orgUrl, project, pat },
        (result) => {
            btn.disabled = false;
            btn.innerText = '🔌 Test Connection';

            if (result && result.success) {
                showMessage(`✅ Connected to ADO project: ${result.projectName}`, 'success');
                document.getElementById('adoStatus').className = 'ado-status connected';
                document.getElementById('adoStatus').innerText = `✅ ADO: ${result.projectName}`;
            } else {
                const err = (result && result.error) ? result.error : 'Unknown error';
                showMessage(`❌ Connection failed: ${err}`, 'error');
            }
        }
    );
});

/********************************
 * UI UPDATE
 ********************************/
function updateUI() {
    chrome.storage.local.get(['isRecording', 'isPaused', 'testName', 'steps'], (data) => {
        const statusEl   = document.getElementById('status');
        const stepCountEl = document.getElementById('stepCount');

        if (data.isRecording) {
            const stepCount = (data.steps || []).length;

            if (data.isPaused) {
                statusEl.innerText = "⏸ PAUSED";
                statusEl.style.backgroundColor = "#fff3cd";
                statusEl.style.color = "#856404";
            } else {
                statusEl.innerText = `🔴 RECORDING: ${data.testName || "Active"}`;
                statusEl.style.backgroundColor = "#f8d7da";
                statusEl.style.color = "#721c24";
            }

            if (stepCountEl) {
                stepCountEl.innerText = `Steps captured: ${stepCount}`;
                stepCountEl.style.display = 'block';
            }

            const widgetBtn = document.getElementById('showWidgetBtn');
            if (widgetBtn) widgetBtn.style.display = 'block';

        } else {
            statusEl.innerText = "⚪ Ready to Record";
            statusEl.style.backgroundColor = "#d4edda";
            statusEl.style.color = "#155724";

            if (stepCountEl) stepCountEl.style.display = 'none';

            const widgetBtn = document.getElementById('showWidgetBtn');
            if (widgetBtn) widgetBtn.style.display = 'none';
        }
    });
}

/********************************
 * VALIDATION HELPERS
 ********************************/
function validateTestName(name) {
    if (!name || name.trim() === "")   return { valid: false, message: "Test name cannot be empty" };
    if (name.length < 3)               return { valid: false, message: "Test name must be at least 3 characters" };
    if (name.length > 100)             return { valid: false, message: "Test name must be less than 100 characters" };
    if (/[<>:"/\\|?*]/.test(name))     return { valid: false, message: "Test name contains invalid characters" };
    return { valid: true, message: "" };
}

function validateBugDetails(details) {
    const errors = [];
    if (!details.title    || details.title.trim()    === "") errors.push("Bug title is required");
    if (!details.expected || details.expected.trim() === "") errors.push("Expected result is required");
    if (!details.actual   || details.actual.trim()   === "") errors.push("Actual result is required");
    return { valid: errors.length === 0, errors };
}

/********************************
 * UI FEEDBACK
 ********************************/
function showMessage(message, type = 'info') {
    const messageDiv = document.getElementById('message');
    if (!messageDiv) return;

    messageDiv.innerText = message;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';

    setTimeout(() => { messageDiv.style.display = 'none'; }, 4000);
}

/********************************
 * EVENT HANDLERS — RECORDER
 ********************************/

// Start Recording
document.getElementById('startBtn').addEventListener('click', () => {
    chrome.storage.local.get(['isRecording'], (data) => {
        if (data.isRecording) {
            showMessage("Already recording! Stop current session first.", 'warning');
            return;
        }

        const name = prompt("Enter Test Case Name:\n(Example: User_Login_Flow, Checkout_Process)");
        if (name === null) return;

        const validation = validateTestName(name);
        if (!validation.valid) { alert(validation.message); return; }

        const cleanName = name.trim().replace(/\s+/g, '_');

        chrome.runtime.sendMessage({ action: "start", testName: cleanName }, () => {
            showMessage(`Recording started: ${cleanName}`, 'success');
            updateUI();
        });
    });
});

// Pause/Resume Recording
document.getElementById('pauseBtn').addEventListener('click', () => {
    chrome.storage.local.get(['isRecording', 'isPaused'], (data) => {
        if (!data.isRecording) { showMessage("Not recording. Start recording first.", 'warning'); return; }

        chrome.runtime.sendMessage({ action: "pause" }, () => {
            showMessage(!data.isPaused ? "Recording paused" : "Recording resumed", 'info');
            updateUI();
        });
    });
});

// Toggle Bug Form
document.getElementById('bugBtn').addEventListener('click', () => {
    chrome.storage.local.get(['isRecording'], (data) => {
        if (!data.isRecording) { showMessage("Start recording before raising a bug", 'warning'); return; }

        const form = document.getElementById('bugForm');
        const isVisible = form.style.display === 'block';
        form.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) document.getElementById('bugTitle').focus();
    });
});

// Save Bug & Export
document.getElementById('saveBug').addEventListener('click', () => {
    const details = {
        title:    document.getElementById('bugTitle').value.trim(),
        expected: document.getElementById('expResult').value.trim(),
        actual:   document.getElementById('actResult').value.trim()
    };

    const validation = validateBugDetails(details);
    if (!validation.valid) {
        alert("Please fill in all bug details:\n\n" + validation.errors.join("\n"));
        return;
    }

    // Check if ADO is enabled so we can mention it in the confirm dialog
    chrome.storage.local.get(['adoConfig'], (cfgData) => {
        const adoEnabled = cfgData.adoConfig && cfgData.adoConfig.enabled;
        const adoMsg = adoEnabled ? "\n\nA Defect work item will also be created in Azure DevOps." : "";

        if (confirm(`This will stop recording and export all files with bug details.${adoMsg}\n\nContinue?`)) {
            chrome.runtime.sendMessage({ action: "stop", bugDetails: details }, () => {
                showMessage("Exporting with bug details" + (adoEnabled ? " + creating ADO Defect..." : "..."), 'success');
                updateUI();

                document.getElementById('bugTitle').value   = '';
                document.getElementById('expResult').value  = '';
                document.getElementById('actResult').value  = '';
                document.getElementById('bugForm').style.display = 'none';

                // Show push panel so user can push/retry regardless of ADO enabled state
                setTimeout(() => showAdoPushPanel('defect'), 1500);
            });
        }
    });
});

// Stop & Export All
document.getElementById('stopBtn').addEventListener('click', () => {
    chrome.storage.local.get(['isRecording', 'steps', 'adoConfig'], (data) => {
        if (!data.isRecording) { showMessage("Not recording. Nothing to export.", 'warning'); return; }

        const stepCount  = (data.steps || []).length;
        const adoEnabled = data.adoConfig && data.adoConfig.enabled;

        if (stepCount === 0) {
            if (!confirm("No steps recorded yet. Export anyway?")) return;
        }

        const adoMsg = adoEnabled
            ? "\n\nADO is enabled — a Test Case will be auto-pushed after export."
            : "\n\nADO is disabled — you can manually push after export.";

        if (confirm(`Stop recording and export ${stepCount} step(s)?${adoMsg}`)) {
            chrome.runtime.sendMessage({ action: "stop" }, () => {
                showMessage("Exporting files" + (adoEnabled ? " + pushing ADO Test Case..." : "..."), 'success');
                updateUI();
                // Show push panel after a short delay (let background.js finish export)
                setTimeout(() => showAdoPushPanel('testcase'), 1500);
            });
        }
    });
});

// Show Step Widget
const showWidgetBtn = document.getElementById('showWidgetBtn');
if (showWidgetBtn) {
    showWidgetBtn.addEventListener('click', () => {
        chrome.storage.local.get(['isRecording'], (data) => {
            if (!data.isRecording) { showMessage("Start recording first before showing the widget.", 'warning'); return; }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "showWidget" }, () => {
                        if (chrome.runtime.lastError) {
                            showMessage("Could not reach the page. Try refreshing it.", 'error');
                            return;
                        }
                        showMessage("Step widget shown on the page!", 'success');
                    });
                }
            });
        });
    });
}

// Preview Steps
const previewBtn = document.getElementById('previewBtn');
if (previewBtn) {
    previewBtn.addEventListener('click', () => {
        chrome.storage.local.get(['steps', 'testName'], (data) => {
            const steps    = data.steps    || [];
            const testName = data.testName || 'Unknown';

            if (steps.length === 0) { alert("No steps recorded yet!"); return; }

            let preview = `Test Case: ${testName}\nTotal Steps: ${steps.length}\n${"=".repeat(50)}\n\n`;
            steps.forEach((step, i) => {
                preview += `${i + 1}. ${step.description}\n   Time: ${step.timestamp}\n\n`;
            });

            const previewWindow = window.open('', 'Step Preview', 'width=600,height=400');
            previewWindow.document.write(`
                <html>
                <head>
                    <title>Step Preview - ${testName}</title>
                    <style>
                        body { font-family: monospace; padding: 20px; background: #f5f5f5; }
                        pre  { background: white; padding: 15px; border-radius: 5px; border: 1px solid #ddd; }
                    </style>
                </head>
                <body>
                    <h2>Step Preview</h2>
                    <pre>${preview}</pre>
                    <button onclick="window.close()">Close</button>
                </body>
                </html>
            `);
        });
    });
}

/********************************
 * ADO PUSH PANEL
 * Shown after Stop or Raise Bug — lets user push manually or see auto-push result
 ********************************/
function showAdoPushPanel(pushType) {
    const panel = document.getElementById('adoPushPanel');
    const statusEl = document.getElementById('adoPushStatus');
    if (!panel) return;

    // First check if there's already a result (auto-push may have already fired)
    chrome.storage.local.get(['lastAdoResult', 'adoConfig'], (data) => {
        const adoEnabled = data.adoConfig && data.adoConfig.enabled;
        const adoCfg = data.adoConfig || {};
        const isConfigured = adoCfg.orgUrl && adoCfg.project && adoCfg.pat;

        if (data.lastAdoResult) {
            // Auto-push already ran — show result directly, skip push panel
            panel.style.display = 'none';
            showAdoResultPanel(data.lastAdoResult);
            return;
        }

        // No result yet — show push panel
        panel.style.display = 'block';
        panel.dataset.pushType = pushType;

        if (!isConfigured) {
            statusEl.innerHTML = `<span style="color:#c53030">⚠️ ADO not configured. Go to ADO Settings tab first.</span>`;
            document.getElementById('pushToAdoBtn').disabled = true;
        } else if (!adoEnabled) {
            statusEl.innerHTML = `<span style="color:#744210">ADO is disabled in settings — you can still push manually now.</span>`;
            document.getElementById('pushToAdoBtn').disabled = false;
        } else {
            statusEl.innerHTML = `<span style="color:#276749">ADO enabled — push is running in background...</span>`;
            document.getElementById('pushToAdoBtn').disabled = false;
            // Poll for result since auto-push is running
            pollForAdoResult(8000);
        }
    });
}

function pollForAdoResult(timeout) {
    let elapsed = 0;
    const interval = setInterval(() => {
        elapsed += 1000;
        chrome.storage.local.get(['lastAdoResult'], (data) => {
            if (data.lastAdoResult) {
                clearInterval(interval);
                document.getElementById('adoPushPanel').style.display = 'none';
                showAdoResultPanel(data.lastAdoResult);
            } else if (elapsed >= timeout) {
                clearInterval(interval);
                document.getElementById('adoPushStatus').innerHTML =
                    `<span style="color:#744210">⏱ Auto-push timed out. Click Push to try manually.</span>`;
                document.getElementById('pushToAdoBtn').disabled = false;
            }
        });
    }, 1000);
}

// Manual push button
document.getElementById('pushToAdoBtn').addEventListener('click', () => {
    const btn = document.getElementById('pushToAdoBtn');
    const statusEl = document.getElementById('adoPushStatus');
    const pushType = document.getElementById('adoPushPanel').dataset.pushType || 'testcase';

    btn.disabled = true;
    btn.textContent = '⏳ Pushing...';
    statusEl.innerHTML = `<span style="color:#2c5282">Pushing to ADO, please wait...</span>`;

    chrome.runtime.sendMessage({ action: "retryAdoPush" }, (resp) => {
        if (resp && resp.queued) {
            statusEl.innerHTML = `<span style="color:#276749">Push triggered — waiting for result...</span>`;
            pollForAdoResult(10000);
        } else {
            statusEl.innerHTML = `<span style="color:#c53030">❌ Push failed to start. Check ADO Settings.</span>`;
            btn.disabled = false;
            btn.textContent = '🚀 Push to ADO';
        }
    });
});

document.getElementById('adoPushDismissBtn').addEventListener('click', () => {
    document.getElementById('adoPushPanel').style.display = 'none';
});

/********************************
 * ADO RESULT PANEL
 * Shows success (with link) or error (with retry + fix settings)
 ********************************/
function showAdoResultPanel(r) {
    const panel = document.getElementById('adoResultPanel');
    const content = document.getElementById('adoResultContent');
    const retryBtn = document.getElementById('adoRetryBtn');
    const fixBtn = document.getElementById('adoFixSettingsBtn');
    const dismissBtn = document.getElementById('adoResultDismissBtn');
    if (!panel) return;

    panel.style.display = 'block';

    if (r.success) {
        panel.style.background = '#c6f6d5';
        panel.style.borderColor = '#9ae6b4';
        panel.style.color = '#22543d';
        dismissBtn.style.borderColor = '#9ae6b4';
        dismissBtn.style.color = '#22543d';
        content.innerHTML = `
            <strong>✅ ADO ${r.type || 'Work Item'} Created</strong><br>
            <span>${r.title || ''}</span><br>
            <a href="${r.url}" target="_blank" style="color:#276749;font-weight:700">
                🔗 Open #${r.id} in Azure DevOps
            </a>
            <span style="float:right;font-size:11px;opacity:0.7">${r.timestamp || ''}</span>
        `;
        retryBtn.style.display = 'none';
        fixBtn.style.display = 'none';
        // Auto-clear success after 30s
        setTimeout(() => {
            chrome.storage.local.remove(['lastAdoResult']);
            panel.style.display = 'none';
        }, 30000);
    } else {
        panel.style.background = '#fed7d7';
        panel.style.borderColor = '#fc8181';
        panel.style.color = '#742a2a';
        dismissBtn.style.borderColor = '#fc8181';
        dismissBtn.style.color = '#742a2a';
        content.innerHTML = `
            <strong>❌ ADO ${r.type || 'Push'} Failed</strong><br>
            <span style="word-break:break-word;font-size:12px">${r.error || 'Unknown error'}</span><br>
            <span style="font-size:11px;opacity:0.7">${r.timestamp || ''}</span>
        `;
        retryBtn.style.display = r.canRetry ? 'block' : 'none';
        fixBtn.style.display = 'block';
    }
}

// Retry button
document.getElementById('adoRetryBtn').addEventListener('click', () => {
    const btn = document.getElementById('adoRetryBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Retrying...';
    chrome.storage.local.remove(['lastAdoResult']);
    chrome.runtime.sendMessage({ action: "retryAdoPush" }, (resp) => {
        if (resp && resp.queued) {
            document.getElementById('adoResultContent').innerHTML =
                `<span style="color:#2c5282">⏳ Retry triggered — waiting for result...</span>`;
            pollForAdoResult(10000);
        } else {
            btn.disabled = false;
            btn.textContent = '🔄 Retry ADO Push';
            document.getElementById('adoResultContent').innerHTML +=
                `<br><span style="color:#c53030;font-size:12px">Retry failed to start. Check settings.</span>`;
        }
    });
});

// Fix Settings button — jumps to ADO Settings tab
document.getElementById('adoFixSettingsBtn').addEventListener('click', () => {
    document.getElementById('adoResultPanel').style.display = 'none';
    // Switch to settings tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab[data-tab="settings"]').classList.add('active');
    document.getElementById('settingsTab').classList.add('active');
    loadAdoSettings();
    showMessage('Fix your ADO settings below, then use Retry ADO Push.', 'warning');
});

// Dismiss result panel
document.getElementById('adoResultDismissBtn').addEventListener('click', () => {
    chrome.storage.local.remove(['lastAdoResult']);
    document.getElementById('adoResultPanel').style.display = 'none';
});

function checkLastAdoResult() {
    chrome.storage.local.get(['lastAdoResult'], (data) => {
        if (!data.lastAdoResult) return;
        // Only show result panel if push panel is hidden (avoid double-display)
        const pushPanel = document.getElementById('adoPushPanel');
        if (pushPanel && pushPanel.style.display === 'block') return;
        const resultPanel = document.getElementById('adoResultPanel');
        if (resultPanel && resultPanel.style.display !== 'block') {
            showAdoResultPanel(data.lastAdoResult);
        }
    });
}

/********************************
 * INITIALIZATION
 ********************************/
updateUI();
loadAdoSettings();
checkLastAdoResult();
setInterval(updateUI, 2000);
setInterval(checkLastAdoResult, 5000);
