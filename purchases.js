
"use strict";

/*
 * RUHATÁR – Többtételes vásárlásrögzítő
 *
 * Egy bizonylathoz több termék rögzíthető.
 * A vételár a teljes terméksor ára.
 * Nincs egységár-számítás és automatikus összesítés.
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

    let purchases = [];
    let children = [];
    let receipts = [];
    let rowCounter = 0;

    const today = () => {
        const now = new Date();
        const localDate = new Date(
            now.getTime() - now.getTimezoneOffset() * 60000
        );

        return localDate.toISOString().slice(0, 10);
    };

    function getErrorMessage(error) {
        return [
            error?.message,
            error?.details,
            error?.hint,
            error?.code ? `Kód: ${error.code}` : ""
        ].filter(Boolean).join(" | ") || "Ismeretlen hiba.";
    }

    function getStatus(item) {
        return (
            item.receipts?.review_status ||
            item.review_status ||
            item.status ||
            "recorded"
        );
    }

    function getStatusName(item) {
        const status = getStatus(item);

        return typeof R.getStatusName === "function"
            ? R.getStatusName(status)
            : status;
    }

    function getReceiptNumber(item) {
        return (
            item.receipt_number ||
            item.receipts?.receipt_number ||
            ""
        );
    }

    function getReceiptForItem(item) {
        if (item.receipt_id) {
            const byId = receipts.find(
                receipt =>
                    String(receipt.id) === String(item.receipt_id)
            );

            if (byId) return byId;
        }

        const number = getReceiptNumber(item);

        if (number) {
            return receipts.find(
                receipt =>
                    String(receipt.receipt_number) === String(number)
            ) || null;
        }

        return null;
    }

    // ==========================================
    // VÁSÁRLÁSOK BETÖLTÉSE
    // ==========================================

    async function loadPurchases() {
        const container = $("purchasesTable");

        if (container) {
            container.innerHTML = `
                <tr>
                    <td colspan="9">Vásárlások betöltése...</td>
                </tr>
            `;
        }

        try {
            const [purchaseResult, receiptResult] =
                await Promise.all([

                    db.from("purchase_items")
                        .select(`
                            *,
                            children(full_name)
                        `)
                        .order("purchase_date", {
                            ascending: false
                        }),

                    db.from("receipts")
                        .select(`
                            id,
                            child_id,
                            receipt_number,
                            review_status,
                            original_filename
                        `)
                ]);

            if (purchaseResult.error) {
                throw purchaseResult.error;
            }

            if (receiptResult.error) {
                throw receiptResult.error;
            }

            receipts = receiptResult.data || [];

            purchases = (purchaseResult.data || []).map(item => ({
                ...item,
                receipts: getReceiptForItem(item)
            }));

            renderPurchases();

        } catch (error) {
            console.error(
                "Vásárlásbetöltési hiba:",
                error
            );

            if (container) {
                container.innerHTML = `
                    <tr>
                        <td colspan="9">
                            A vásárlások betöltése sikertelen:
                            ${escapeHTML(getErrorMessage(error))}
                        </td>
                    </tr>
                `;
            }

            notify(
                "A vásárlások betöltése sikertelen: " +
                getErrorMessage(error),
                "error"
            );
        }
    }

    // ==========================================
    // ŰRLAPADATOK BETÖLTÉSE
    // ==========================================

    async function loadFormData() {
        const [childResult, receiptResult] =
            await Promise.all([

                db.from("children")
                    .select("id, full_name, archived_at")
                    .is("archived_at", null)
                    .order("full_name"),

                db.from("receipts")
                    .select(`
                        id,
                        child_id,
                        original_filename,
                        receipt_number,
                        purchase_date
                    `)
                    .order("created_at", {
                        ascending: false
                    })
            ]);

        if (childResult.error) {
            throw childResult.error;
        }

        if (receiptResult.error) {
            throw receiptResult.error;
        }

        children = childResult.data || [];
        receipts = receiptResult.data || [];
    }

    // ==========================================
    // VÁSÁRLÁSOK TÁBLÁZATA
    // ==========================================

    function renderPurchases() {
        const container = $("purchasesTable");
        if (!container) return;

        const search = (
            $("purchaseSearch")?.value || ""
        ).trim().toLocaleLowerCase("hu");

        const category =
            $("purchaseCategoryFilter")?.value || "";

        const status =
            $("purchaseStatusFilter")?.value || "";

        const filtered = purchases.filter(item => {
            const childName =
                item.children?.full_name || "";

            const productName =
                item.product_name || "";

            const receiptNumber =
                getReceiptNumber(item);

            const searchable = [
                childName,
                productName,
                receiptNumber
            ].join(" ").toLocaleLowerCase("hu");

            return (
                (!search || searchable.includes(search)) &&
                (!category || item.category === category) &&
                (!status || getStatus(item) === status)
            );
        });

        container.innerHTML = filtered.length
            ? filtered.map(item => `
                <tr>
                    <td>
                        ${escapeHTML(
                            item.children?.full_name || "–"
                        )}
                    </td>

                    <td>
                        ${date(item.purchase_date)}
                    </td>

                    <td>
                        ${escapeHTML(
                            getReceiptNumber(item) || "–"
                        )}
                    </td>

                    <td>
                        ${escapeHTML(
                            item.product_name || "–"
                        )}
                    </td>

                    <td>
                        ${escapeHTML(item.quantity ?? "–")}
                    </td>

                    <td>
                        <strong>
                            ${money(item.total_price)}
                        </strong>
                    </td>

                    <td>
                        ${item.category === "sports"
                            ? "Sport"
                            : "Ruhanemű / lábbeli"}
                    </td>

                    <td>
                        ${escapeHTML(getStatusName(item))}
                    </td>

                    <td>
                        <button
                            type="button"
                            class="secondary-button"
                            data-edit-purchase="${escapeHTML(item.id)}">
                            Szerkesztés
                        </button>
                    </td>
                </tr>
            `).join("")
            : `
                <tr>
                    <td colspan="9">
                        Nincs megjeleníthető vásárlás.
                    </td>
                </tr>
            `;
    }

    // ==========================================
    // TERMÉKSOR LÉTREHOZÁSA
    // ==========================================

    function createProductRow(item = {}) {
        rowCounter++;

        const row = document.createElement("div");

        row.className = "purchase-product-row";
        row.dataset.rowId = String(rowCounter);

        row.style.cssText = `
            display:grid;
            grid-template-columns:
                minmax(180px, 2fr)
                minmax(85px, .7fr)
                minmax(120px, 1fr)
                minmax(150px, 1fr)
                40px;
            gap:10px;
            align-items:end;
            padding:14px;
            margin-bottom:12px;
            border:1px solid var(--border-color, #ddd);
            border-radius:10px;
        `;

        row.innerHTML = `
            <div>
                <label>Megnevezés (nyugta/számla szerint)</label>

                <input
                    type="text"
                    class="product-name"
                    maxlength="200"
                    placeholder="Például: Sportcipő"
                    value="${escapeHTML(item.product_name || "")}"
                    required>
            </div>

            <div>
                <label>Mennyisége</label>

                <input
                    type="number"
                    class="product-quantity"
                    min="1"
                    step="1"
                    value="${escapeHTML(item.quantity ?? 1)}"
                    required>
            </div>

            <div>
                <label>Teljes vételár (Ft)</label>

                <input
                    type="number"
                    class="product-price"
                    min="0"
                    step="1"
                    placeholder="40000"
                    value="${escapeHTML(item.total_price ?? "")}"
                    required>
            </div>

            <div>
                <label>Kategória</label>

                <select class="product-category" required>
                    <option
                        value="clothing"
                        ${item.category !== "sports" ? "selected" : ""}>
                        Ruhanemű / lábbeli
                    </option>

                    <option
                        value="sports"
                        ${item.category === "sports" ? "selected" : ""}>
                        Sport
                    </option>
                </select>
            </div>

            <div>
                <button
                    type="button"
                    class="secondary-button remove-product-row"
                    title="Terméksor törlése"
                    aria-label="Terméksor törlése">
                    ✕
                </button>
            </div>
        `;

        return row;
    }

    function addProductRow(item = {}) {
        const container = $("purchaseProductRows");
        if (!container) return;

        container.appendChild(createProductRow(item));
    }

    // ==========================================
    // BIZONYLATLISTA
    // ==========================================

    function updateReceiptOptions(
        childId,
        selectedReceiptId = ""
    ) {
        const select = $("purchaseReceipt");
        if (!select) return;

        const filtered = receipts.filter(
            receipt =>
                String(receipt.child_id) === String(childId)
        );

        select.innerHTML = `
            <option value="">
                Nincs kiválasztott bizonylat
            </option>

            ${filtered.map(receipt => `
                <option value="${escapeHTML(receipt.id)}">
                    ${escapeHTML(
                        receipt.original_filename ||
                        receipt.receipt_number ||
                        "Bizonylat"
                    )}
                    ${receipt.receipt_number
                        ? ` – ${escapeHTML(receipt.receipt_number)}`
                        : ""}
                </option>
            `).join("")}
        `;

        select.value = selectedReceiptId || "";
    }

    // ==========================================
    // VÁSÁRLÁSI ŰRLAP
    // ==========================================

    async function openPurchaseForm(
        purchaseId = null,
        presetChildId = null
    ) {
        try {
            await loadFormData();

            let existing = null;

            if (purchaseId) {
                existing = purchases.find(
                    item =>
                        String(item.id) === String(purchaseId)
                );

                if (!existing) {
                    const { data, error } = await db
                        .from("purchase_items")
                        .select(`
                            *,
                            children(full_name)
                        `)
                        .eq("id", purchaseId)
                        .maybeSingle();

                    if (error) throw error;

                    existing = data;

                    if (existing) {
                        existing.receipts =
                            getReceiptForItem(existing);
                    }
                }

                if (!existing) {
                    notify(
                        "A vásárlás nem található.",
                        "error"
                    );
                    return;
                }
            }

            const selectedChildId =
                existing?.child_id ||
                presetChildId ||
                state?.currentChild?.id ||
                "";

            if (!children.length) {
                notify(
                    "Nincs elérhető aktív gyermek.",
                    "error"
                );
                return;
            }

            if (
                selectedChildId &&
                !children.some(child =>
                    String(child.id) === String(selectedChildId)
                )
            ) {
                notify(
                    "A kiválasztott gyermek nem található az aktív gyermekek között.",
                    "error"
                );
                return;
            }

            const childOptions = children.map(child => `
                <option
                    value="${escapeHTML(child.id)}"
                    ${String(child.id) === String(selectedChildId)
                        ? "selected"
                        : ""}>
                    ${escapeHTML(child.full_name)}
                </option>
            `).join("");

            const receiptId =
                existing?.receipt_id || "";

            const existingReceiptNumber =
                existing?.receipt_number ||
                existing?.receipts?.receipt_number ||
                "";

            rowCounter = 0;

            showModal(`
                <h2>
                    ${existing
                        ? "Vásárlás szerkesztése"
                        : "Új vásárlás rögzítése"}
                </h2>

                <form id="purchaseForm">

                    <label for="purchaseChild">
                        Gyermek
                    </label>

                    <select id="purchaseChild" required>
                        <option value="">
                            Válassz gyermeket
                        </option>

                        ${childOptions}
                    </select>

                    <label for="purchaseDate">
                        Vásárlás időpontja (számla/nyugta kelte)
                    </label>

                    <input
                        id="purchaseDate"
                        type="date"
                        value="${escapeHTML(
                            existing?.purchase_date || today()
                        )}"
                        required>

                    <label for="purchaseReceiptNumber">
                        Nyugta/számla sorszáma
                    </label>

                    <input
                        id="purchaseReceiptNumber"
                        type="text"
                        maxlength="150"
                        placeholder="Például: A123456"
                        value="${escapeHTML(existingReceiptNumber)}">

                    <label for="purchaseReceipt">
                        Feltöltött bizonylat (opcionális)
                    </label>

                    <select id="purchaseReceipt">
                        <option value="">
                            Nincs kiválasztott bizonylat
                        </option>
                    </select>

                    <div style="margin-top:20px;">
                        <h3>Vásárlási tételek</h3>

                        <p>
                            Minden terméket külön sorban adj meg.
                            A vételár a teljes terméksor ára.
                        </p>
                    </div>

                    <div id="purchaseProductRows"></div>

                    <button
                        type="button"
                        id="addPurchaseProductRow"
                        class="secondary-button">
                        + Új terméksor
                    </button>

                    <div style="margin-top:20px;">
                        <button
                            type="submit"
                            class="primary-button">
                            ${existing
                                ? "Módosítás mentése"
                                : "Összes vásárlási tétel rögzítése"}
                        </button>
                    </div>

                </form>
            `);

            if (existing) {
                addProductRow(existing);
            } else {
                addProductRow();
            }

            updateReceiptOptions(
                selectedChildId,
                receiptId
            );

            // Gyermekváltáskor csak az adott gyermek bizonylatai látszanak.
            $("purchaseChild")?.addEventListener(
                "change",
                () => {
                    updateReceiptOptions(
                        $("purchaseChild").value
                    );
                }
            );

            // Kiválasztott bizonylat sorszámának átvétele.
            $("purchaseReceipt")?.addEventListener(
                "change",
                () => {
                    const selectedId =
                        $("purchaseReceipt").value;

                    const receipt = receipts.find(
                        item =>
                            String(item.id) === String(selectedId)
                    );

                    if (
                        receipt?.receipt_number &&
                        $("purchaseReceiptNumber")
                    ) {
                        $("purchaseReceiptNumber").value =
                            receipt.receipt_number;
                    }
                }
            );

            $("addPurchaseProductRow")?.addEventListener(
                "click",
                () => addProductRow()
            );

            $("purchaseProductRows")?.addEventListener(
                "click",
                event => {
                    const button = event.target.closest(
                        ".remove-product-row"
                    );

                    if (!button) return;

                    const rows = document.querySelectorAll(
                        "#purchaseProductRows .purchase-product-row"
                    );

                    if (rows.length <= 1) {
                        notify(
                            "Legalább egy terméksornak maradnia kell.",
                            "error"
                        );
                        return;
                    }

                    button.closest(
                        ".purchase-product-row"
                    )?.remove();
                }
            );

            // ==================================
            // MENTÉS
            // ==================================

            $("purchaseForm")?.addEventListener(
                "submit",
                async event => {
                    event.preventDefault();

                    const form = $("purchaseForm");

                    const button = form?.querySelector(
                        'button[type="submit"]'
                    );

                    if (button?.disabled) return;

                    const childId =
                        $("purchaseChild")?.value;

                    const purchaseDate =
                        $("purchaseDate")?.value;

                    let receiptNumber = (
                        $("purchaseReceiptNumber")?.value || ""
                    ).trim();

                    const receiptId =
                        $("purchaseReceipt")?.value || null;

                    if (!childId || !purchaseDate) {
                        notify(
                            "Válaszd ki a gyermeket és add meg a vásárlás dátumát.",
                            "error"
                        );
                        return;
                    }

                    const selectedChild = children.find(
                        child =>
                            String(child.id) === String(childId)
                    );

                    if (!selectedChild) {
                        notify(
                            "Érvénytelen gyermekválasztás.",
                            "error"
                        );
                        return;
                    }

                    let selectedReceipt = null;

                    if (receiptId) {
                        selectedReceipt = receipts.find(
                            item =>
                                String(item.id) === String(receiptId)
                        );

                        if (
                            !selectedReceipt ||
                            String(selectedReceipt.child_id) !==
                                String(childId)
                        ) {
                            notify(
                                "A kiválasztott bizonylat nem ehhez a gyermekhez tartozik.",
                                "error"
                            );
                            return;
                        }

                        const uploadedNumber = String(
                            selectedReceipt.receipt_number || ""
                        ).trim();

                        if (
                            uploadedNumber &&
                            receiptNumber &&
                            uploadedNumber !== receiptNumber
                        ) {
                            notify(
                                "A megadott bizonylatszám nem egyezik a feltöltött bizonylat sorszámával.",
                                "error"
                            );
                            return;
                        }

                        if (!receiptNumber && uploadedNumber) {
                            receiptNumber = uploadedNumber;
                        }
                    }

                    const rows = Array.from(
                        document.querySelectorAll(
                            "#purchaseProductRows .purchase-product-row"
                        )
                    );

                    if (!rows.length) {
                        notify(
                            "Adj hozzá legalább egy terméksort.",
                            "error"
                        );
                        return;
                    }

                    const items = [];

                    for (
                        let index = 0;
                        index < rows.length;
                        index++
                    ) {
                        const row = rows[index];

                        const productName = row.querySelector(
                            ".product-name"
                        )?.value.trim();

                        const quantity = Number(
                            row.querySelector(
                                ".product-quantity"
                            )?.value
                        );

                        const totalPrice = Number(
                            row.querySelector(
                                ".product-price"
                            )?.value
                        );

                        const category = row.querySelector(
                            ".product-category"
                        )?.value;

                        if (!productName) {
                            notify(
                                `${index + 1}. sor: add meg a termék megnevezését.`,
                                "error"
                            );
                            return;
                        }

                        if (
                            !Number.isSafeInteger(quantity) ||
                            quantity < 1
                        ) {
                            notify(
                                `${index + 1}. sor: érvénytelen mennyiség.`,
                                "error"
                            );
                            return;
                        }

                        if (
                            !Number.isSafeInteger(totalPrice) ||
                            totalPrice < 0
                        ) {
                            notify(
                                `${index + 1}. sor: érvénytelen teljes vételár.`,
                                "error"
                            );
                            return;
                        }

                        if (
                            !["clothing", "sports"].includes(category)
                        ) {
                            notify(
                                `${index + 1}. sor: érvénytelen kategória.`,
                                "error"
                            );
                            return;
                        }

                        items.push({
                            child_id: childId,
                            receipt_id: receiptId,
                            receipt_number: receiptNumber || null,
                            product_name: productName,
                            quantity,

                            /*
                             * A régi adatbázismező miatt
                             * unit_price is kap értéket.
                             * A megjelenítés és elszámolás
                             * továbbra is total_price mezőt használ.
                             */
                            unit_price: totalPrice,
                            total_price: totalPrice,

                            category,
                            purchase_date: purchaseDate
                        });
                    }

                    if (button) {
                        button.disabled = true;
                        button.textContent = "Mentés...";
                    }

                    try {
                        if (existing) {
                            // Szerkesztéskor egyetlen tételt módosítunk.
                            const { error } = await db
                                .from("purchase_items")
                                .update(items[0])
                                .eq("id", existing.id);

                            if (error) throw error;

                        } else {
                            /*
                             * Az összes terméksor egyetlen
                             * insert művelettel kerül mentésre.
                             */
                            const { error } = await db
                                .from("purchase_items")
                                .insert(items);

                            if (error) throw error;
                        }

                        closeModal();

                        notify(
                            existing
                                ? "A vásárlási tétel módosítva."
                                : `${items.length} vásárlási tétel sikeresen rögzítve.`
                        );

                        await loadPurchases();

                        if (typeof R.loadDashboard === "function") {
                            await R.loadDashboard();
                        }

                        if (
                            window.RuhatarChildren?.refresh
                        ) {
                            await window.RuhatarChildren.refresh();
                        }

                    } catch (error) {
                        console.error(
                            "Vásárlásmentési hiba:",
                            error
                        );

                        notify(
                            "A mentés sikertelen: " +
                            getErrorMessage(error),
                            "error"
                        );

                        if (button) {
                            button.disabled = false;
                            button.textContent = existing
                                ? "Módosítás mentése"
                                : "Összes vásárlási tétel rögzítése";
                        }
                    }
                }
            );

        } catch (error) {
            console.error(
                "Űrlapmegnyitási hiba:",
                error
            );

            notify(
                "Az űrlap megnyitása sikertelen: " +
                getErrorMessage(error),
                "error"
            );
        }
    }

    // ==========================================
    // ESEMÉNYKEZELŐK
    // ==========================================

    function initialize() {
        $("addPurchaseButton")?.addEventListener(
            "click",
            () => openPurchaseForm()
        );

        $("purchaseSearch")?.addEventListener(
            "input",
            renderPurchases
        );

        $("purchaseCategoryFilter")?.addEventListener(
            "change",
            renderPurchases
        );

        $("purchaseStatusFilter")?.addEventListener(
            "change",
            renderPurchases
        );

        $("purchasesTable")?.addEventListener(
            "click",
            event => {
                const button = event.target.closest(
                    "[data-edit-purchase]"
                );

                if (button) {
                    openPurchaseForm(
                        button.dataset.editPurchase
                    );
                }
            }
        );

        window.addEventListener(
            "ruhat ar:newpurchase",
            event => {
                openPurchaseForm(
                    null,
                    event.detail?.childId || null
                );
            }
        );

        loadPurchases();
    }

    // ==========================================
    // MODUL REGISZTRÁLÁSA
    // ==========================================

    R.registerModule("purchases", loadPurchases);

    window.RuhatarPurchases = {
        loadPurchases,
        openPurchaseForm,
        edit: purchaseId =>
            openPurchaseForm(purchaseId),
        refresh: loadPurchases
    };

    initialize();

})();
