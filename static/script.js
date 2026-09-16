/* =========================================================
   AI TRAVEL PLANNER
   Modern Light / Colorful UI
   ========================================================= */

let currentThreadId =
    localStorage.getItem("travel_thread_id") || null;

let latestAnswerMarkdown = "";

let waitingForApproval = false;


/* =========================================================
   AGENT CONFIGURATION
   ========================================================= */

const AGENT_LABELS = {
    flight_agent: "✈️ Flight Agent",
    hotel_agent: "🏨 Hotel Agent",
    weather_agent: "🌦️ Weather Agent",
    budget_agent: "💰 Budget Agent",
    itinerary_agent: "🗓️ Itinerary Agent"
};

const AGENT_COLORS = {
    flight_agent: "blue",
    hotel_agent: "purple",
    weather_agent: "cyan",
    budget_agent: "green",
    itinerary_agent: "orange"
};


/* =========================================================
   QUICK PROMPT
   ========================================================= */

function setPrompt(text) {
    const input = document.getElementById("userInput");

    if (!input) return;

    input.value = text;

    input.focus();

    /* Put cursor at the end */
    input.selectionStart = input.selectionEnd = input.value.length;
}


/* =========================================================
   LOADING STATE
   ========================================================= */

function setLoading(isLoading, mode = "draft") {
    const sendBtn = document.getElementById("sendBtn");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");

    const approveBtn = document.getElementById("approveBtn");
    const reviseBtn = document.getElementById("reviseBtn");

    if (!sendBtn) return;

    sendBtn.disabled = isLoading;

    if (approveBtn) {
        approveBtn.disabled = isLoading;
    }

    if (reviseBtn) {
        reviseBtn.disabled = isLoading;
    }

    if (isLoading) {

        if (mode === "draft") {
            if (btnText) {
                btnText.textContent = "Creating plan...";
                btnText.classList.remove("hidden");
            }
        }

        if (mode === "approval") {
            if (btnText) {
                btnText.textContent = "Updating plan...";
                btnText.classList.remove("hidden");
            }
        }

        if (btnLoader) {
            btnLoader.classList.remove("hidden");
        }

        sendBtn.classList.add("loading");

    } else {

        if (btnText) {
            btnText.textContent = "Create Travel Plan";
            btnText.classList.remove("hidden");
        }

        if (btnLoader) {
            btnLoader.classList.add("hidden");
        }

        sendBtn.classList.remove("loading");
    }
}


/* =========================================================
   ERROR HANDLING
   ========================================================= */

function showError(message) {
    const errorBox = document.getElementById("errorBox");

    if (!errorBox) return;

    errorBox.textContent = message;

    errorBox.classList.remove("hidden");

    errorBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });
}

function hideError() {
    const errorBox = document.getElementById("errorBox");

    if (!errorBox) return;

    errorBox.classList.add("hidden");

    errorBox.textContent = "";
}


/* =========================================================
   MARKDOWN RENDERING
   ========================================================= */

function renderMarkdown(element, markdown) {
    if (!element) return;

    if (typeof marked !== "undefined") {

        try {
            element.innerHTML = marked.parse(markdown || "");
        } catch (error) {
            element.innerText = markdown || "";
        }

    } else {
        element.innerText = markdown || "";
    }
}


/* =========================================================
   WORKFLOW
   ========================================================= */

function showWorkflow(data) {
    const section =
        document.getElementById("workflowSection");

    const reasoning =
        document.getElementById("supervisorReasoning");

    const chips =
        document.getElementById("agentChips");

    const guardrailBadge =
        document.getElementById("guardrailBadge");

    if (!section) return;


    /* -----------------------------------------
       Supervisor reasoning
       ----------------------------------------- */

    if (reasoning) {
        reasoning.textContent =
            data.supervisor_reasoning ||
            "Supervisor routing completed.";
    }


    /* -----------------------------------------
       Agent chips
       ----------------------------------------- */

    if (chips) {

        chips.innerHTML = "";

        const selectedAgents =
            Array.isArray(data.selected_agents)
                ? data.selected_agents
                : [];

        selectedAgents.forEach((agent) => {

            const chip =
                document.createElement("span");

            chip.className = "agent-chip";

            /*
             * Optional color class.
             * Works with the new colorful CSS.
             */
            const color =
                AGENT_COLORS[agent];

            if (color) {
                chip.classList.add(`agent-${color}`);
            }

            chip.textContent =
                AGENT_LABELS[agent] || agent;

            chips.appendChild(chip);
        });
    }


    /* -----------------------------------------
       Guardrail
       ----------------------------------------- */

    if (guardrailBadge) {

        if (data.guardrail_allowed === false) {

            guardrailBadge.textContent =
                "Guardrail blocked";

            guardrailBadge.classList.add("blocked");

        } else {

            guardrailBadge.textContent =
                "Guardrail passed";

            guardrailBadge.classList.remove("blocked");
        }
    }


    /* -----------------------------------------
       Show section
       ----------------------------------------- */

    section.classList.remove("hidden");

    section.classList.add("ui-visible");

    setTimeout(() => {
        section.classList.remove("ui-visible");
    }, 500);
}


/* =========================================================
   RESULT
   ========================================================= */

function showResult(
    answer,
    threadId,
    isDraft = false
) {
    latestAnswerMarkdown = answer || "";

    const resultSection =
        document.getElementById("resultSection");

    const resultBox =
        document.getElementById("resultBox");

    const threadInfo =
        document.getElementById("threadInfo");

    const resultTitle =
        document.getElementById("resultTitle");

    if (!resultSection || !resultBox) return;


    /* -----------------------------------------
       Render markdown
       ----------------------------------------- */

    renderMarkdown(
        resultBox,
        latestAnswerMarkdown
    );


    /* -----------------------------------------
       Thread information
       ----------------------------------------- */

    if (threadInfo) {

        if (threadId) {
            threadInfo.textContent =
                `Thread ID: ${threadId}`;
        } else {
            threadInfo.textContent = "";
        }
    }


    /* -----------------------------------------
       Result title
       ----------------------------------------- */

    if (resultTitle) {

        resultTitle.textContent =
            isDraft
                ? "Draft Travel Plan"
                : "Your Final AI Travel Plan";
    }


    /* -----------------------------------------
       Show result
       ----------------------------------------- */

    resultSection.classList.remove("hidden");

    resultSection.classList.add("ui-visible");

    setTimeout(() => {
        resultSection.classList.remove("ui-visible");
    }, 500);


    /* -----------------------------------------
       Scroll to result
       ----------------------------------------- */

    setTimeout(() => {

        resultSection.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    }, 100);
}


/* =========================================================
   APPROVAL SECTION
   ========================================================= */

function showApproval(data) {
    waitingForApproval = true;

    const section =
        document.getElementById("approvalSection");

    const approvalRequest =
        document.getElementById("approvalRequest");

    if (!section) return;


    if (approvalRequest) {

        approvalRequest.textContent =
            data.approval_request ||
            "Review the draft and approve it, or provide feedback to request changes.";
    }


    section.classList.remove("hidden");

    section.classList.add("approval-active");

    setTimeout(() => {
        section.classList.remove("approval-active");
    }, 500);


    /* Scroll to approval area */

    setTimeout(() => {

        section.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

    }, 150);
}


function hideApproval() {

    waitingForApproval = false;

    const section =
        document.getElementById("approvalSection");

    const feedback =
        document.getElementById("approvalFeedback");

    if (section) {
        section.classList.add("hidden");
        section.classList.remove("approval-active");
    }

    if (feedback) {
        feedback.value = "";
    }
}


/* =========================================================
   RESET WORKFLOW UI
   ========================================================= */

function resetWorkflowUI() {

    hideError();

    hideApproval();

    const workflowSection =
        document.getElementById("workflowSection");

    if (workflowSection) {
        workflowSection.classList.add("hidden");
    }

    const resultSection =
        document.getElementById("resultSection");

    if (resultSection) {
        resultSection.classList.add("hidden");
    }

    latestAnswerMarkdown = "";
}


/* =========================================================
   SEND MESSAGE
   ========================================================= */

async function sendMessage() {

    hideError();


    /* -----------------------------------------
       Prevent duplicate workflows
       ----------------------------------------- */

    if (waitingForApproval) {

        showError(
            "Please approve or revise the current draft before starting another plan."
        );

        return;
    }


    /* -----------------------------------------
       Get input
       ----------------------------------------- */

    const input =
        document.getElementById("userInput");

    if (!input) {
        showError("Travel input field could not be found.");
        return;
    }

    const message =
        input.value.trim();


    /* -----------------------------------------
       Validate
       ----------------------------------------- */

    if (!message) {

        showError(
            "Please enter your travel request first."
        );

        input.focus();

        return;
    }


    /* -----------------------------------------
       Start loading
       ----------------------------------------- */

    setLoading(true, "draft");


    try {

        const response =
            await fetch("/api/travel", {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    message: message,
                    thread_id: currentThreadId
                })
            });


        /* -----------------------------------------
           Parse response safely
           ----------------------------------------- */

        let data;

        try {
            data = await response.json();
        } catch (error) {
            throw new Error(
                "The server returned an invalid response."
            );
        }


        /* -----------------------------------------
           API error
           ----------------------------------------- */

        if (!response.ok || !data.success) {

            throw new Error(
                data.error ||
                "Something went wrong while creating your travel plan."
            );
        }


        /* -----------------------------------------
           Store thread
           ----------------------------------------- */

        if (data.thread_id) {

            currentThreadId =
                data.thread_id;

            localStorage.setItem(
                "travel_thread_id",
                currentThreadId
            );
        }


        /* -----------------------------------------
           Workflow
           ----------------------------------------- */

        showWorkflow(data);


        /* -----------------------------------------
           Approval required
           ----------------------------------------- */

        if (data.requires_approval) {

            showResult(
                data.itinerary || data.answer,
                data.thread_id,
                true
            );

            showApproval(data);

        } else {

            hideApproval();

            showResult(
                data.answer,
                data.thread_id,
                false
            );
        }


    } catch (error) {

        console.error(
            "Travel workflow error:",
            error
        );

        showError(
            error.message ||
            "Unable to create your travel plan."
        );

    } finally {

        setLoading(false, "draft");
    }
}


/* =========================================================
   APPROVAL / REVISION
   ========================================================= */

async function submitApproval(approved) {

    hideError();


    /* -----------------------------------------
       Validate thread
       ----------------------------------------- */

    if (!currentThreadId) {

        showError(
            "There is no active travel thread."
        );

        return;
    }


    if (!waitingForApproval) {

        showError(
            "There is no draft waiting for approval."
        );

        return;
    }


    /* -----------------------------------------
       Get feedback
       ----------------------------------------- */

    const feedbackInput =
        document.getElementById(
            "approvalFeedback"
        );

    const feedback =
        feedbackInput
            ? feedbackInput.value.trim()
            : "";


    /* -----------------------------------------
       Revision requires feedback
       ----------------------------------------- */

    if (!approved && !feedback) {

        showError(
            "Please enter revision feedback before requesting changes."
        );

        if (feedbackInput) {
            feedbackInput.focus();
        }

        return;
    }


    /* -----------------------------------------
       Loading
       ----------------------------------------- */

    setLoading(true, "approval");


    try {

        const response =
            await fetch(
                "/api/travel/approve",
                {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    body: JSON.stringify({
                        thread_id:
                            currentThreadId,

                        approved:
                            approved,

                        feedback:
                            feedback
                    })
                }
            );


        /* -----------------------------------------
           Parse response
           ----------------------------------------- */

        let data;

        try {
            data = await response.json();
        } catch (error) {
            throw new Error(
                "The server returned an invalid response."
            );
        }


        /* -----------------------------------------
           API error
           ----------------------------------------- */

        if (!response.ok || !data.success) {

            throw new Error(
                data.error ||
                "Could not resume the travel workflow."
            );
        }


        /* -----------------------------------------
           Update workflow
           ----------------------------------------- */

        showWorkflow(data);


        /* -----------------------------------------
           Hide approval
           ----------------------------------------- */

        hideApproval();


        /* -----------------------------------------
           Show final result
           ----------------------------------------- */

        showResult(
            data.answer,
            data.thread_id || currentThreadId,
            false
        );


    } catch (error) {

        console.error(
            "Approval workflow error:",
            error
        );

        showError(
            error.message ||
            "Unable to update the travel plan."
        );

    } finally {

        setLoading(false, "approval");
    }
}


/* =========================================================
   COPY RESULT
   ========================================================= */

async function copyResult() {

    const resultBox =
        document.getElementById("resultBox");

    if (!resultBox) return;

    const text =
        resultBox.innerText.trim();


    if (!text) {

        showError(
            "There is no travel plan to copy."
        );

        return;
    }


    try {

        await navigator.clipboard.writeText(text);


        const copyBtn =
            document.querySelector(".copy-btn");

        if (!copyBtn) return;


        const oldText =
            copyBtn.textContent;

        copyBtn.textContent =
            "✓ Copied!";

        copyBtn.classList.add(
            "copy-success"
        );


        setTimeout(() => {

            copyBtn.textContent =
                oldText;

            copyBtn.classList.remove(
                "copy-success"
            );

        }, 1600);


    } catch (error) {

        console.error(
            "Copy error:",
            error
        );

        showError(
            "Could not copy the travel plan."
        );
    }
}


/* =========================================================
   DOWNLOAD PDF
   ========================================================= */

function downloadPDF() {

    const pdfContent =
        document.getElementById("pdfContent");


    if (!latestAnswerMarkdown) {

        showError(
            "No travel plan available to download."
        );

        return;
    }


    if (!pdfContent) {

        showError(
            "PDF content could not be found."
        );

        return;
    }


    if (typeof html2pdf === "undefined") {

        showError(
            "PDF download library is not available."
        );

        return;
    }


    const downloadBtn =
        document.querySelector(
            ".download-btn"
        );


    let oldText = "";

    if (downloadBtn) {

        oldText =
            downloadBtn.textContent;

        downloadBtn.textContent =
            "Preparing PDF...";

        downloadBtn.disabled = true;
    }


    const options = {

        margin: 0.5,

        filename:
            "ai-travel-plan.pdf",

        image: {
            type: "jpeg",
            quality: 0.98
        },

        html2canvas: {

            scale: 2,

            useCORS: true,

            backgroundColor:
                "#ffffff"
        },

        jsPDF: {

            unit: "in",

            format: "a4",

            orientation:
                "portrait"
        },

        pagebreak: {

            mode: [
                "avoid-all",
                "css",
                "legacy"
            ]
        }
    };


    html2pdf()

        .set(options)

        .from(pdfContent)

        .save()

        .then(() => {

            if (downloadBtn) {

                downloadBtn.textContent =
                    "✓ Downloaded";

                setTimeout(() => {

                    downloadBtn.textContent =
                        oldText;

                    downloadBtn.disabled =
                        false;

                }, 1600);
            }

        })

        .catch((error) => {

            console.error(
                "PDF error:",
                error
            );

            if (downloadBtn) {

                downloadBtn.textContent =
                    oldText;

                downloadBtn.disabled =
                    false;
            }

            showError(
                "Could not download PDF."
            );
        });
}


/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */

document.addEventListener(
    "keydown",
    function (event) {

        /*
         * Ctrl + Enter
         * or
         * Cmd + Enter on Mac
         */

        if (
            (event.ctrlKey || event.metaKey) &&
            event.key === "Enter"
        ) {

            event.preventDefault();

            sendMessage();
        }
    }
);


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const input =
            document.getElementById(
                "userInput"
            );


        /*
         * Enter submits.
         * Shift + Enter creates a new line.
         *
         * Remove this section if you want
         * Enter to always create a new line.
         */

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

                        event.preventDefault();

                        sendMessage();
                    }
                }
            );
        }


        /*
         * If an old thread exists,
         * keep it available for continuation.
         */

        if (currentThreadId) {

            const threadInfo =
                document.getElementById(
                    "threadInfo"
                );

            if (threadInfo) {

                threadInfo.textContent =
                    `Thread ID: ${currentThreadId}`;
            }
        }
    }
);
