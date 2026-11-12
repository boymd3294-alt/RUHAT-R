
"use strict";

/*
 * RUHATÁR – Gyermekek modul
 * Gyermekadatok, éves keretek, vásárlások,
 * bizonylatok és nyomtatás.
 *
 * A megjelenítésért a különálló style.css felel.
 */

(() => {
    const R = window.Ruhatar;

    if (!R) {
        console.error("RUHATÁR: A központi modul nem érhető el.");
        return;
    }

    const {
        db,
        $,
        money,
        date,
        escapeHTML,
        notify,
        showModal,
        closeModal,
        state
    } = R;

    let children = [];
    let currentChild = null;
    let childPurchases = [];
    let childReceipts = [];
    let childBudgets = [];

    const CURRENT_YEAR = new Date().getFullYear();

    // ==========================================
    // SEGÉDFÜGGVÉNYEK
    // ==========================================

    function getErrorMessage(error) {
        return [
            error?.message,
            error?.details,
            error?.hint,
            error?.code ? `Kód: ${error.code}` : ""
        ].filter(Boolean).join(" | ") || "Ismeretlen adatbázishiba.";
    }

    function showLoadError(container, message) {
        if (!container) return;

        const safeMessage = escapeHTML(message);

        if (container.tagName === "TBODY") {
            container.innerHTML = `
                <tr>
                    <td colspan="8">${safeMessage}</td>
                </tr>
            `;
            return;
        }

        container.innerHTML = `
            <div class="child-empty-state">${safeMessage}</div>
        `;
    }

    function isAdmin() {
        return typeof R.isAdmin === "function" && R.isAdmin();
    }

    function canEditPurchases() {
        return typeof R.canCreatePurchase === "function"
            ? R.canCreatePurchase()
            : false;
    }

    function getBudget(category) {
        return childBudgets.find(item => item.category === category);
    }

    function getBudgetLimit(category, defaultValue) {
        return Number(getBudget(category)?.annual_limit ?? defaultValue);
    }

    function getSpent(category) {
        return childPurchases
            .filter(item => {
                if (!item.purchase_date) return false;

                const year = Number(
                    String(item.purchase_date).slice(0, 4)
                );

                return year === CURRENT_YEAR &&
                    item.category === category;
            })
            .reduce(
                (sum, item) => sum + Number(item.total_price || 0),
                0
            );
    }

    function getReceiptForPurchase(item) {
        if (!item) return null;

        if (item.receipts) return item.receipts;

        if (item.receipt_id) {
            const byId = childReceipts.find(receipt =>
                String(receipt.id) === String(item.receipt_id)
            );

            if (byId) return byId;
        }

        if (item.receipt_number) {
            return childReceipts.find(receipt =>
                String(receipt.receipt_number || "").trim() ===
                String(item.receipt_number).trim()
            ) || null;
        }

        return null;
    }

    function getPurchaseReceiptNumber(item) {
        const receipt = getReceiptForPurchase(item);

        return item.receipt_number ||
            receipt?.receipt_number ||
            "–";
    }

    function getPurchaseStatus(item) {
        const receipt = getReceiptForPurchase(item);

        const status =
            receipt?.review_status ||
            item.review_status ||
            item.status ||
            "recorded";

        return typeof R.getStatusName === "function"
            ? R.getStatusName(status)
            : status;
    }

    function getCategoryName(category) {
        return category === "sports"
            ? "Sport"
            : "Ruhanemű / lábbeli";
    }

    function refreshDashboard() {
        return typeof R.loadDashboard === "function"
            ? R.loadDashboard()
            : Promise.resolve();
    }

    function getInitials(name) {
        return String(name || "")
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(part => part.charAt(0).toLocaleUpperCase("hu"))
            .join("") || "GY";
    }

    // ==========================================
    // ADMINISZTRÁCIÓS GOMBOK
    // ==========================================

    function ensureManagementControls() {
        const detail = $("childDetail");
        if (!detail) return;

        let controls = $("childManagementControls");

        if (!controls) {
            controls = document.createElement("div");
            controls.id = "childManagementControls";
            controls.className = "child-management-controls";
            detail.prepend(controls);
        }

        controls.hidden = !isAdmin();

        if (!isAdmin()) {
            controls.innerHTML = "";
            return;
        }

        controls.innerHTML = `
            <button type="button"
                class="secondary-button"
                id="editCurrentChildButton">
                Gyermek adatainak szerkesztése
            </button>

            <button type="button"
                class="secondary-button"
                id="editChildBudgetsButton">
                Éves keretek módosítása
            </button>

            <button type="button"
                class="danger-button"
                id="archiveCurrentChildButton">
                Gyermek archiválása
            </button>
        `;

        $("editCurrentChildButton")?.addEventListener(
            "click",
            editCurrentChild
        );

        $("editChildBudgetsButton")?.addEventListener(
            "click",
            editChildBudgets
        );

        $("archiveCurrentChildButton")?.addEventListener(
            "click",
            () => {
                if (currentChild) {
                    archiveChild(currentChild.id);
                }
            }
        );
    }

    // ==========================================
    // NYOMTATÁSI GOMBOK
    // ==========================================

    function ensurePrintControls() {
        const detail = $("childDetail");
        if (!detail) return;

        let controls = $("childPrintControls");

        if (!controls) {
            controls = document.createElement("section");
            controls.id = "childPrintControls";
            controls.className = "child-print-controls";

            const management = $("childManagementControls");

            if (management) {
                management.after(controls);
            } else {
                detail.prepend(controls);
            }
        }

        const years = Array.from(
            { length: 11 },
            (_, index) => CURRENT_YEAR - 5 + index
        );

        controls.innerHTML = `
            <div class="child-print-heading">
                <h3>Költségelszámolások</h3>
                <p>
                    Válaszd ki az elszámolási évet
                    és a nyomtatvány típusát.
                </p>
            </div>

            <label for="childPrintYear">Elszámolási év</label>

            <select id="childPrintYear">
                ${years.map(year => `
                    <option value="${year}"
                        ${year === CURRENT_YEAR ? "selected" : ""}>
                        ${year}
                    </option>
                `).join("")}
            </select>

            <div class="child-print-buttons">
                <button type="button"
                    class="secondary-button"
                    data-child-print="clothing">
                    Ruházati költségelszámolás nyomtatása
                </button>

                <button type="button"
                    class="secondary-button"
                    data-child-print="sports">
                    Sportköltségelszámolás nyomtatása
                </button>

                <button type="button"
                    class="primary-button"
                    data-child-print="detailed">
                    Részletes költségkimutatás nyomtatása
                </button>
            </div>
        `;

        if (controls.dataset.initialized !== "true") {
            controls.addEventListener(
                "click",
                handlePrintButtonClick
            );

            controls.dataset.initialized = "true";
        }
    }

    function handlePrintButtonClick(event) {
        const button = event.target.closest("[data-child-print]");
        if (!button) return;

        if (!currentChild) {
            notify("Nincs kiválasztott gyermek.", "error");
            return;
        }

        const year = Number($("childPrintYear")?.value);
        const type = button.dataset.childPrint;

        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            notify("Érvénytelen elszámolási év.", "error");
            return;
        }

        printChildCostReport(type, year);
    }

    // ==========================================
    // NYOMTATÁSI SEGÉDFÜGGVÉNYEK
    // ==========================================

    function printEscape(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function printDate(value) {
        if (!value) return "";

        const result = date(value);

        return printEscape(result === "–" ? "" : result);
    }

    function printMoney(value) {
        return printEscape(money(Number(value || 0)));
    }

    function getYearPurchases(year, category = null) {
        return childPurchases
            .filter(item => {
                const purchaseYear = Number(
                    String(item.purchase_date || "").slice(0, 4)
                );

                return purchaseYear === year &&
                    (!category || item.category === category);
            })
            .sort((a, b) =>
                String(a.purchase_date || "").localeCompare(
                    String(b.purchase_date || "")
                )
            );
    }

    async function getPrintBudget(category, year) {
        const { data, error } = await db
            .from("child_budgets")
            .select("annual_limit")
            .eq("child_id", currentChild.id)
            .eq("budget_year", year)
            .eq("category", category)
            .maybeSingle();

        if (error) throw error;

        return Number(data?.annual_limit || 0);
    }

    // ==========================================
    // KÖLTSÉGELSZÁMOLÁS NYOMTATÁSA
    // ==========================================

    async function printChildCostReport(type, year) {
        if (!currentChild) return;

        if (!["clothing", "sports", "detailed"].includes(type)) {
            notify("Ismeretlen nyomtatványtípus.", "error");
            return;
        }

        const printWindow = window.open("", "_blank");

        if (!printWindow) {
            notify(
                "A böngésző blokkolta a nyomtatási ablakot. " +
                "Engedélyezd a felugró ablakokat.",
                "error"
            );
            return;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="hu">
            <head>
                <meta charset="UTF-8">
                <title>RUHATÁR – Nyomtatás</title>
            </head>
            <body>
                <p>Nyomtatvány előkészítése...</p>
            </body>
            </html>
        `);

        printWindow.document.close();

        try {
            const category =
                type === "clothing" ? "clothing" :
                type === "sports" ? "sports" : null;

            const purchases = getYearPurchases(year, category);

            const budget = category
                ? await getPrintBudget(category, year)
                : null;

            const total = purchases.reduce(
                (sum, item) =>
                    sum + Number(item.total_price || 0),
                0
            );

            const title =
                type === "clothing"
                    ? `${year}. évi ruházati költségelszámolás`
                    : type === "sports"
                        ? `${year}. évi sportköltségelszámolás`
                        : `${year}. évi részletes költségkimutatás`;

            const detailed = type === "detailed";

            const rows = purchases.map(item => {
                const receiptNumber = getPurchaseReceiptNumber(item);

                return `
                    <tr>
                        <td>${printDate(item.purchase_date)}</td>
                        <td>${printEscape(
                            receiptNumber === "–" ? "" : receiptNumber
                        )}</td>
                        <td>${printEscape(item.product_name || "")}</td>
                        <td class="center">
                            ${printEscape(item.quantity ?? "")}
                        </td>
                        <td class="right">
                            ${printMoney(item.total_price)}
                        </td>
                        <td class="signature-cell"></td>
                        <td class="signature-cell"></td>
                        <td class="signature-cell"></td>
                        <td class="signature-cell"></td>
                        ${detailed ? `
                            <td>
                                ${printEscape(
                                    getCategoryName(item.category)
                                )}
                            </td>
                            <td>
                                ${printEscape(getPurchaseStatus(item))}
                            </td>
                        ` : ""}
                    </tr>
                `;
            }).join("");

            const emptyColspan = detailed ? 11 : 9;

            const reportHtml = `
                <!DOCTYPE html>
                <html lang="hu">
                <head>
                    <meta charset="UTF-8">
                    <title>${printEscape(title)}</title>

                    <style>
                        @page {
                            size: A4 landscape;
                            margin: 12mm;
                        }

                        * {
                            box-sizing: border-box;
                        }

                        body {
                            font-family: Arial, sans-serif;
                            color: #111;
                            font-size: 10px;
                            margin: 0;
                        }

                        h1 {
                            text-align: center;
                            font-size: 18px;
                            margin: 5px 0 22px;
                        }

                        .child-name {
                            margin-bottom: 12px;
                            font-size: 13px;
                        }

                        .amount {
                            font-weight: bold;
                            font-size: 13px;
                            margin-bottom: 18px;
                        }

                        .budget {
                            margin-bottom: 12px;
                        }

                        table {
                            width: 100%;
                            border-collapse: collapse;
                            table-layout: fixed;
                        }

                        th, td {
                            border: 1px solid #333;
                            padding: 6px 4px;
                            vertical-align: middle;
                            overflow-wrap: anywhere;
                        }

                        th {
                            text-align: center;
                            background: #eee;
                        }

                        thead {
                            display: table-header-group;
                        }

                        tr {
                            page-break-inside: avoid;
                        }

                        .center {
                            text-align: center;
                        }

                        .right {
                            text-align: right;
                        }

                        .signature-cell {
                            height: 36px;
                        }

                        .closing {
                            margin-top: 30px;
                            font-size: 12px;
                            page-break-inside: avoid;
                        }

                        .signatures {
                            display: flex;
                            justify-content: space-between;
                            margin-top: 55px;
                            page-break-inside: avoid;
                        }

                        .signature {
                            width: 40%;
                            text-align: center;
                            border-top: 1px solid #111;
                            padding-top: 8px;
                        }

                        .print-actions {
                            margin-bottom: 15px;
                            text-align: right;
                        }

                        .print-actions button {
                            padding: 10px 20px;
                            cursor: pointer;
                        }

                        @media print {
                            .print-actions {
                                display: none;
                            }
                        }
                    </style>
                </head>

                <body>
                    <div class="print-actions">
                        <button onclick="window.print()">
                            Nyomtatás / PDF mentése
                        </button>
                    </div>

                    <h1>${printEscape(title)}</h1>

                    <div class="child-name">
                        <strong>Gyermek neve:</strong>
                        ${printEscape(currentChild.full_name)}
                    </div>

                    ${!detailed ? `
                        <div class="amount">
                            Elszámolandó összeg: ${printMoney(total)}
                        </div>

                        <div class="budget">
                            Éves keret: ${printMoney(budget)}
                            &nbsp;&nbsp;&nbsp;
                            Fennmaradó keret:
                            ${printMoney(Number(budget) - total)}
                        </div>
                    ` : `
                        <div class="amount">
                            Összes elszámolt költség:
                            ${printMoney(total)}
                        </div>
                    `}

                    <table>
                        <thead>
                            <tr>
                                <th rowspan="2">
                                    Vásárlás időpontja<br>
                                    (számla/nyugta kelte)
                                </th>

                                <th rowspan="2">
                                    Nyugta/számla sorszáma
                                </th>

                                <th rowspan="2">
                                    ${type === "sports"
                                        ? "Sporteszköz/felszerelés megnevezése"
                                        : "Ruhanemű/lábbeli megnevezése"}
                                    <br>
                                    (nyugta/számla szerint)
                                </th>

                                <th rowspan="2">Mennyisége</th>
                                <th rowspan="2">Vételára</th>

                                <th colspan="2">
                                    Átvétel igazolása<br>
                                    (gyermek aláírása)
                                </th>

                                <th colspan="2">Ellenőrzés</th>

                                ${detailed ? `
                                    <th rowspan="2">Kategória</th>
                                    <th rowspan="2">Állapot</th>
                                ` : ""}
                            </tr>

                            <tr>
                                <th>Dátum</th>
                                <th>Aláírás</th>
                                <th>Dátum</th>
                                <th>Aláírás</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${rows || `
                                <tr>
                                    <td colspan="${emptyColspan}"
                                        class="empty-print-row">
                                        Ebben az évben nincs rögzített vásárlás.
                                    </td>
                                </tr>
                            `}
                        </tbody>
                    </table>

                    ${!detailed ? `
                        <div class="closing">
                            Lezárás: ............................
                            ${year}. december ........-én
                        </div>

                        <div class="signatures">
                            <div class="signature">Nevelőszülő</div>
                            <div class="signature">
                                Nevelőszülői tanácsadó
                            </div>
                        </div>
                    ` : ""}
                </body>
                </html>
            `;

            printWindow.document.open();
            printWindow.document.write(reportHtml);
            printWindow.document.close();
            printWindow.focus();

        } catch (error) {
            console.error("Nyomtatási hiba:", error);

            printWindow.close();

            notify(
                "A költségkimutatás elkészítése sikertelen: " +
                getErrorMessage(error),
                "error"
            );
        }
    }

    // ==========================================
    // GYERMEKLISTA BETÖLTÉSE
    // ==========================================

    async function loadChildren() {
        const container = $("childrenList");

        if (container) {
            container.innerHTML = `
                <div class="child-empty-state">
                    Gyermekek betöltése...
                </div>
            `;
        }

        try {
            const { data, error } = await db
                .from("children")
                .select(`
                    id,
                    full_name,
                    birth_date,
                    archived_at,
                    created_at
                `)
                .is("archived_at", null)
                .order("full_name", { ascending: true });

            if (error) throw error;

            children = data || [];

            renderChildren();

            console.log(
                "RUHATÁR – Betöltött gyermekek:",
                children.length
            );

        } catch (error) {
            console.error("Gyermeklista betöltési hiba:", error);

            showLoadError(
                container,
                "A gyermeklista betöltése sikertelen: " +
                getErrorMessage(error)
            );

            notify(
                "Gyermeklista betöltése sikertelen: " +
                getErrorMessage(error),
                "error"
            );
        }
    }

    // ==========================================
    // GYERMEKLISTA MEGJELENÍTÉSE
    // ==========================================

    function renderChildren() {
        const container = $("childrenList");
        if (!container) return;

        const search = ($("childSearch")?.value || "")
            .trim()
            .toLocaleLowerCase("hu");

        const filtered = children.filter(child =>
            String(child.full_name || "")
                .toLocaleLowerCase("hu")
                .includes(search)
        );

        if (!filtered.length) {
            container.innerHTML = `
                <div class="child-empty-state">
                    ${search
                        ? "Nem található ilyen gyermek."
                        : "Még nincs nyilvántartott gyermek."}
                </div>
            `;
            return;
        }

        container.innerHTML = filtered.map(child => `
            <article class="child-card">
                <div class="child-card-header">
                    <div class="child-avatar">
                        ${escapeHTML(getInitials(child.full_name))}
                    </div>

                    <div>
                        <h3>${escapeHTML(child.full_name)}</h3>
                    </div>
                </div>

                <p class="child-card-birth">
                    <span aria-hidden="true">📅</span>
                    Születési dátum: ${date(child.birth_date)}
                </p>

                <div class="child-card-actions">
                    <button type="button"
                        class="primary-button"
                        data-child-open="${escapeHTML(child.id)}">
                        Adatlap megnyitása
                    </button>

                    ${isAdmin() ? `
                        <button type="button"
                            class="secondary-button"
                            data-child-edit="${escapeHTML(child.id)}">
                            Szerkesztés
                        </button>

                        <button type="button"
                            class="danger-button"
                            data-child-archive="${escapeHTML(child.id)}">
                            Archiválás
                        </button>
                    ` : ""}
                </div>
            </article>
        `).join("");
    }

    // ==========================================
    // GYERMEK ADATAINAK BETÖLTÉSE
    // ==========================================

    async function loadChildData(childId) {
        const [
            purchaseResult,
            receiptResult,
            budgetResult
        ] = await Promise.all([
            db.from("purchase_items")
                .select("*")
                .eq("child_id", childId)
                .order("purchase_date", { ascending: false }),

            db.from("receipts")
                .select("*")
                .eq("child_id", childId)
                .order("created_at", { ascending: false }),

            db.from("child_budgets")
                .select("*")
                .eq("child_id", childId)
                .eq("budget_year", CURRENT_YEAR)
        ]);

        if (purchaseResult.error) throw purchaseResult.error;
        if (receiptResult.error) throw receiptResult.error;
        if (budgetResult.error) throw budgetResult.error;

        childPurchases = purchaseResult.data || [];
        childReceipts = receiptResult.data || [];
        childBudgets = budgetResult.data || [];

        const receiptsById = new Map(
            childReceipts.map(receipt => [
                String(receipt.id),
                receipt
            ])
        );

        const receiptsByNumber = new Map(
            childReceipts
                .filter(receipt => receipt.receipt_number)
                .map(receipt => [
                    String(receipt.receipt_number).trim(),
                    receipt
                ])
        );

        childPurchases = childPurchases.map(item => {
            const receipt =
                (item.receipt_id
                    ? receiptsById.get(String(item.receipt_id))
                    : null) ||
                (item.receipt_number
                    ? receiptsByNumber.get(
                        String(item.receipt_number).trim()
                    )
                    : null);

            return {
                ...item,
                receipts: receipt || null
            };
        });

        renderBudgets();
        renderChildPurchases();

        await renderChildReceipts();
    }

    // ==========================================
    // ÉVES KERETEK MEGJELENÍTÉSE
    // ==========================================

    function renderBudgets() {
        if (!currentChild) return;

        const detail = $("childDetail");
        if (!detail) return;

        const clothingLimit = getBudgetLimit("clothing", 200000);
        const sportsLimit = getBudgetLimit("sports", 50000);

        const clothingSpent = getSpent("clothing");
        const sportsSpent = getSpent("sports");

        const clothingRemaining = clothingLimit - clothingSpent;
        const sportsRemaining = sportsLimit - sportsSpent;

        function renderBudgetCard({
            category,
            title,
            icon,
            limit,
            spent,
            remaining
        }) {
            const percentage = limit > 0
                ? Math.min(100, Math.max(0, spent / limit * 100))
                : 0;

            return `
                <article class="child-budget-card ${category}">
                    <div class="child-budget-title">
                        <span class="child-budget-icon">${icon}</span>
                        ${title}
                    </div>

                    <strong class="child-budget-amount">
                        ${money(limit)}
                    </strong>

                    <div class="child-budget-remaining">
                        <span>Felhasználva: ${money(spent)}</span>
                        <span>Maradék: ${money(remaining)}</span>
                    </div>

                    <div class="child-budget-progress">
                        <span data-progress="${percentage.toFixed(1)}"></span>
                    </div>

                    <div class="child-budget-footnote">
                        ${percentage.toFixed(1)}% felhasználva az éves keretből
                    </div>
                </article>
            `;
        }

        const budgetHtml = `
            ${renderBudgetCard({
                category: "clothing",
                title: "Ruhanemű / lábbeli keret",
                icon: "👕",
                limit: clothingLimit,
                spent: clothingSpent,
                remaining: clothingRemaining
            })}

            ${renderBudgetCard({
                category: "sports",
                title: "Sportkeret",
                icon: "⚽",
                limit: sportsLimit,
                spent: sportsSpent,
                remaining: sportsRemaining
            })}
        `;

        // Egyetlen stabil keretkonténer használata.
        let grid = $("childBudgetGrid");

        if (!grid) {
            grid = document.createElement("div");
            grid.id = "childBudgetGrid";
            grid.className = "child-budget-grid";

            const birthDate = $("childDetailBirthDate");

            if (birthDate?.parentElement) {
                birthDate.parentElement.after(grid);
            } else {
                detail.prepend(grid);
            }
        }

        // Esetleges régi, duplikált konténerek eltávolítása.
        document.querySelectorAll("#childBudgetGrid").forEach(element => {
            if (element !== grid) {
                element.remove();
            }
        });

        grid.innerHTML = budgetHtml;

        grid.querySelectorAll("[data-progress]").forEach(element => {
            const percentage = Number(element.dataset.progress || 0);
            element.style.width = `${percentage}%`;
        });
    }

    // ==========================================
    // ÉVES KERETEK MÓDOSÍTÁSA
    // ==========================================

    function editChildBudgets() {
        if (!isAdmin()) {
            notify(
                "A kereteket csak adminisztrátor módosíthatja.",
                "error"
            );
            return;
        }

        if (!currentChild) {
            notify("Nincs kiválasztott gyermek.", "error");
            return;
        }

        const clothingLimit = getBudgetLimit("clothing", 200000);
        const sportsLimit = getBudgetLimit("sports", 50000);

        showModal(`
            <h2>Éves keretek módosítása</h2>
            <p>${escapeHTML(currentChild.full_name)}</p>
            <p><strong>${CURRENT_YEAR}. évi keretek</strong></p>

            <form id="childBudgetForm">
                <label for="newClothingLimit">
                    Ruhanemű / lábbeli keret (Ft)
                </label>

                <input id="newClothingLimit"
                    type="number"
                    min="0"
                    step="1"
                    value="${clothingLimit}"
                    required>

                <label for="newSportsLimit">Sportkeret (Ft)</label>

                <input id="newSportsLimit"
                    type="number"
                    min="0"
                    step="1"
                    value="${sportsLimit}"
                    required>

                <button type="submit" class="primary-button">
                    Keretek mentése
                </button>
            </form>
        `);

        $("childBudgetForm")?.addEventListener(
            "submit",
            saveChildBudgets
        );
    }

    async function saveChildBudgets(event) {
        event.preventDefault();

        if (!isAdmin() || !currentChild) return;

        const clothingValue = $("newClothingLimit")?.value;
        const sportsValue = $("newSportsLimit")?.value;

        const clothingLimit = Number(clothingValue);
        const sportsLimit = Number(sportsValue);

        if (
            clothingValue === "" ||
            sportsValue === "" ||
            !Number.isSafeInteger(clothingLimit) ||
            !Number.isSafeInteger(sportsLimit) ||
            clothingLimit < 0 ||
            sportsLimit < 0
        ) {
            notify(
                "Érvénytelen keretösszeg. " +
                "Csak nulla vagy pozitív egész szám adható meg.",
                "error"
            );
            return;
        }

        const button = $("childBudgetForm")
            ?.querySelector('button[type="submit"]');

        if (button) {
            button.disabled = true;
            button.textContent = "Mentés...";
        }

        try {
            await saveSingleBudget("clothing", clothingLimit);
            await saveSingleBudget("sports", sportsLimit);

            await loadChildData(currentChild.id);

            closeModal();

            notify("Az éves keretek sikeresen módosítva.");

        } catch (error) {
            console.error("Keretmentési hiba:", error);

            notify(
                "A keretek mentése sikertelen: " +
                getErrorMessage(error),
                "error"
            );

            if (button) {
                button.disabled = false;
                button.textContent = "Keretek mentése";
            }
        }
    }

    async function saveSingleBudget(category, amount) {
        const existing = childBudgets.find(item =>
            item.category === category &&
            Number(item.budget_year) === CURRENT_YEAR
        );

        if (existing) {
            const { error } = await db
                .from("child_budgets")
                .update({ annual_limit: amount })
                .eq("id", existing.id);

            if (error) throw error;

        } else {
            const { error } = await db
                .from("child_budgets")
                .insert({
                    child_id: currentChild.id,
                    budget_year: CURRENT_YEAR,
                    category,
                    annual_limit: amount
                });

            if (error) throw error;
        }
    }

    // ==========================================
    // GYERMEK VÁSÁRLÁSI TÁBLÁZATA
    // ==========================================

    function renderChildPurchases() {
        const container = $("childPurchaseTable");
        if (!container) return;

        const table = container.closest("table");

        if (
            table &&
            !table.parentElement.classList.contains(
                "child-purchase-table-wrap"
            )
        ) {
            const wrapper = document.createElement("div");
            wrapper.className = "child-purchase-table-wrap";

            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
        }

        if (table) {
            table.classList.add("child-purchase-table");
        }

        if (!childPurchases.length) {
            container.innerHTML = `
                <tr>
                    <td colspan="8" class="child-purchase-empty">
                        <div class="child-empty-icon">🧾</div>
                        <strong>Még nincs rögzített vásárlás.</strong>
                        <div class="child-empty-description">
                            A gyermek vásárlásai itt fognak megjelenni.
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        container.innerHTML = childPurchases.map(item => `
            <tr>
                <td>${date(item.purchase_date)}</td>

                <td>
                    ${escapeHTML(getPurchaseReceiptNumber(item))}
                </td>

                <td>
                    <strong>
                        ${escapeHTML(item.product_name || "–")}
                    </strong>
                </td>

                <td>${escapeHTML(item.quantity ?? "–")}</td>

                <td>
                    <strong>${money(item.total_price)}</strong>
                </td>

                <td>
                    ${escapeHTML(getCategoryName(item.category))}
                </td>

                <td>
                    <span class="child-status">
                        ${escapeHTML(getPurchaseStatus(item))}
                    </span>
                </td>

                <td>
                    ${canEditPurchases() ? `
                        <button type="button"
                            class="secondary-button"
                            data-child-purchase-edit="${escapeHTML(item.id)}">
                            Szerkesztés
                        </button>
                    ` : "–"}
                </td>
            </tr>
        `).join("");
    }

    // ==========================================
    // GYERMEK BIZONYLATAI
    // ==========================================

    async function renderChildReceipts() {
        const container = $("childReceiptsList");
        if (!container) return;

        container.classList.add("child-receipts-grid");

        if (!childReceipts.length) {
            container.innerHTML = `
                <div class="child-empty-state">
                    <div class="child-empty-icon">📄</div>
                    <strong>Még nincs feltöltött bizonylat.</strong>
                    <p class="child-empty-description">
                        A gyermekhez feltöltött számlák és nyugták
                        itt lesznek elérhetők.
                    </p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="child-empty-state">
                Bizonylatok betöltése...
            </div>
        `;

        const results = await Promise.all(
            childReceipts.map(async receipt => {
                try {
                    const { data, error } = await db.storage
                        .from("receipts")
                        .createSignedUrl(receipt.file_path, 300);

                    if (error) throw error;

                    return {
                        receipt,
                        url: data?.signedUrl || null
                    };

                } catch (error) {
                    console.error(
                        "Bizonylat URL hiba:",
                        receipt.id,
                        error
                    );

                    return {
                        receipt,
                        url: null
                    };
                }
            })
        );

        container.innerHTML = results.map(({ receipt, url }) => `
            <article class="receipt-card">
                <div class="receipt-card-header">
                    <div class="receipt-card-icon">📄</div>

                    <h4>
                        ${escapeHTML(
                            receipt.merchant ||
                            receipt.original_filename ||
                            "Bizonylat"
                        )}
                    </h4>
                </div>

                <p>
                    Fájlnév:
                    ${escapeHTML(receipt.original_filename || "–")}
                </p>

                <p>
                    Bizonylatszám:
                    ${escapeHTML(receipt.receipt_number || "–")}
                </p>

                <p>
                    Dátum:
                    ${date(receipt.purchase_date)}
                </p>

                <strong class="receipt-amount">
                    ${money(receipt.total_amount)}
                </strong>

                ${url ? `
                    <a href="${escapeHTML(url)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="secondary-button">
                        Bizonylat megnyitása
                    </a>
                ` : `
                    <span class="child-status">
                        A bizonylat jelenleg nem érhető el.
                    </span>
                `}
            </article>
        `).join("");
    }

    // ==========================================
    // GYERMEK ADATLAP MEGNYITÁSA
    // ==========================================

    async function openChild(childId) {
        const child = children.find(
            item => String(item.id) === String(childId)
        );

        if (!child) {
            notify("A gyermek nem található.", "error");
            return;
        }

        currentChild = child;

        if (state) {
            state.currentChild = child;
        }

        if ($("childDetailName")) {
            $("childDetailName").textContent =
                child.full_name || "Gyermek adatlapja";
        }

        if ($("childDetailBirthDate")) {
            $("childDetailBirthDate").textContent =
                date(child.birth_date);
        }

        if ($("childDetail")) {
            $("childDetail").hidden = false;
        }

        ensureManagementControls();
        ensurePrintControls();

        if ($("childPurchaseTable")) {
            $("childPurchaseTable").innerHTML = `
                <tr>
                    <td colspan="8">Adatok betöltése...</td>
                </tr>
            `;
        }

        if ($("childReceiptsList")) {
            $("childReceiptsList").innerHTML = `
                <div class="child-empty-state">
                    Bizonylatok betöltése...
                </div>
            `;
        }

        try {
            await loadChildData(childId);

        } catch (error) {
            console.error("Gyermek adatlap hiba:", error);

            notify(
                "A gyermek adatainak betöltése sikertelen: " +
                getErrorMessage(error),
                "error"
            );

            showLoadError(
                $("childPurchaseTable"),
                "A vásárlások betöltése sikertelen."
            );

            showLoadError(
                $("childReceiptsList"),
                "A bizonylatok betöltése sikertelen."
            );
        }

        $("childDetail")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    // ==========================================
    // GYERMEK ADATAINAK SZERKESZTÉSE
    // ==========================================

    function editChild(childId) {
        if (!isAdmin()) {
            notify(
                "Gyermekadatokat csak adminisztrátor módosíthat.",
                "error"
            );
            return;
        }

        const child = children.find(
            item => String(item.id) === String(childId)
        );

        if (!child) {
            notify("A gyermek nem található.", "error");
            return;
        }

        showModal(`
            <h2>Gyermek adatainak szerkesztése</h2>

            <form id="editChildForm">
                <label for="editChildName">Teljes név</label>

                <input id="editChildName"
                    type="text"
                    maxlength="200"
                    value="${escapeHTML(child.full_name || "")}"
                    required>

                <label for="editChildBirthDate">
                    Születési dátum
                </label>

                <input id="editChildBirthDate"
                    type="date"
                    value="${escapeHTML(child.birth_date || "")}">

                <button type="submit" class="primary-button">
                    Módosítások mentése
                </button>
            </form>
        `);

        $("editChildForm")?.addEventListener(
            "submit",
            async event => {
                event.preventDefault();

                const name = $("editChildName")?.value.trim();

                const birthDate =
                    $("editChildBirthDate")?.value || null;

                if (!name) {
                    notify("A gyermek neve kötelező.", "error");
                    return;
                }

                const button = $("editChildForm")
                    ?.querySelector('button[type="submit"]');

                if (button) {
                    button.disabled = true;
                    button.textContent = "Mentés...";
                }

                try {
                    const { error } = await db
                        .from("children")
                        .update({
                            full_name: name,
                            birth_date: birthDate
                        })
                        .eq("id", childId);

                    if (error) throw error;

                    closeModal();

                    notify("A gyermek adatai módosítva.");

                    await loadChildren();

                    if (currentChild?.id === childId) {
                        currentChild = children.find(
                            item => item.id === childId
                        ) || null;

                        if (currentChild) {
                            if (state) {
                                state.currentChild = currentChild;
                            }

                            await openChild(childId);
                        }
                    }

                } catch (error) {
                    console.error(
                        "Gyermekmódosítási hiba:",
                        error
                    );

                    notify(
                        "A gyermek módosítása sikertelen: " +
                        getErrorMessage(error),
                        "error"
                    );

                    if (button) {
                        button.disabled = false;
                        button.textContent = "Módosítások mentése";
                    }
                }
            }
        );
    }

    function editCurrentChild() {
        if (currentChild) {
            editChild(currentChild.id);
        }
    }

    // ==========================================
    // GYERMEK ARCHIVÁLÁSA
    // ==========================================

    async function archiveChild(childId) {
        if (!isAdmin()) {
            notify(
                "Gyermeket csak adminisztrátor archiválhat.",
                "error"
            );
            return;
        }

        const child = children.find(
            item => String(item.id) === String(childId)
        );

        if (!child) {
            notify("A gyermek nem található.", "error");
            return;
        }

        const confirmed = window.confirm(
            `Biztosan archiválod ezt a gyermeket?\n\n` +
            `${child.full_name}\n\n` +
            `A gyermek eltűnik az aktív listából, ` +
            `de a korábbi vásárlásai és bizonylatai megmaradnak.`
        );

        if (!confirmed) return;

        try {
            const { error } = await db
                .from("children")
                .update({
                    archived_at: new Date().toISOString()
                })
                .eq("id", childId);

            if (error) throw error;

            if (currentChild?.id === childId) {
                currentChild = null;

                if (state) {
                    state.currentChild = null;
                }

                if ($("childDetail")) {
                    $("childDetail").hidden = true;
                }
            }

            await loadChildren();
            await refreshDashboard();

            notify(
                "A gyermek sikeresen archiválva. " +
                "A korábbi adatok megmaradtak."
            );

        } catch (error) {
            console.error("Gyermek archiválási hiba:", error);

            notify(
                "A gyermek archiválása sikertelen: " +
                getErrorMessage(error),
                "error"
            );
        }
    }

    // ==========================================
    // ÚJ GYERMEK LÉTREHOZÁSA
    // ==========================================

    async function addChild() {
        if (!isAdmin()) {
            notify(
                "Gyermeket csak adminisztrátor hozhat létre.",
                "error"
            );
            return;
        }

        try {
            const { data: fosterParents, error } = await db
                .from("profiles")
                .select("id, full_name")
                .eq("role", "foster_parent")
                .eq("status", "approved")
                .order("full_name");

            if (error) throw error;

            if (!fosterParents?.length) {
                notify(
                    "Nincs jóváhagyott nevelőszülő a rendszerben.",
                    "error"
                );
                return;
            }

            const fosterParentOptions = fosterParents.map(user => `
                <option value="${escapeHTML(user.id)}">
                    ${escapeHTML(user.full_name || "Névtelen")}
                </option>
            `).join("");

            showModal(`
                <h2>Új gyermek hozzáadása</h2>

                <form id="childForm">
                    <label for="newChildName">Teljes név</label>

                    <input id="newChildName"
                        type="text"
                        maxlength="200"
                        placeholder="Gyermek teljes neve"
                        required>

                    <label for="newChildBirthDate">
                        Születési dátum
                    </label>

                    <input id="newChildBirthDate" type="date">

                    <label for="newChildFosterParent">
                        Nevelőszülő
                    </label>

                    <select id="newChildFosterParent" required>
                        <option value="">
                            Válassz nevelőszülőt
                        </option>
                        ${fosterParentOptions}
                    </select>

                    <button type="submit" class="primary-button">
                        Gyermek létrehozása
                    </button>
                </form>
            `);

            $("childForm")?.addEventListener(
                "submit",
                async event => {
                    event.preventDefault();

                    const form = $("childForm");

                    const submitButton = form?.querySelector(
                        'button[type="submit"]'
                    );

                    if (submitButton?.disabled) return;

                    const fullName =
                        $("newChildName")?.value.trim();

                    const birthDate =
                        $("newChildBirthDate")?.value || null;

                    const fosterParentId =
                        $("newChildFosterParent")?.value;

                    if (!fullName || !fosterParentId) {
                        notify(
                            "Add meg a gyermek nevét és válassz nevelőszülőt.",
                            "error"
                        );
                        return;
                    }

                    const userId = state?.user?.id;

                    if (!userId) {
                        notify(
                            "A bejelentkezett felhasználó nem azonosítható.",
                            "error"
                        );
                        return;
                    }

                    if (submitButton) {
                        submitButton.disabled = true;
                        submitButton.textContent = "Létrehozás...";
                    }

                    try {
                        const {
                            data: child,
                            error: childError
                        } = await db
                            .from("children")
                            .insert({
                                full_name: fullName,
                                birth_date: birthDate,
                                created_by: userId
                            })
                            .select()
                            .single();

                        if (childError) throw childError;

                        const { error: assignmentError } = await db
                            .from("child_assignments")
                            .insert({
                                child_id: child.id,
                                user_id: fosterParentId,
                                assignment_type: "foster_parent"
                            });

                        if (assignmentError) {
                            console.error(
                                "Hozzárendelési hiba:",
                                assignmentError
                            );

                            notify(
                                "A gyermek létrejött, de a nevelőszülő " +
                                "hozzárendelése sikertelen. Ne hozd létre újra!",
                                "error"
                            );

                            await loadChildren();
                            return;
                        }

                        closeModal();

                        notify("A gyermek sikeresen létrehozva.");

                        await loadChildren();
                        await refreshDashboard();

                    } catch (error) {
                        console.error(
                            "Gyermek létrehozási hiba:",
                            error
                        );

                        notify(
                            "A gyermek létrehozása sikertelen: " +
                            getErrorMessage(error),
                            "error"
                        );

                    } finally {
                        if (submitButton?.isConnected) {
                            submitButton.disabled = false;
                            submitButton.textContent =
                                "Gyermek létrehozása";
                        }
                    }
                }
            );

        } catch (error) {
            console.error(
                "Nevelőszülők betöltési hiba:",
                error
            );

            notify(
                "Hiba történt: " + getErrorMessage(error),
                "error"
            );
        }
    }

    // ==========================================
    // ADATOK FRISSÍTÉSE
    // ==========================================

    async function refresh() {
        if (!currentChild) {
            await loadChildren();
            return;
        }

        await loadChildData(currentChild.id);
    }

    // ==========================================
    // ESEMÉNYKEZELŐK
    // ==========================================

    function initialize() {
        $("addChildButton")?.addEventListener(
            "click",
            addChild
        );

        $("childSearch")?.addEventListener(
            "input",
            renderChildren
        );

        $("childrenList")?.addEventListener(
            "click",
            event => {
                const openButton =
                    event.target.closest("[data-child-open]");

                if (openButton) {
                    openChild(openButton.dataset.childOpen);
                    return;
                }

                const editButton =
                    event.target.closest("[data-child-edit]");

                if (editButton) {
                    editChild(editButton.dataset.childEdit);
                    return;
                }

                const archiveButton =
                    event.target.closest("[data-child-archive]");

                if (archiveButton) {
                    archiveChild(archiveButton.dataset.childArchive);
                }
            }
        );

        $("childPurchaseTable")?.addEventListener(
            "click",
            event => {
                const button = event.target.closest(
                    "[data-child-purchase-edit]"
                );

                if (!button) return;

                const purchaseId =
                    button.dataset.childPurchaseEdit;

                const purchasesModule =
                    window.RuhatarPurchases;

                if (
                    typeof purchasesModule?.openPurchaseForm === "function"
                ) {
                    purchasesModule.openPurchaseForm(purchaseId);
                } else {
                    notify(
                        "A vásárlásszerkesztő nem érhető el.",
                        "error"
                    );
                }
            }
        );

        $("childAddPurchase")?.addEventListener(
            "click",
            () => {
                if (!currentChild) {
                    notify(
                        "Először nyiss meg egy gyermek-adatlapot.",
                        "error"
                    );
                    return;
                }

                if (!canEditPurchases()) {
                    notify(
                        "Nincs jogosultságod vásárlás rögzítéséhez.",
                        "error"
                    );
                    return;
                }

                if (
                    typeof window.RuhatarPurchases
                        ?.openPurchaseForm !== "function"
                ) {
                    notify(
                        "A vásárlásrögzítő modul nem érhető el.",
                        "error"
                    );
                    return;
                }

                window.RuhatarPurchases.openPurchaseForm(
                    null,
                    currentChild.id
                );
            }
        );

        $("closeChildDetail")?.addEventListener(
            "click",
            () => {
                if ($("childDetail")) {
                    $("childDetail").hidden = true;
                }

                currentChild = null;

                if (state) {
                    state.currentChild = null;
                }
            }
        );

        window.addEventListener(
            "ruhat ar:refreshchild",
            refresh
        );
    }

    // ==========================================
    // MODUL REGISZTRÁLÁSA
    // ==========================================

    R.registerModule("children", loadChildren);

    window.RuhatarChildren = {
        loadChildren,
        openChild,
        refresh,
        addChild,
        editChild,
        archiveChild,
        editChildBudgets,
        printChildCostReport
    };

    initialize();

})();
