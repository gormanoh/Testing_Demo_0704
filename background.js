/**
 * ENHANCED background.js - Advanced AI Processing, Bug Report Generation & Azure DevOps Export
 * ADO Integration: Creates Test Cases and Defects in Azure DevOps via REST API using PAT token
 *   Endpoint: POST https://dev.azure.com/{org}/{project}/_apis/wit/workitems/${type}
 *   Auth:     Basic base64(":PAT")
 *   API Ver:  api-version=7.1
 */

/********************************
 * CLIENT AI GATEWAY CONFIG
 ********************************/
const CLIENT_AI_BASE_URL = "http://tazus1opai1qa1:9080/openAIParser";
const CLIENT_AI_ENDPOINT = `${CLIENT_AI_BASE_URL}/api/GPT4/completion/promptWithString`;
const CLIENT_AI_TEMPERATURE = 0.3;

/********************************
 * ADO CONFIG
 * Loaded from storage; defaults match screenshots
 ********************************/
let adoConfig = {
    enabled: false,
    orgUrl: "https://dev.azure.com/sompoit",
    project: "Endurance",
    pat: "",
    // Default field values used when creating work items
    defaultFields: {
        "System.AreaPath": "Endurance",
        "System.TeamProject": "Endurance",
        "System.Tags": "bddrecorder",
        "System.IterationPath": "Endurance",
        "Endurance.SDLCLite.Segment": "Insurance",
        "Custom.BusinessArea": "Underwriting",
        "Endurance.Common.Project": "Canada Domestic",
        "Endurance.Common.BusinessUnit": "Canada Energy",
        "Endurance.SDLC.Application": "Policy - GuideWire"
    }
};

// Load ADO config on startup
chrome.storage.local.get(['adoConfig'], (data) => {
    if (data.adoConfig) {
        adoConfig = { ...adoConfig, ...data.adoConfig };
        // Merge nested defaultFields too
        if (data.adoConfig.defaultFields) {
            adoConfig.defaultFields = { ...adoConfig.defaultFields, ...data.adoConfig.defaultFields };
        }
    }
});

/********************************
 * TAB MESSAGING HELPER
 ********************************/
function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, message, () => {
                if (chrome.runtime.lastError) {
                    console.log("Tab message skipped:", chrome.runtime.lastError.message);
                }
            });
        }
    });
}

/********************************
 * MESSAGE LISTENER
 ********************************/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    chrome.storage.local.get(
        ['isRecording', 'isPaused', 'steps', 'testName'],
        (state) => {

            if (message.action === "start") {
                chrome.storage.local.set({
                    isRecording: true,
                    isPaused: false,
                    steps: [],
                    testName: message.testName || "QA_Test_Case"
                }, () => {
                    sendMessageToActiveTab({ action: "showWidget" });
                });
            }

            else if (message.action === "pause") {
                const newPauseState = !state.isPaused;
                chrome.storage.local.set({ isPaused: newPauseState }, () => {
                    sendMessageToActiveTab({ 
                        action: newPauseState ? "hideWidget" : "showWidget" 
                    });
                });
            }

            else if (message.action === "stop") {
                chrome.storage.local.set({ isRecording: false }, () => {
                    sendMessageToActiveTab({ action: "hideWidget" });
                    generateAllReports(state, message.bugDetails || null);
                });
            }

            else if (message.action === "saveAdoConfig") {
                adoConfig = message.config;
                chrome.storage.local.set({ adoConfig: message.config }, () => {
                    sendResponse({ success: true });
                });
                return true;
            }

            else if (message.action === "getAdoConfig") {
                sendResponse({ config: adoConfig });
                return true;
            }

            else if (message.action === "testAdoConnection") {
                testADOConnection(message.orgUrl, message.project, message.pat)
                    .then(result => sendResponse(result))
                    .catch(err => sendResponse({ success: false, error: err.message }));
                return true; // async
            }

            else if (
                message.action === "recordStep" &&
                state.isRecording &&
                !state.isPaused
            ) {
                chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
                    if (chrome.runtime.lastError) {
                        console.error("Screenshot failed:", chrome.runtime.lastError);
                        const updatedSteps = [...(state.steps || []), message.step];
                        chrome.storage.local.set({ steps: updatedSteps });
                    } else {
                        const updatedSteps = [
                            ...(state.steps || []),
                            { ...message.step, screenshot: dataUrl }
                        ];
                        chrome.storage.local.set({ steps: updatedSteps });
                    }
                });
            }

            sendResponse({ status: "ok" });
        }
    );

    return true;
});

/********************************
 * ADO REST API HELPERS
 ********************************/

/**
 * Build Basic auth header from PAT token
 * ADO accepts Basic base64(":PAT")
 */
function buildAdoAuthHeader(pat) {
    const encoded = btoa(`:${pat}`);
    return `Basic ${encoded}`;
}

/**
 * Test ADO connection by fetching project info
 */
async function testADOConnection(orgUrl, project, pat) {
    try {
        const url = `${orgUrl}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`;
        const response = await fetch(url, {
            headers: {
                'Authorization': buildAdoAuthHeader(pat),
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const data = await response.json();
            return { success: true, projectName: data.name, message: `Connected to project: ${data.name}` };
        } else if (response.status === 401) {
            return { success: false, error: "Invalid PAT token or insufficient permissions" };
        } else if (response.status === 404) {
            return { success: false, error: "Project not found. Check Org URL and Project name." };
        } else {
            const text = await response.text();
            return { success: false, error: `HTTP ${response.status}: ${text.substring(0, 100)}` };
        }
    } catch (e) {
        return { success: false, error: `Network error: ${e.message}` };
    }
}

/**
 * Create a Work Item in ADO (Test Case or Defect)
 * Uses PATCH with JSON Patch document format as required by ADO REST API
 *
 * @param {string} workItemType  - "$Test Case" or "$Defect"
 * @param {string} title         - Work item title
 * @param {Array}  extraPatches  - Additional JSON Patch operations [{op,path,value}]
 */
async function createADOWorkItem(workItemType, title, extraPatches = []) {
    if (!adoConfig.enabled || !adoConfig.pat || !adoConfig.orgUrl || !adoConfig.project) {
        console.log("ADO export disabled or not configured");
        return { success: false, error: "ADO not configured" };
    }

    try {
        const org = adoConfig.orgUrl.replace(/\/$/, ''); // strip trailing slash
        const proj = encodeURIComponent(adoConfig.project);
        // ADO requires "$Test Case" — $ must be literal, only the name is encoded
        const type = '$' + encodeURIComponent(workItemType.replace(/^\$/, ''));
        const url = `${org}/${proj}/_apis/wit/workitems/${type}?api-version=7.1`;

        // Build the JSON Patch document
        // Start with the title
        const patchDoc = [
            { op: "add", path: "/fields/System.Title", value: title }
        ];

        // Add all default fields from config
        const fields = adoConfig.defaultFields || {};
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
            if (fieldValue && fieldValue.trim() !== "") {
                patchDoc.push({ op: "add", path: `/fields/${fieldName}`, value: fieldValue });
            }
        }

        // Add User Story field if configured (Endurance project requires it)
        if (adoConfig.userStoryId) {
            patchDoc.push({
                op: "add",
                path: "/fields/Microsoft.VSTS.Common.UserStory",
                value: String(adoConfig.userStoryId)
            });
        }
        if (adoConfig.userStoryTitle) {
            patchDoc.push({
                op: "add",
                path: "/fields/Custom.UserStoryTitle",
                value: String(adoConfig.userStoryTitle)
            });
        }

        // Add any extra patches (description, repro steps, etc.)
        for (const patch of extraPatches) {
            patchDoc.push(patch);
        }

        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': buildAdoAuthHeader(adoConfig.pat),
                'Content-Type': 'application/json-patch+json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(patchDoc)
        });

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                // ADO wraps rule violations inside innerException or typeKey
                const inner = errorData.innerException;
                const detail = inner
                    ? (inner.message || JSON.stringify(inner))
                    : (errorData.message || JSON.stringify(errorData));
                errorMsg = detail.length > 300 ? detail.substring(0, 300) + '…' : detail;
            } catch (_) { /* keep default */ }
            console.error("[ADO] Work Item creation failed:", errorMsg);
            return { success: false, error: errorMsg };
        }

        const data = await response.json();
        return {
            success: true,
            id: data.id,
            url: data._links?.html?.href || `${org}/${adoConfig.project}/_workitems/edit/${data.id}`,
            message: `Work item #${data.id} created in ADO`
        };

    } catch (error) {
        console.error("ADO API error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Parse AI-generated CSV into an array of step objects.
 * Expected CSV format (with header row):
 *   Step number,Steps performed,Expected result
 *   1,"User clicked Login button","Login page should open"
 *   ...
 *
 * Returns: [{ stepNumber, action, expectedResult }, ...]
 */
function parseAiCsvToSteps(csvContent) {
    if (!csvContent) return [];

    const lines = csvContent.split('\n').map(l => l.trim()).filter(Boolean);
    // Skip header row (first line starts with "Step number" or "step")
    const dataLines = lines.filter(l => !/^step\s*(number)?[,\s]/i.test(l));

    const parsed = [];
    for (const line of dataLines) {
        // Simple CSV split that handles quoted fields
        const cols = splitCsvLine(line);
        if (cols.length >= 3) {
            parsed.push({
                stepNumber:     cols[0].trim(),
                action:         cols[1].trim(),
                expectedResult: cols[2].trim()
            });
        } else if (cols.length === 2) {
            parsed.push({
                stepNumber:     cols[0].trim(),
                action:         cols[1].trim(),
                expectedResult: ''
            });
        }
    }
    return parsed;
}

/**
 * Split a single CSV line respecting double-quoted fields.
 */
function splitCsvLine(line) {
    const result = [];
    let current  = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote inside quoted field
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

/**
 * Build ADO XML steps from AI CSV parsed rows.
 * Each row becomes a ValidateStep with:
 *   - parameterizedString[0] = action (Steps performed)
 *   - parameterizedString[1] = expected result
 *
 * ADO stores test steps as XML in Microsoft.VSTS.TCM.Steps field.
 */
function buildADOTestStepsFromAiRows(aiRows) {
    if (!aiRows || aiRows.length === 0) return '<steps id="0" last="0"></steps>';

    let xml = `<steps id="0" last="${aiRows.length}">`;
    aiRows.forEach((row, i) => {
        xml += `<step id="${i + 1}" type="ValidateStep">`;
        xml += `<parameterizedString isformatted="true">${escapeHtml(row.action)}</parameterizedString>`;
        xml += `<parameterizedString isformatted="true">${escapeHtml(row.expectedResult || 'Verify the step completes successfully')}</parameterizedString>`;
        xml += `</step>`;
    });
    xml += '</steps>';
    return xml;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
    return (str || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Create a Test Case work item in ADO using AI-generated CSV as the source of steps.
 * The AI CSV (Step number, Steps performed, Expected result) is parsed and each row
 * becomes one ADO test step with the correct action + expected result.
 */
async function createADOTestCase(testCaseName, steps, aiCsvContent) {
    const title = testCaseName.replace(/_/g, ' ');

    // ---- Parse AI CSV into structured step rows ----
    const aiRows = parseAiCsvToSteps(aiCsvContent);

    // Fall back to raw steps if AI CSV parsing returned nothing
    const useAiRows = aiRows.length > 0;
    const stepCount = useAiRows ? aiRows.length : steps.length;

    // ---- Build HTML description table from AI CSV rows ----
    let descHtml = `<div><strong>Test Case: ${escapeHtml(title)}</strong></div>`;
    descHtml += `<div>Generated by QA Recorder Pro: ${new Date().toLocaleString()}</div>`;
    descHtml += `<div>Total Steps: ${stepCount}</div><br/>`;
    descHtml += `<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:13px">
        <tr style="background:#0078d4;color:white">
            <th>#</th><th>Steps Performed</th><th>Expected Result</th>
        </tr>`;

    if (useAiRows) {
        aiRows.forEach(row => {
            descHtml += `<tr>
                <td style="text-align:center">${escapeHtml(row.stepNumber)}</td>
                <td>${escapeHtml(row.action)}</td>
                <td>${escapeHtml(row.expectedResult)}</td>
            </tr>`;
        });
    } else {
        // Fallback: raw steps
        steps.forEach((s, i) => {
            descHtml += `<tr>
                <td style="text-align:center">${i + 1}</td>
                <td>${escapeHtml(s.description || '')}</td>
                <td>Verify the step completes successfully</td>
            </tr>`;
        });
    }
    descHtml += '</table>';

    // ---- Build ADO XML steps ----
    let testStepsXml;
    if (useAiRows) {
        // PRIMARY: use AI CSV rows — correct action + expected result per step
        testStepsXml = buildADOTestStepsFromAiRows(aiRows);
    } else {
        // FALLBACK: build from raw steps with generic expected result
        testStepsXml = `<steps id="0" last="${steps.length}">`;
        steps.forEach((s, i) => {
            testStepsXml += `<step id="${i + 1}" type="ValidateStep">`;
            testStepsXml += `<parameterizedString isformatted="true">${escapeHtml(s.description || '')}</parameterizedString>`;
            testStepsXml += `<parameterizedString isformatted="true">Verify the step completes successfully</parameterizedString>`;
            testStepsXml += `</step>`;
        });
        testStepsXml += '</steps>';
    }

    const extraPatches = [
        { op: "add", path: "/fields/System.Description",                value: descHtml      },
        { op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps",          value: testStepsXml  },
        { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority",    value: 3             },
        { op: "add", path: "/fields/Microsoft.VSTS.TCM.AutomationStatus", value: "Not Automated" }
    ];

    const result = await createADOWorkItem("Test Case", title, extraPatches);

    if (result.success) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: '✅ ADO Test Case Created',
            message: `Test Case #${result.id} created in ADO!\n${title}`
        });
    } else {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: '❌ ADO Test Case Failed',
            message: `Could not create Test Case: ${result.error}`
        });
    }

    return result;
}

/**
 * Create a Defect (Bug) work item in ADO
 */
async function createADODefect(testCaseName, bug, steps, aiBugReport) {
    const title = bug.title || `Bug in ${testCaseName.replace(/_/g, ' ')}`;

    // Build repro steps HTML
    let reproHtml = `<div><strong>Steps to Reproduce:</strong></div><ol>`;
    steps.forEach(s => {
        reproHtml += `<li>${escapeHtml(s.description || '')}</li>`;
    });
    reproHtml += `</ol>`;

    // System info block
    reproHtml += `<br/><div><strong>Test Case:</strong> ${escapeHtml(testCaseName)}</div>`;
    reproHtml += `<div><strong>Test Date:</strong> ${new Date().toLocaleString()}</div>`;

    // AI Bug Report as system info
    if (aiBugReport) {
        reproHtml += `<br/><div><strong>AI Analysis:</strong></div>`;
        reproHtml += `<pre style="font-size:12px">${escapeHtml(aiBugReport.substring(0, 2000))}</pre>`;
    }

    const extraPatches = [
        // Repro steps (ADO Defect field)
        { op: "add", path: "/fields/Microsoft.VSTS.TCM.ReproSteps", value: reproHtml },
        // System info / description
        { op: "add", path: "/fields/System.Description", value: reproHtml },
        // Expected result
        { op: "add", path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", 
          value: `<div><strong>Expected:</strong> ${escapeHtml(bug.expected || '')}</div><div><strong>Actual:</strong> ${escapeHtml(bug.actual || '')}</div>` },
        // Priority and Severity defaults
        { op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: 2 },
        { op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: "3 - Medium" },
        // State
        { op: "add", path: "/fields/System.State", value: "New" }
    ];

    const result = await createADOWorkItem("Bug", title, extraPatches);

    if (result.success) {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: '✅ ADO Defect Created',
            message: `Defect #${result.id} created in ADO!\n${title}`
        });
    } else {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: '❌ ADO Defect Failed',
            message: `Could not create Defect: ${result.error}`
        });
    }

    return result;
}

/********************************
 * STEP PREPROCESSING
 ********************************/
function deduplicateSteps(steps) {
    if (!steps || steps.length === 0) return [];
    const unique = [steps[0]];
    for (let i = 1; i < steps.length; i++) {
        if (steps[i - 1].description !== steps[i].description) {
            unique.push(steps[i]);
        }
    }
    return unique;
}

function cleanStepDescription(description) {
    return description
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/********************************
 * MAIN REPORT GENERATION
 ********************************/
async function generateAllReports(state, bug) {
    const testCaseName = state.testName || "QA_Test_Case";
    let steps = state.steps || [];

    steps = deduplicateSteps(steps);
    steps = steps.map(s => ({
        ...s,
        description: cleanStepDescription(s.description)
    }));

    /***** WORD EVIDENCE *****/
    downloadFile(
        generateWordHTML(testCaseName, steps, bug),
        `${testCaseName}_Evidence.doc`,
        "application/msword"
    );

    /***** MANUAL STEP LOG CSV WITH XPATH *****/
    downloadFile(
        generateCSV(steps, bug),
        `${testCaseName}_Step_Log.csv`,
        "text/csv"
    );

    /***** AI FILES *****/
    if (steps.length === 0) return;

    const detailedSteps = steps.map((s, i) => {
        const meta = s.metadata || {};
        return {
            number: i + 1,
            description: s.description,
            controlType: meta.controlType || 'unknown',
            fieldType: meta.fieldType || 'text',
            elementName: meta.elementName || 'unknown',
            actualFieldName: meta.actualFieldName || meta.elementName || 'unknown',
            value: meta.value || null,
            xpath: meta.xpath || ''
        };
    });

    const stepsForAI = detailedSteps.map(s =>
        `${s.number}. ${s.description} [Control: ${s.controlType}, Field: ${s.fieldType}, Name: ${s.actualFieldName}]`
    ).join("\n");

    /* -------- AI TEST CASE CSV PROMPT -------- */
    const testCaseCsvPrompt = `You are a senior QA automation engineer writing professional test cases.

METADATA ABOUT STEPS:
${JSON.stringify(detailedSteps, null, 2)}

CRITICAL RULES FOR FIELD TYPE DETECTION:
1. When fieldType is "dropdown" or controlType is "dropdown" → MUST use "selected from dropdown"
2. When fieldType is "email" → write "into email field"
3. When fieldType is "password" → write "into password field"
4. When fieldType is "phone" → write "into phone number field"
5. When controlType is "checkbox" → use "checked/unchecked checkbox"
6. When controlType is "radio button" → use "selected radio button"
7. When controlType is "button" and element is Submit/Save/Send → "clicked Submit button"
8. ALWAYS use the actualFieldName from metadata for field references

EXPECTED RESULT RULES:
1. For input fields: "The [actualFieldName] field should contain '[value]'" or "should be populated with"
2. For dropdowns: "The [actualFieldName] should be set to '[value]'"
3. For checkboxes: "The [actualFieldName] checkbox should be checked/unchecked"
4. For buttons: "The [action] should be completed successfully" or "The user should be redirected to [page]"
5. For radio buttons: "The [actualFieldName] should be selected as '[value]'"

OUTPUT FORMAT (CSV only, no headers):
Step number,Steps performed,Expected result

EXAMPLE TRANSFORMATIONS:

Input: User selected "Doctor" from dropdown "Choose your occupation" [Control: dropdown, Field: occupation, Name: Choose your occupation]
Output: 1,User selected 'Doctor' from dropdown 'Choose your occupation',The occupation should be set to 'Doctor'

Input: User entered "john@email.com" into input field "Email" [Control: input field, Field: email, Name: Email]
Output: 2,User entered 'john@email.com' into email field 'Email',The email field should contain 'john@email.com'

Input: User clicked button "Submit" [Control: button, Field: text, Name: Submit]
Output: 5,User clicked 'Submit' button,The form should be submitted successfully

NOW CONVERT THESE STEPS:
${stepsForAI}

IMPORTANT:
- Use the metadata to determine correct control types
- Match field types to appropriate descriptions
- ALWAYS reference actualFieldName for clarity
- Write professional, clear expected results
- Output ONLY CSV rows, no markdown, no explanations`;

    /* -------- GHERKIN FEATURE PROMPT -------- */
    const gherkinPrompt = `Convert these test steps into a properly structured Gherkin feature file.

STEP METADATA:
${JSON.stringify(detailedSteps, null, 2)}

REQUIREMENTS:
1. Proper Gherkin syntax with Given/When/Then structure
2. Group setup/navigation steps under "Given"
3. Group form filling and actions under "When"
4. Add appropriate "Then" assertions for verification
5. Use the actualFieldName from metadata
6. Recognize control types from metadata

EXAMPLE:
Given the user navigates to "Registration Page"
When the user enters "john@email.com" into "Email"
And the user selects "Engineer" from "Occupation"
And the user clicks "Submit"
Then the user should see a confirmation message

NOW CONVERT:
${stepsForAI}

Output plain Gherkin feature file, no markdown formatting.`;

    const aiCSV = await callGPT(testCaseCsvPrompt);
    const aiGherkin = await callGPT(gherkinPrompt);

    let cleanCSV = (aiCSV || "").replace(/```csv\n?/g, '').replace(/```\n?/g, '').trim();
    let cleanGherkin = (aiGherkin || "").replace(/```gherkin\n?/g, '').replace(/```\n?/g, '').trim();

    const fullCSV = "Step number,Steps performed,Expected result\n" + cleanCSV;

    // Download AI-generated CSV
    downloadFile(fullCSV, `${testCaseName}_AI_Test_Case.csv`, "text/csv");

    // Download Gherkin
    downloadFile(cleanGherkin, `${testCaseName}.txt`, "text/plain");

    // Download Prompt CSVs
    downloadFile(generatePromptCSV("Test Case", testCaseCsvPrompt), `${testCaseName}_TestCase_Prompt.csv`, "text/csv");
    downloadFile(generatePromptCSV("Gherkin", gherkinPrompt), `${testCaseName}_Gherkin_Prompt.csv`, "text/csv");

    // ***** ADO EXPORT: Create Test Case Work Item *****
    if (adoConfig.enabled) {
        await createADOTestCase(testCaseName, steps, fullCSV);
    }

    /* -------- BUG REPORT GENERATION -------- */
    if (bug) {
        const bugReportPrompt = `You are a senior QA engineer writing a comprehensive bug report.

BUG DETAILS PROVIDED:
Title: ${bug.title}
Expected Result: ${bug.expected}
Actual Result: ${bug.actual}

TEST STEPS PERFORMED:
${detailedSteps.map((s, i) => `${i + 1}. ${s.description} (${s.timestamp || 'N/A'}).`).join('\n')}

Generate a professional bug report with these sections:

1. BUG SUMMARY (1 clear sentence)
2. SEVERITY (Critical/High/Medium/Low) - infer from the bug description
3. PRIORITY (P0/P1/P2/P3) - infer based on impact
4. ENVIRONMENT (assume web browser, latest version)
5. STEPS TO REPRODUCE (detailed, numbered steps)
6. EXPECTED RESULT (clear, specific)
7. ACTUAL RESULT (clear, specific)
8. IMPACT (describe the impact on users/business)
9. ADDITIONAL OBSERVATIONS (any patterns, potential causes, or workarounds)
10. SUGGESTED NEXT STEPS (for developers)

FORMAT AS PLAIN TEXT, professional and detailed. Use this structure:

=================================================================
BUG REPORT: [Title]
=================================================================

SUMMARY:
[One clear sentence describing the bug]

SEVERITY: [Critical/High/Medium/Low]
PRIORITY: [P0/P1/P2/P3]

ENVIRONMENT:
- Browser: [Infer from context, or say "Web Browser"]
- Test Date: ${new Date().toLocaleDateString()}
- Test Case: ${testCaseName}

STEPS TO REPRODUCE:
[Detailed numbered steps based on recorded actions]

EXPECTED RESULT:
[Clear statement of what should happen]

ACTUAL RESULT:
[Clear statement of what actually happened]

IMPACT:
[Describe the impact on users/business]

ADDITIONAL OBSERVATIONS:
[Any patterns, potential root causes, or workarounds noticed]

ATTACHMENTS:
- Screenshots: Available in ${testCaseName}_Evidence.doc
- Test Log: ${testCaseName}_Step_Log.csv

SUGGESTED NEXT STEPS:
[Recommendations for developers to investigate or fix]

=================================================================
Reported by: QA Automation
Date: ${new Date().toLocaleString()}
=================================================================

Now generate the bug report:`;

        const aiBugReport = await callGPT(bugReportPrompt);

        let cleanBugReport = aiBugReport || "Bug report generation failed";
        cleanBugReport = cleanBugReport
            .replace(/```text\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        // Download AI bug report
        downloadFile(cleanBugReport, `${testCaseName}_Bug_Report.txt`, "text/plain");

        // Download Bug Report Prompt CSV
        downloadFile(generatePromptCSV("Bug Report", bugReportPrompt), `${testCaseName}_BugReport_Prompt.csv`, "text/csv");

        // ***** ADO EXPORT: Create Defect Work Item *****
        if (adoConfig.enabled) {
            await createADODefect(testCaseName, bug, steps, cleanBugReport);
        }
    }
}

/********************************
 * CLIENT AI GATEWAY CALL WITH RETRY
 ********************************/
async function callGPT(prompt, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const url = new URL(CLIENT_AI_ENDPOINT);
            url.searchParams.set("promptString", prompt);
            url.searchParams.set("temperature", CLIENT_AI_TEMPERATURE);

            const response = await fetch(url.toString(), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "*/*"
                },
                body: JSON.stringify(prompt)
            });

            if (response.status !== 200 && response.status !== 201) {
                const errorText = await response.text();
                console.error(`Client AI API Error (attempt ${attempt + 1}): HTTP ${response.status}`, errorText);
                if (attempt === retries) {
                    return `AI API ERROR: ${response.status} - ${errorText.substring(0, 100)}`;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }

            const content = await response.text();
            if (!content || content.trim() === "") {
                console.error("Empty response from client AI API");
                if (attempt === retries) return "AI API returned empty response";
                continue;
            }

            return content.trim();

        } catch (e) {
            console.error(`Client AI API Connection Error (attempt ${attempt + 1}):`, e);
            if (attempt === retries) return `AI API CONNECTION ERROR: ${e.message}`;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
}

/********************************
 * HELPERS
 ********************************/
function generateWordHTML(title, steps, bug) {
    let html = `<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #e74c3c; margin-top: 30px; }
        h3 { color: #34495e; margin-top: 20px; }
        .bug-section { background: #ffe6e6; padding: 15px; border-left: 4px solid #e74c3c; margin: 20px 0; }
        .step { margin-bottom: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px; }
        .step-header { font-weight: bold; color: #2980b9; margin-bottom: 10px; }
        img { max-width: 100%; border: 2px solid #bdc3c7; margin-top: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .timestamp { color: #7f8c8d; font-size: 0.9em; }
        .metadata { font-size: 0.85em; color: #95a5a6; margin-top: 5px; }
        .xpath { font-family: 'Courier New', monospace; font-size: 0.8em; color: #16a085; background: #ecf0f1; padding: 5px; margin-top: 5px; border-radius: 3px; word-break: break-all; }
    </style>
</head>
<body>
    <h1>Test Evidence: ${title}</h1>
    <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
    <p><strong>Total Steps:</strong> ${steps.length}</p>`;

    if (bug) {
        html += `
    <div class="bug-section">
        <h2>🐛 BUG DETAILS</h2>
        <p><strong>Title:</strong> ${bug.title || 'Untitled Bug'}</p>
        <p><strong>Expected Result:</strong> ${bug.expected}</p>
        <p><strong>Actual Result:</strong> ${bug.actual}</p>
        <p><strong>Note:</strong> See ${title}_Bug_Report.txt for detailed AI analysis</p>
    </div>`;
    }

    html += `<h2>Test Steps</h2>`;

    steps.forEach((s, i) => {
        const meta = s.metadata || {};
        html += `
    <div class="step">
        <div class="step-header">Step ${i + 1}</div>
        <p>${s.description}</p>
        <p class="timestamp">Time: ${s.timestamp}</p>
        ${meta.controlType ? `<p class="metadata">Control: ${meta.controlType} | Field Type: ${meta.fieldType || 'text'} | Field Name: ${meta.actualFieldName || meta.elementName || 'N/A'}</p>` : ''}
        ${meta.xpath ? `<p class="xpath"><strong>XPath:</strong> ${meta.xpath}</p>` : ''}
        ${s.screenshot ? `<img src="${s.screenshot}" alt="Step ${i + 1} Screenshot">` : '<p><em>No screenshot available</em></p>'}
    </div>`;
    });

    return html + "</body></html>";
}

function generateCSV(steps, bug) {
    let csv = "";

    if (bug) {
        csv = `BUG TITLE,"${(bug.title || '').replace(/"/g, '""')}"\n`;
        csv += `EXPECTED RESULT,"${(bug.expected || '').replace(/"/g, '""')}"\n`;
        csv += `ACTUAL RESULT,"${(bug.actual || '').replace(/"/g, '""')}"\n\n`;
    }

    csv += "Step,Description,Time,Control Type,Field Type,Field Name,XPath\n";

    steps.forEach((s, i) => {
        const desc = (s.description || '').replace(/"/g, '""');
        const time = (s.timestamp || '').replace(/"/g, '""');
        const meta = s.metadata || {};
        const control = (meta.controlType || 'unknown').replace(/"/g, '""');
        const field = (meta.fieldType || 'text').replace(/"/g, '""');
        const fieldName = (meta.actualFieldName || meta.elementName || 'N/A').replace(/"/g, '""');
        const xpath = (meta.xpath || '').replace(/"/g, '""');

        csv += `${i + 1},"${desc}","${time}","${control}","${field}","${fieldName}","${xpath}"\n`;
    });

    return csv;
}

function generatePromptCSV(promptType, promptText) {
    const header = "prompt_type,prompt_text,ai_endpoint,temperature,generated_at";
    const safePrompt = promptText.replace(/"/g, '""');
    const row = `"${promptType}","${safePrompt}","${CLIENT_AI_ENDPOINT}","${CLIENT_AI_TEMPERATURE}","${new Date().toLocaleString()}"`;
    return header + "\n" + row;
}

function downloadFile(content, filename, type) {
    chrome.downloads.download({
        url: `data:${type};charset=utf-8,` + encodeURIComponent(content),
        filename,
        saveAs: false
    });
}
