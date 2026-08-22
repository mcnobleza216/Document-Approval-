/**
 * app.js
 * ─────────────────────────────────────────────────────────
 * Document Approval page (opened from the email buttons).
 *
 * ── ARCHITECTURE: ONE API ──
 * The email link only carries parameters. The page passes them
 * straight to the TRIGGER API, which both RECORDS the action and
 * RETURNS the JSON with the result + LAF details:
 *
 *   Email link:
 *     .../index.html?coid=01&branchid=01&lafno=2026123123&token=1&prompt=approve
 *
 *   Page calls:
 *     TRIGGER_URL?tokenid=1&coid=01&branchid=01&lafno=2026123123&prompt=approve
 *
 *   API returns (CURRENT SHAPE):
 *   {
 *     "result": "approve",     // "approve" = APPROVED
 *                               // "reject"  = DECLINED (remarks modal first)
 *                               // "return"  = RETURNED (remarks modal first)
 *     "apiMessage": "valid",   // ⚠ TOP-LEVEL, not inside "document"
 *     "document": {
 *       "lafNo", "docType", "documentDate", "preparedBy", "lesseeType",
 *       "decisionDate", "decidedBy", "remarks",
 *       "lesseeEntity", "lesseeName", "purpose", "unitType", "area",
 *       "contractStart", "contractEnd", "termMonths",
 *       "fileName", "pdfUrl",
 *       "procId", "nextProcId", "nextAuthId", "secKey"   // ⚠ rotate per step
 *     }
 *   }
 *
 * IMPORTANT: procId / nextProcId / secKey returned inside "document"
 * are the values for the NEXT step in the workflow (used to notify
 * the next authorizer). They are NOT the same as the ones on the
 * original email link, and must be used (not the URL's originals)
 * for the postApprovalAuth() call and any subsequent remarks call.
 *
 * While developing, USE_SAMPLE_DATA reads a local JSON of the same
 * shape instead of calling the API.
 */
(function () {
    /* ══════════════════════════════════════════════
       CONFIG
    ══════════════════════════════════════════════ */
    const USE_SAMPLE_DATA = false;   // true = read local sample JSON instead of the API
    const SAMPLE_URL      = "data/sample-approval.json";
    const CONFIG_URL      = "data/config.json";   // holds TRIGGER_URL / APPROVAL_AUTH_URL per environment
    /* THE single API — it both records the action AND returns
       the JSON with the result + LAF document details.
       Populated from config.json at startup by loadConfig(). */
    let TRIGGER_URL = "https://lmsapi.eurotowersintl.com/api/approval-auth-trigger";
    /* POST endpoint — called on APPROVE to pass the approval
       to the next authorizer (document.nextAuthId).
       Populated from config.json at startup by loadConfig(). */
    let APPROVAL_AUTH_URL = "https://lmsapi.eurotowersintl.com/api/approvalauth";
    const DOC_ID            = "LAF";   // document type code sent as DocId
    /* Fetches config.json and populates TRIGGER_URL / APPROVAL_AUTH_URL.
       Throws if the file is missing or doesn't contain both keys, so
       the caller can route to the error page instead of silently
       trying to fetch "null". */
//    async function loadConfig() {
//        const response = await fetch(CONFIG_URL);
//        if (!response.ok) throw new Error(`Failed to load config.json (${response.status})`);
//        const cfg = await response.json();
//        if (!cfg.TRIGGER_URL || !cfg.APPROVAL_AUTH_URL) {
//            throw new Error("config.json is missing TRIGGER_URL or APPROVAL_AUTH_URL.");
//        }
//        TRIGGER_URL       = cfg.TRIGGER_URL;
//        APPROVAL_AUTH_URL = cfg.APPROVAL_AUTH_URL;
//    }
    /* ── Query params from the email link ──
       ?coid=01&branchid=01&lafno=2026123123&token=1&prompt=approve */
    const params    = new URLSearchParams(window.location.search);
    const coId      = params.get("coid")     || "01";
    const branchId  = params.get("branchid") || "01";
    const lafNo     = params.get("lafno") || "2026080022";
    const token     = params.get("token")    || "1";   // default token
    const urlPrompt = (params.get("prompt") || "reject").toLowerCase();
    const procId     = params.get("procId") || "0";
    const nextProcId = params.get("nextProcId") || "6";
    const seckey     = params.get("secKey") || "46a810fd50a910e493bd7a59b799a915c47c868b79d69fbc03af86f6caafda27";
    /* prompt = which email button was clicked: approve | reject | return */
    /* ── Loaded document ── */
    let doc = null;
    /* Builds the trigger API URL from the email-link parameters.
       remarks is appended only on the reject/return confirmation call. */
    function buildTriggerUrl(remarks) {
        let url =
            `${TRIGGER_URL}` +
            `?tokenid=${encodeURIComponent(token)}` +
            `&coid=${encodeURIComponent(coId)}` +
            `&branchid=${encodeURIComponent(branchId)}` +
            `&lafno=${encodeURIComponent(lafNo)}` +
            `&prompt=${encodeURIComponent(urlPrompt)}` +
            `&procId=${encodeURIComponent(procId)}` +
            `&nextProcId=${encodeURIComponent(nextProcId)}` +
            `&secKey=${encodeURIComponent(seckey)}`;
        if (remarks) {
            url += `&remarks=${encodeURIComponent(remarks)}`;
        }
        return url;
    }
    async function postApprovalAuth(document) {
        /* Use the ROTATED values returned inside "document" for the
           next step, falling back to the original URL params only if
           the API didn't supply them (e.g. sample mode). */
        const payload = {
            TokenId:  token,
            DocId:    DOC_ID,
            RefNo:    document.lafNo || lafNo,
            CoId:     coId,
            BranchId: branchId,
            UserId:   document.nextAuthId || "",
            ProcId:   document.nextProcId ?? nextProcId,   // ← the step being moved TO, not the current step
            SecKey:   document.secKey || seckey,
            Remarks:  document.remarks || ""
        };
         if (USE_SAMPLE_DATA) {
            console.log("[sample mode] would POST to", APPROVAL_AUTH_URL, payload);
            return { ok: true };
        }
        try {
            const response = await fetch(APPROVAL_AUTH_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (!response.ok) { 
                return { ok: false, message: `Request failed (${response.status})` };
            }
            const data = await response.json();
            console.log("approvalauth response body:", data);
          
            const failFlag = data.IsSuccess;
            const isExplicitFailure =
                failFlag === false ||
                (typeof failFlag === "string" && failFlag.toLowerCase() === "false");
            if (isExplicitFailure) {
                return { ok: false, message: data.ApiMessage || "Authorization step failed." };
            }
            return { ok: true, message: data.ApiMessage };
        } catch (error) {
            console.error("approvalauth POST failed:", error);
            return { ok: false, message: error.message };
        }
    }
    /* ══════════════════════════════════════════════
       LOAD — call the trigger API with the email-link
       params; its JSON drives everything.
    ══════════════════════════════════════════════ */
    async function loadDocuments() {
        try {
            if (!USE_SAMPLE_DATA && !lafNo) {
                throw new Error("This link is invalid — missing LAF number.");
            }
            const url = USE_SAMPLE_DATA ? SAMPLE_URL : buildTriggerUrl();
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Request failed (${response.status})`);
            const raw    = await response.json();
            const result = mapApiResponse(raw);

            /* If the document is missing/empty, apiMessage is our best
               explanation of why (e.g. "Invalid link", "Already
               processed", "Link expired") — surface it on the error page. */
            if (!isDocumentValid(result.document)) {
                throw new Error(result.apiMessage || result.message || "Invalid response from server — document details are missing.");
            }
            if (result.success === undefined) {
                throw new Error(result.apiMessage || result.message || "Unrecognized result value from server.");
            }
            doc = result.document;
            doc.apiMessage = result.apiMessage;   // carried through to the result banner
            if (result.success === true) {
                doc.status = "Approved";
                const authResult = await postApprovalAuth(doc);
                if (!authResult.ok) {
                    throw new Error(authResult.message || "Failed to record the approval. Please try opening the link again.");
                }
                render(doc);
            } else if (result.success === "return") {
                doc.status = "Returned";
                openRemarksModal("Returned");
            } else {
                doc.status = "Declined";
                openRemarksModal("Declined");
            }
        } catch (error) {
            console.error("Failed to load approval:", error);
            showError(error.message);
        }
    }
    async function submitRemarks(remarks) {
        if (USE_SAMPLE_DATA) {
            console.log(`[sample mode] would call: ${buildTriggerUrl(remarks)}`);
            return true;
        }
        try {
            const response = await fetch(buildTriggerUrl(remarks));
            if (!response.ok) throw new Error(`Request failed (${response.status})`);
            return true;
        } catch (error) {
            console.error("Failed to submit remarks:", error);
            return false;
        }
    }

    /* A "document" is only usable if it exists AND has at least the
       core identifying fields populated. Guards against the API
       returning `"document": {}` or a document object where every
       field is null/empty — that should still land on the error page,
       not render a blank-looking approval page. */
    function isDocumentValid(document) {
        if (!document) return false;
        const required = [document.lafNo, document.docType, document.lesseeName];
        return required.some(v => v !== undefined && v !== null && String(v).trim() !== "");
    }

    function mapApiResponse(raw) {
        let success;
        const r = String(raw.result || "").toLowerCase();
        if      (r === "approve") success = true;
        else if (r === "reject")  success = false;
        else if (r === "return")  success = "return";
        else                      success = undefined;   // unknown → error state
        return {
            success: success,
            apiMessage: raw.apiMessage,   // ← FIX: top-level field, not raw.document.apimessage
            document: raw.document && {
                lafNo:         raw.document.lafNo,
                docType:       raw.document.docType,
                documentDate:  raw.document.documentDate,
                preparedBy:    raw.document.preparedBy,
                lesseeType:    raw.document.lesseeType,
                decisionDate:  raw.document.decisionDate,
                decidedBy:     raw.document.decidedBy,
                remarks:       raw.document.remarks,
                lesseeEntity:  raw.document.lesseeEntity,
                lesseeName:    raw.document.lesseeName,
                purpose:       raw.document.purpose,
                unitType:      raw.document.unitType,
                area:          raw.document.area,
                termMonths:    raw.document.termMonths,
                contractStart: raw.document.contractStart,
                contractEnd:   raw.document.contractEnd,
                fileName:      raw.document.fileName,
                pdfUrl:        raw.document.pdfUrl,
                procId:        raw.document.procId,       // ← FIX: capture rotated procId
                nextProcId:    raw.document.nextProcId,   // ← FIX: capture rotated nextProcId
                nextAuthId:    raw.document.nextAuthId,
                secKey:        raw.document.secKey        // ← FIX: capture rotated secKey
            }
        };
    }
    /* ══════════════════════════════════════════════
       RENDER
    ══════════════════════════════════════════════ */
    function setText(id, value) {
        document.getElementById(id).innerText = value ?? "—";
    }
    function formatDate(iso, withTime = false) {
        if (!iso) return "—";
        const d = new Date(iso);
        if (isNaN(d)) return iso;
        const opts = { year: "numeric", month: "long", day: "numeric" };
        if (withTime) {
            opts.hour   = "numeric";
            opts.minute = "2-digit";
        }
        return d.toLocaleDateString("en-US", opts);
    }
    function render(doc) {
        /* Header */
        setText("lafNo",         doc.lafNo);
        setText("docTypeHeader", doc.docType);
        /* Document information */
        setText("lafNoField",   doc.lafNo);
        setText("documentDate", formatDate(doc.documentDate));
        setText("preparedBy",   doc.preparedBy);
        setText("lesseeType",   doc.lesseeType);
        renderStatusField(doc.status);
        /* Lease details */
        setText("lesseeEntity",  doc.lesseeEntity);
        setText("lesseeName",    doc.lesseeName);
        setText("purpose",       doc.purpose);
        setText("unitType",      doc.unitType);
        setText("area",          doc.area);
        setText("termMonths",    doc.termMonths != null ? `${doc.termMonths} months` : "—");
        setText("contractStart", formatDate(doc.contractStart));
        setText("contractEnd",   formatDate(doc.contractEnd));
        /* Document file — clickable, opens in new tab */
        setText("fileName", doc.fileName || "Document.pdf");
        document.getElementById("fileLink").href = doc.pdfUrl || "#";
        /* Result banner */
        renderBanner(doc);
        /* Reveal content */
        document.getElementById("loadingState").classList.add("d-none");
        document.getElementById("mainContent").classList.remove("d-none");
    }
    /* Status shown as a colored value in Document Information */
    function renderStatusField(status) {
        const el = document.getElementById("statusField");
        el.innerText = status || "—";
        el.style.color =
            status === "Approved" ? "#047857" :
            status === "Declined" ? "#b91c1c" :
            status === "Returned" ? "#c2410c" :
                                    "#92400e";
    }
    function renderBanner(doc) {
        const banner = document.getElementById("resultBanner");
        const icon   = document.getElementById("resultIcon");
        const title  = document.getElementById("resultTitle");
        const sub    = document.getElementById("resultSub");
        const status = (doc.status || "Pending").toLowerCase();
        const config = {
            approved: {
                cls:   "approved",
                icon:  "fa-circle-check",
                title: "Document Approved",
                sub:   buildSubText("approved", doc)
            },
            declined: {
                cls:   "declined",
                icon:  "fa-circle-xmark",
                title: "Document Declined",
                sub:   buildSubText("declined", doc)
            },
            returned: {
                cls:   "returned",
                icon:  "fa-rotate-left",
                title: "Document Returned",
                sub:   buildSubText("returned", doc)
            },
            pending: {
                cls:   "pending",
                icon:  "fa-clock",
                title: "Awaiting Decision",
                sub:   "This document has not been actioned yet. Please use the buttons in the email to approve or decline."
            }
        };
        const c = config[status] || config.pending;
        banner.className = `result-banner shadow-sm ${c.cls}`;
        icon.className   = `fa-solid result-icon ${c.icon}`;
        title.innerText  = c.title;
        sub.innerText    = c.sub;
        /* Remarks — shown when DECLINED or RETURNED */
        const remarksBox = document.getElementById("remarksBox");
        if ((status === "declined" || status === "returned")
            && doc.remarks && doc.remarks.trim() !== "") {
            document.getElementById("remarksText").innerText = doc.remarks;
            remarksBox.classList.remove("d-none");
        } else {
            remarksBox.classList.add("d-none");
        }
    }
    function buildSubText(action, doc) {
        /* Prefer the server's own message (apiMessage) when supplied —
           it reflects the actual outcome/context from the backend
           (e.g. "Approved successfully", "Already processed by another
           authorizer"). Fall back to a generated sentence otherwise. */
        if (doc.apiMessage && doc.apiMessage.trim() !== "") {
            return doc.apiMessage;
        }
        const parts = [];
        if (doc.decidedBy)    parts.push(`by ${doc.decidedBy}`);
        if (doc.decisionDate) parts.push(`on ${formatDate(doc.decisionDate, true)}`);
        return parts.length
            ? `This document was ${action} ${parts.join(" ")}.`
            : `This document has been ${action}.`;
    }
    /* ══════════════════════════════════════════════
       ERROR STATE
    ══════════════════════════════════════════════ */
    function showError(message) {
        document.getElementById("loadingState").classList.add("d-none");
        document.getElementById("mainContent").classList.add("d-none");
        document.getElementById("errorState").classList.remove("d-none");
        if (message) {
            document.getElementById("errorMessage").innerText = message;
        }
    }
    /* ══════════════════════════════════════════════
       REMARKS MODAL — required before Decline / Return
    ══════════════════════════════════════════════ */
    let remarksModal   = null;
    let decisionMode   = "Declined";   // "Declined" | "Returned"
    const MODAL_CONFIG = {
        Declined: {
            title:    `<i class="fa-solid fa-circle-xmark me-2"></i>Disapprove Document`,
            titleCls: "modal-title text-danger",
            text:     "You are about to disapprove this document. Please state the reason before proceeding.",
            btnCls:   "btn btn-danger px-4",
            btnHtml:  `<i class="fa-solid fa-xmark me-1"></i> Disapprove`
        },
        Returned: {
            title:    `<i class="fa-solid fa-rotate-left me-2"></i>Return Document`,
            titleCls: "modal-title",
            text:     "You are about to return this document for revision. Please state what needs to be corrected.",
            btnCls:   "btn btn-warning px-4 text-white",
            btnHtml:  `<i class="fa-solid fa-rotate-left me-1"></i> Return`
        }
    };
    function openRemarksModal(mode) {
        decisionMode = mode;
        const c = MODAL_CONFIG[mode];
        const titleEl = document.getElementById("remarksModalTitle");
        titleEl.innerHTML = c.title;
        titleEl.className = c.titleCls;
        if (mode === "Returned") titleEl.style.color = "#c2410c";
        else                     titleEl.style.color = "";
        document.getElementById("remarksModalText").innerText = c.text;
        const btn = document.getElementById("confirmDecisionBtn");
        btn.className = c.btnCls;
        btn.innerHTML = c.btnHtml;
        if (mode === "Returned") btn.style.background = "#f97316";
        else                     btn.style.background = "";
        /* Hide the loading spinner while the modal is up */
        document.getElementById("loadingState").classList.add("d-none");
        remarksModal = new bootstrap.Modal(document.getElementById("remarksModal"));
        remarksModal.show();
    }
       async function confirmDecision() {
        const remarks = document.getElementById("remarksInput").value.trim();

        /* Remarks are REQUIRED for both Decline and Return */
        if (!remarks) {
            document.getElementById("remarksError").classList.remove("d-none");
            return;
        }
        document.getElementById("remarksError").classList.add("d-none");

        const btn = document.getElementById("confirmDecisionBtn");
        const originalHtml = MODAL_CONFIG[decisionMode].btnHtml;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Submitting…`;

        /* Attach the remarks to the document BEFORE posting, so
           postApprovalAuth() picks them up in the payload. */
        doc.remarks = remarks;

        /* 1️⃣ Re-call the trigger API with the remarks appended */
        const triggerOk = await submitRemarks(remarks);
        if (!triggerOk) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            alert("Failed to submit. Please check your connection and try again.");
            return;
        }

        /* 2️⃣ POST to approvalauth — this is what actually records
           the reject / return on the backend. Missing before. */
        const authResult = await postApprovalAuth(doc);
        if (!authResult.ok) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            alert(authResult.message || "Failed to submit. Please try again.");
            return;
        }

        /* Show the result page */
        doc.status = decisionMode;
        remarksModal.hide();
        render(doc);

        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }


    document.addEventListener("DOMContentLoaded", async function () {
        document.getElementById("confirmDecisionBtn")
                .addEventListener("click", confirmDecision);

//        try {
//            await loadConfig();
//        } catch (error) {
//            console.error("Failed to load config:", error);
//            showError("Configuration could not be loaded. Please contact support.");
//            return;
//        }
        loadDocuments();
    });
})();