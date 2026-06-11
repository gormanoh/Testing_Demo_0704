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
    chrome.runtime.sendMessage({ action: "getAdoConfig" }, (response) => {
        if (response && response.config) {
            const cfg = response.config;
            const fields = cfg.defaultFields || {};

            document.getElementById('enableAdo').checked       = cfg.enabled || false;
            document.getElementById('adoOrgUrl').value         = cfg.orgUrl  || 'https://dev.azure.com/sompoit';
            document.getElementById('adoProject').value        = cfg.project || 'Endurance';
            document.getElementById('adoPat').value            = cfg.pat     || '';

            // Default fields
            document.getElementById('fieldAreaPath').value      = fields['System.AreaPath']                   || 'Endurance';
            document.getElementById('fieldIterationPath').value = fields['System.IterationPath']              || 'Endurance';
            document.getElementById('fieldTags').value          = fields['System.Tags']                       || 'bddrecorder';
            document.getElementById('fieldSegment').value       = fields['Endurance.SDLCLite.Segment']        || 'Insurance';
            document.getElementById('fieldBusinessArea').value  = fields['Custom.BusinessArea']               || 'Underwriting';
            document.getElementById('fieldBusinessUnit').value  = fields['Endurance.Common.BusinessUnit']     || 'Canada Energy';
            document.getElementById('fieldProject').value       = fields['Endurance.Common.Project']          || 'Canada Domestic';
            document.getElementById('fieldApplication').value   = fields['Endurance.SDLC.Application']        || 'Policy - GuideWire';

            // User Story (required by Endurance process template)
            document.getElementById('fieldUserStoryId').value    = cfg.userStoryId    || '';
            document.getElementById('fieldUserStoryTitle').value = cfg.userStoryTitle || '';

            // Test Plan / Suite IDs
            document.getElementById('fieldTestPlanId').value  = cfg.testPlanId  || '';
            document.getElementById('fieldTestSuiteId').value = cfg.testSuiteId || '';

            // Severity / Priority selects
            const sev = cfg.defaultSeverity || '3 - Medium';
            const pri = cfg.defaultPriority || '3';
            document.getElementById('fieldSeverity').value = sev;
            document.getElementById('fieldPriority').value = String(pri);

            updateAdoStatus(cfg.enabled, cfg.orgUrl, cfg.project);
        }
    });
}

function updateAdoStatus(enabled, orgUrl, project) {
    const statusEl = document.getElementById('adoStatus');
    if (enabled && orgUrl && project) {
        statusEl.className = 'ado-status connected';
        statusEl.innerText = `✅ ADO: ${project} (enabled)`;
    } else if (!enabled) {
        statusEl.className = 'ado-status disconnected';
        statusEl.innerText = '⚪ Azure DevOps: Disabled';
    } else {
        statusEl.className = 'ado-status disconnected';
        statusEl.innerText = '❌ Azure DevOps: Not fully configured';
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

    // Warn if ADO enabled but User Story ID is blank
    const userStoryId = parseInt(document.getElementById('fieldUserStoryId').value.trim(), 10) || null;
    if (enabled && !userStoryId) {
        showMessage('⚠️ Warning: User Story ID is blank. Your ADO project requires it — Test Case creation will fail.', 'warning');
    }

    const config = {
        enabled,
        orgUrl,
        project,
        pat,
        userStoryId:    userStoryId,
        userStoryTitle: document.getElementById('fieldUserStoryTitle').value.trim() || '',
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

    chrome.runtime.sendMessage({ action: "saveAdoConfig", config }, (response) => {
        if (response && response.success) {
            showMessage('✅ ADO settings saved successfully!', 'success');
            updateAdoStatus(enabled, orgUrl, project);
        } else {
            showMessage('Failed to save ADO settings', 'error');
        }
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

                setTimeout(() => window.close(), 2500);
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

        const adoMsg = adoEnabled ? "\n\nA Test Case will also be created in Azure DevOps." : "";

        if (confirm(`Stop recording and export ${stepCount} step(s)?${adoMsg}`)) {
            chrome.runtime.sendMessage({ action: "stop" }, () => {
                showMessage("Exporting files" + (adoEnabled ? " + creating ADO Test Case..." : "..."), 'success');
                updateUI();
                setTimeout(() => window.close(), 2500);
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
 * INITIALIZATION
 ********************************/
updateUI();
loadAdoSettings();
setInterval(updateUI, 2000);
