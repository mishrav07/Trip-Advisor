/* =========================================================
   TripMate AI - Frontend Controller
   Compatible with LangGraph Travel Agent backend
   ========================================================= */

let currentThreadId =
    localStorage.getItem("travel_thread_id") || null;

let latestAnswerMarkdown = "";
let latestBackendData = null;

const API_ENDPOINT = "/api/travel";

/*
 * If your FastAPI backend exposes the resume endpoint:
 *
 * POST /api/travel/resume
 *
 * with:
 * {
 *   thread_id,
 *   approved,
 *   feedback
 * }
 *
 * keep this value.
 */
const RESUME_ENDPOINT = "/api/travel/resume";


/* =========================================================
   DOM HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function safeJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}


/* =========================================================
   PROMPTS
   ========================================================= */

function setPrompt(text) {
    const input = $("userInput");

    if (!input) return;

    input.value = text;
    input.focus();

    updateCharacterCount();
}


/* =========================================================
   LOADING
   ========================================================= */

function setLoading(isLoading) {

    const sendBtn = $("sendBtn");
    const btnText = $("btnText");
    const btnLoader = $("btnLoader");

    if (sendBtn) {
        sendBtn.disabled = isLoading;
        sendBtn.classList.toggle("loading", isLoading);
    }

    if (btnText) {
        btnText.classList.toggle("hidden", isLoading);
    }

    if (btnLoader) {
        btnLoader.classList.toggle("hidden", !isLoading);
    }

    const input = $("userInput");

    if (input) {
        input.disabled = isLoading;
    }

    document.body.classList.toggle("tripmate-loading", isLoading);

    const processing = $("processingSection");

    if (processing) {
        processing.classList.toggle("hidden", !isLoading);
    }
}


/* =========================================================
   ERROR HANDLING
   ========================================================= */

function showError(message) {

    const errorBox = $("errorBox");

    if (!errorBox) {
        console.error(message);
        return;
    }

    errorBox.innerHTML = `
        <div class="error-icon">!</div>
        <div>
            <strong>Something went wrong</strong>
            <p>${escapeHtml(message)}</p>
        </div>
    `;

    errorBox.classList.remove("hidden");

    errorBox.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}


function hideError() {

    const errorBox = $("errorBox");

    if (!errorBox) return;

    errorBox.classList.add("hidden");
    errorBox.innerHTML = "";
}


/* =========================================================
   MARKDOWN
   ========================================================= */

function renderMarkdown(markdown) {

    if (!markdown) {
        return "<p>No travel plan was returned.</p>";
    }

    if (typeof marked !== "undefined") {

        try {

            const html = marked.parse(markdown);

            /*
             * DOMPurify is used when available.
             * This prevents backend-generated HTML from being
             * inserted directly into the page.
             */

            if (typeof DOMPurify !== "undefined") {
                return DOMPurify.sanitize(html);
            }

            return html;

        } catch (error) {
            console.warn("Markdown rendering failed:", error);
        }
    }

    return `<pre>${escapeHtml(markdown)}</pre>`;
}


/* =========================================================
   RESULT
   ========================================================= */

function showResult(answer, threadId, data = {}) {

    latestAnswerMarkdown = answer || "";
    latestBackendData = data || {};

    const resultSection = $("resultSection");
    const resultBox = $("resultBox");
    const threadInfo = $("threadInfo");

    if (!resultSection || !resultBox) {
        console.warn("Result section not found in HTML.");
        return;
    }

    resultBox.innerHTML = renderMarkdown(answer);

    if (threadInfo) {
        threadInfo.innerHTML = `
            <span class="thread-label">Conversation</span>
            <span class="thread-id">${escapeHtml(threadId || "New thread")}</span>
        `;
    }

    resultSection.classList.remove("hidden");

    renderBackendDetails(data);

    resultSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


/* =========================================================
   BACKEND RESPONSE DETAILS
   ========================================================= */

function renderBackendDetails(data) {

    if (!data) return;

    /*
     * Create a dynamic details container if it does not exist.
     * This means the existing HTML does not need to contain
     * separate flight/hotel/weather/itinerary containers.
     */

    let details = document.getElementById("backendDetails");

    if (!details) {

        details = document.createElement("div");
        details.id = "backendDetails";
        details.className = "backend-details";

        const resultBox = $("resultBox");

        if (resultBox && resultBox.parentNode) {
            resultBox.parentNode.appendChild(details);
        } else {
            return;
        }
    }

    details.innerHTML = "";


    /* -----------------------------------------------------
       APPROVAL
       ----------------------------------------------------- */

    if (
        data.requires_approval === true ||
        data.approval_request
    ) {
        renderApprovalPanel(details, data);
    }


    /* -----------------------------------------------------
       TRIP CONSTRAINTS
       ----------------------------------------------------- */

    if (data.trip_constraints) {

        addDetailsCard(
            details,
            "Trip Requirements",
            "🧭",
            renderObjectGrid(data.trip_constraints)
        );
    }


    /* -----------------------------------------------------
       SELECTED AGENTS
       ----------------------------------------------------- */

    if (
        Array.isArray(data.selected_agents) &&
        data.selected_agents.length
    ) {

        addDetailsCard(
            details,
            "Agents Used",
            "🤖",
            `
            <div class="agent-list">
                ${data.selected_agents
                .map(agent => `
                        <span class="agent-chip">
                            <span class="agent-dot"></span>
                            ${escapeHtml(agent)}
                        </span>
                    `)
                .join("")}
            </div>
            `
        );
    }


    /* -----------------------------------------------------
       FLIGHTS
       ----------------------------------------------------- */

    if (data.flight_results) {

        addDetailsCard(
            details,
            "Flight Results",
            "✈️",
            renderBackendData(data.flight_results)
        );
    }


    /* -----------------------------------------------------
       HOTELS
       ----------------------------------------------------- */

    if (data.hotel_results) {

        addDetailsCard(
            details,
            "Hotel Results",
            "🏨",
            renderBackendData(data.hotel_results)
        );
    }


    /* -----------------------------------------------------
       WEATHER
       ----------------------------------------------------- */

    if (data.weather_results) {

        addDetailsCard(
            details,
            "Weather",
            "🌤️",
            renderBackendData(data.weather_results)
        );
    }


    /* -----------------------------------------------------
       BUDGET
       ----------------------------------------------------- */

    if (data.budget_results) {

        addDetailsCard(
            details,
            "Budget",
            "💶",
            renderBackendData(data.budget_results)
        );
    }


    /* -----------------------------------------------------
       ITINERARY
       ----------------------------------------------------- */

    if (data.itinerary) {

        addDetailsCard(
            details,
            "Generated Itinerary",
            "🗺️",
            renderBackendData(data.itinerary)
        );
    }


    /* -----------------------------------------------------
       SUPERVISOR REASONING
       ----------------------------------------------------- */

    if (data.supervisor_reasoning) {

        addDetailsCard(
            details,
            "Planning Logic",
            "🧠",
            `
            <div class="reasoning-box">
                ${renderMarkdown(
                String(data.supervisor_reasoning)
            )}
            </div>
            `
        );
    }


    /* -----------------------------------------------------
       LLM CALLS
       ----------------------------------------------------- */

    if (data.llm_calls) {

        addDetailsCard(
            details,
            "AI Processing",
            "⚡",
            renderBackendData(data.llm_calls)
        );
    }


    /* -----------------------------------------------------
       GUARDRAIL STATUS
       ----------------------------------------------------- */

    if (
        data.guardrail_allowed !== undefined ||
        data.guardrail_reason
    ) {

        const allowed = data.guardrail_allowed !== false;

        addDetailsCard(
            details,
            "Request Validation",
            allowed ? "✓" : "⚠️",
            `
            <div class="guardrail-status ${allowed ? "allowed" : "blocked"}">
                <span class="guardrail-dot"></span>

                <div>
                    <strong>
                        ${allowed ? "Request accepted" : "Request restricted"}
                    </strong>

                    ${data.guardrail_reason
                ? `<p>${escapeHtml(data.guardrail_reason)}</p>`
                : ""
            }
                </div>
            </div>
            `
        );
    }


    if (!details.innerHTML.trim()) {
        details.classList.add("hidden");
    } else {
        details.classList.remove("hidden");
    }
}


/* =========================================================
   APPROVAL PANEL
   ========================================================= */

function renderApprovalPanel(container, data) {

    const panel = document.createElement("div");

    panel.className = "approval-panel";

    const request =
        data.approval_request ||
        "The travel plan requires your approval before continuing.";

    panel.innerHTML = `
        <div class="approval-header">
            <div class="approval-icon">✓</div>

            <div>
                <h3>Approval Required</h3>
                <p>
                    TripMate needs your confirmation before
                    continuing with the travel plan.
                </p>
            </div>
        </div>

        <div class="approval-message">
            ${renderMarkdown(String(request))}
        </div>

        <div class="approval-feedback">
            <label for="approvalFeedback">
                Optional feedback
            </label>

            <textarea
                id="approvalFeedback"
                placeholder="Add changes or preferences before continuing..."
                rows="3"
            ></textarea>
        </div>

        <div class="approval-actions">

            <button
                id="approveTripBtn"
                class="approval-btn approve"
                type="button"
            >
                ✓ Approve & Continue
            </button>

            <button
                id="rejectTripBtn"
                class="approval-btn reject"
                type="button"
            >
                ✕ Reject
            </button>

        </div>
    `;

    container.prepend(panel);

    document
        .getElementById("approveTripBtn")
        ?.addEventListener("click", () => {
            resumeTravel(true);
        });

    document
        .getElementById("rejectTripBtn")
        ?.addEventListener("click", () => {
            resumeTravel(false);
        });
}


/* =========================================================
   RESUME LANGGRAPH HUMAN-IN-THE-LOOP
   ========================================================= */

async function resumeTravel(approved) {

    hideError();

    const feedbackElement =
        document.getElementById("approvalFeedback");

    const feedback =
        feedbackElement?.value.trim() || "";

    if (!currentThreadId) {
        showError(
            "No active travel conversation was found."
        );
        return;
    }

    const approveBtn =
        document.getElementById("approveTripBtn");

    const rejectBtn =
        document.getElementById("rejectTripBtn");

    if (approveBtn) approveBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;

    try {

        const response = await fetch(RESUME_ENDPOINT, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                thread_id: currentThreadId,
                approved: approved,
                feedback: feedback
            })
        });


        const data = await response.json();


        if (!response.ok || data.success === false) {

            throw new Error(
                data.error ||
                "Unable to continue the travel planning process."
            );
        }


        currentThreadId =
            data.thread_id ||
            currentThreadId;

        localStorage.setItem(
            "travel_thread_id",
            currentThreadId
        );


        showResult(
            data.answer || "",
            currentThreadId,
            data
        );


    } catch (error) {

        showError(error.message);

        if (approveBtn) approveBtn.disabled = false;
        if (rejectBtn) rejectBtn.disabled = false;
    }
}


/* =========================================================
   GENERIC BACKEND DATA RENDERER
   ========================================================= */

function renderBackendData(data) {

    if (data === null || data === undefined) {
        return "<p>No data available.</p>";
    }


    if (typeof data === "string") {

        return renderMarkdown(data);
    }


    if (typeof data === "number" ||
        typeof data === "boolean") {

        return `
            <div class="single-value">
                ${escapeHtml(data)}
            </div>
        `;
    }


    if (Array.isArray(data)) {

        if (!data.length) {
            return `
                <div class="empty-data">
                    No results available.
                </div>
            `;
        }


        /*
         * Arrays containing objects become responsive
         * result cards instead of a huge JSON block.
         */

        if (
            typeof data[0] === "object" &&
            data[0] !== null
        ) {

            return `
                <div class="data-grid">

                    ${data.map((item, index) => `

                        <div class="data-item">

                            <div class="data-item-number">
                                ${index + 1}
                            </div>

                            <div class="data-item-content">

                                ${renderObjectGrid(item)}

                            </div>

                        </div>

                    `).join("")}

                </div>
            `;
        }


        return `
            <ul class="backend-list">
                ${data.map(item => `
                    <li>${escapeHtml(item)}</li>
                `).join("")}
            </ul>
        `;
    }


    if (typeof data === "object") {

        return renderObjectGrid(data);
    }


    return `<pre>${escapeHtml(String(data))}</pre>`;
}


/* =========================================================
   OBJECT GRID
   ========================================================= */

function renderObjectGrid(object) {

    if (!object || typeof object !== "object") {
        return escapeHtml(object);
    }


    return `
        <div class="object-grid">

            ${Object.entries(object)
            .map(([key, value]) => {

                if (
                    value === null ||
                    value === undefined ||
                    value === ""
                ) {
                    return "";
                }

                let displayValue;

                if (
                    typeof value === "object"
                ) {
                    displayValue = `
                            <pre class="nested-json">
                                ${escapeHtml(
                        safeJson(value)
                    )}
                            </pre>
                        `;
                } else {
                    displayValue =
                        escapeHtml(value);
                }

                return `
                        <div class="object-field">

                            <span class="object-key">
                                ${formatKey(key)}
                            </span>

                            <div class="object-value">
                                ${displayValue}
                            </div>

                        </div>
                    `;

            })
            .join("")}

        </div>
    `;
}


/* =========================================================
   KEY FORMATTER
   ========================================================= */

function formatKey(key) {

    return String(key)
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, char =>
            char.toUpperCase()
        );
}


/* =========================================================
   DETAILS CARD
   ========================================================= */

function addDetailsCard(
    container,
    title,
    icon,
    content
) {

    const card = document.createElement("section");

    card.className = "backend-card";

    card.innerHTML = `
        <div class="backend-card-header">

            <div class="backend-card-title">

                <span class="backend-card-icon">
                    ${icon}
                </span>

                <div>
                    <h3>${escapeHtml(title)}</h3>
                </div>

            </div>

            <button
                class="details-toggle"
                type="button"
                aria-label="Toggle section"
            >
                −
            </button>

        </div>

        <div class="backend-card-content">
            ${content}
        </div>
    `;

    container.appendChild(card);


    const toggle =
        card.querySelector(".details-toggle");

    const body =
        card.querySelector(".backend-card-content");


    toggle?.addEventListener("click", () => {

        const hidden =
            body.classList.toggle("collapsed");

        toggle.textContent =
            hidden ? "+" : "−";
    });
}


/* =========================================================
   MAIN REQUEST
   ========================================================= */

async function sendMessage() {

    hideError();

    const input = $("userInput");

    if (!input) {
        showError("Travel input field was not found.");
        return;
    }

    const message = input.value.trim();


    if (!message) {

        showError(
            "Please enter your travel request first."
        );

        input.focus();

        return;
    }


    setLoading(true);

    try {

        const response = await fetch(
            API_ENDPOINT,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    message: message,
                    thread_id: currentThreadId
                })
            }
        );


        /*
         * Handle non-JSON responses gracefully.
         */

        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error(
                `Server returned an invalid response (${response.status}).`
            );
        }


        if (!response.ok || data.success === false) {

            throw new Error(
                data.error ||
                data.message ||
                `Travel request failed (${response.status}).`
            );
        }


        /*
         * Backend creates a UUID when thread_id is not
         * supplied. Persist it for subsequent requests.
         */

        if (data.thread_id) {

            currentThreadId =
                data.thread_id;

            localStorage.setItem(
                "travel_thread_id",
                currentThreadId
            );
        }


        showResult(
            data.answer || "",
            data.thread_id || currentThreadId,
            data
        );


    } catch (error) {

        console.error(
            "TripMate request failed:",
            error
        );

        showError(
            error.message ||
            "Unable to connect to the travel planner."
        );

    } finally {

        setLoading(false);
    }
}


/* =========================================================
   COPY RESULT
   ========================================================= */

async function copyResult() {

    const resultBox = $("resultBox");

    if (!resultBox) return;

    const text =
        resultBox.innerText.trim();


    if (!text) {

        showError(
            "No travel plan available to copy."
        );

        return;
    }


    try {

        await navigator.clipboard.writeText(text);

        showTemporaryButtonMessage(
            ".copy-btn",
            "✓ Copied"
        );

    } catch {

        showError(
            "Could not copy the travel plan."
        );
    }
}


/* =========================================================
   BUTTON FEEDBACK
   ========================================================= */

function showTemporaryButtonMessage(
    selector,
    message
) {

    const button =
        document.querySelector(selector);

    if (!button) return;

    const original =
        button.dataset.originalText ||
        button.textContent;

    button.dataset.originalText = original;

    button.textContent = message;

    setTimeout(() => {
        button.textContent = original;
    }, 1600);
}


/* =========================================================
   PDF
   ========================================================= */

async function downloadPDF() {

    const pdfContent =
        $("pdfContent");

    if (
        !latestAnswerMarkdown ||
        !pdfContent
    ) {

        showError(
            "No travel plan available to download."
        );

        return;
    }


    const downloadBtn =
        document.querySelector(".download-btn");

    const oldText =
        downloadBtn?.textContent ||
        "Download PDF";


    if (downloadBtn) {

        downloadBtn.textContent =
            "Preparing PDF...";

        downloadBtn.disabled = true;
    }


    /*
     * Populate the PDF container with the actual
     * backend answer rather than relying on hidden
     * stale HTML.
     */

    const pdfAnswer =
        pdfContent.querySelector(
            ".pdf-answer"
        );


    if (pdfAnswer) {

        pdfAnswer.innerHTML =
            renderMarkdown(
                latestAnswerMarkdown
            );

    } else {

        pdfContent.innerHTML = `
            <div class="pdf-title">
                <h1>TripMate AI</h1>
                <p>AI Generated Travel Plan</p>
            </div>

            <div class="pdf-answer">
                ${renderMarkdown(
            latestAnswerMarkdown
        )}
            </div>
        `;
    }


    try {

        if (
            typeof html2pdf ===
            "undefined"
        ) {
            throw new Error(
                "PDF library is not available."
            );
        }


        const options = {

            margin: 0.5,

            filename:
                "tripmate-ai-travel-plan.pdf",

            image: {
                type: "jpeg",
                quality: 0.98
            },

            html2canvas: {
                scale: 2,
                useCORS: true,
                backgroundColor: "#ffffff"
            },

            jsPDF: {
                unit: "in",
                format: "a4",
                orientation: "portrait"
            },

            pagebreak: {
                mode: [
                    "avoid-all",
                    "css",
                    "legacy"
                ]
            }
        };


        await html2pdf()
            .set(options)
            .from(pdfContent)
            .save();


    } catch (error) {

        console.error(
            "PDF generation failed:",
            error
        );

        showError(
            "Could not generate the PDF."
        );

    } finally {

        if (downloadBtn) {

            downloadBtn.textContent =
                oldText;

            downloadBtn.disabled = false;
        }
    }
}


/* =========================================================
   NEW TRIP
   ========================================================= */

function newTrip() {

    currentThreadId = null;

    latestAnswerMarkdown = "";
    latestBackendData = null;

    localStorage.removeItem(
        "travel_thread_id"
    );


    const input = $("userInput");

    if (input) {
        input.value = "";
        input.focus();
    }


    const resultSection =
        $("resultSection");

    if (resultSection) {
        resultSection.classList.add("hidden");
    }


    const backendDetails =
        $("backendDetails");

    if (backendDetails) {
        backendDetails.innerHTML = "";
    }


    hideError();

    updateCharacterCount();
}


/* =========================================================
   CHARACTER COUNTER
   ========================================================= */

function updateCharacterCount() {

    const input = $("userInput");

    if (!input) return;

    const counter =
        document.getElementById(
            "characterCount"
        );

    if (!counter) return;

    const length =
        input.value.length;

    counter.textContent =
        `${length} characters`;
}


/* =========================================================
   KEYBOARD
   ========================================================= */

document.addEventListener(
    "keydown",
    function (event) {

        /*
         * Ctrl + Enter / Cmd + Enter
         */

        if (
            (event.ctrlKey ||
                event.metaKey) &&
            event.key === "Enter"
        ) {

            event.preventDefault();

            sendMessage();
        }
    }
);


/* =========================================================
   INPUT EVENTS
   ========================================================= */

document.addEventListener(
    "input",
    function (event) {

        if (
            event.target &&
            event.target.id === "userInput"
        ) {

            updateCharacterCount();
        }
    }
);


/* =========================================================
   CLICK HANDLING
   ========================================================= */

document.addEventListener(
    "click",
    function (event) {

        const promptButton =
            event.target.closest(
                "[data-prompt]"
            );

        if (promptButton) {

            const prompt =
                promptButton.dataset.prompt;

            if (prompt) {
                setPrompt(prompt);
            }
        }
    }
);


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        updateCharacterCount();

        /*
         * Make the Enter key submit the request
         * only when it is not being used for a newline.
         */

        const input =
            $("userInput");

        if (input) {

            input.addEventListener(
                "keydown",
                function (event) {

                    if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.ctrlKey &&
                        !event.metaKey
                    ) {

                        /*
                         * On desktop, Enter submits.
                         * Shift+Enter creates a newline.
                         */

                        event.preventDefault();

                        sendMessage();
                    }
                }
            );
        }


        /*
         * Restore thread information if an
         * existing conversation exists.
         */

        if (currentThreadId) {

            const threadInfo =
                $("threadInfo");

            if (threadInfo) {

                threadInfo.innerHTML = `
                    <span class="thread-label">
                        Existing conversation
                    </span>

                    <span class="thread-id">
                        ${escapeHtml(
                    currentThreadId
                )}
                    </span>
                `;
            }
        }


        /*
         * Allow an optional "New Trip" button
         * to work without changing HTML.
         */

        const newTripButton =
            document.getElementById(
                "newTripBtn"
            );

        if (newTripButton) {

            newTripButton.addEventListener(
                "click",
                newTrip
            );
        }


        /*
         * Make sure result section is hidden
         * on initial page load.
         */

        const resultSection =
            $("resultSection");

        if (
            resultSection &&
            !latestAnswerMarkdown
        ) {
            resultSection.classList.add(
                "hidden"
            );
        }
    }
);


/* =========================================================
   GLOBAL API
   ========================================================= */

window.TripMateUI = {

    sendMessage,
    setPrompt,
    copyResult,
    downloadPDF,
    newTrip,
    resumeTravel,

    getThreadId: () =>
        currentThreadId,

    getLatestResponse: () =>
        latestBackendData
};