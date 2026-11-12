
"use strict";

/*
 * RUHATÁR – Bizonylatok modul
 * JPG, PNG, PDF – AI/OCR nélkül.
 * Adminisztrátori bizonylattörléssel.
 */

(() => {
    const R = window.Ruhatar;

    if (!R) {
        console.error("A RUHATÁR alkalmazás nem található.");
        return;
    }

    const {
        db,
        $,
        money,
        date,
        escapeHTML,
        notify
    } = R;

    const BUCKET = "receipts";
    const MAX_FILE_SIZE = 10 * 1024 * 1024;

    const ALLOWED_TYPES = [
        "image/jpeg",
        "image/png",
        "application/pdf"
    ];

    let receipts = [];
    let children = [];

    // --------------------------------------------------
    // HIBAÜZENET
    // --------------------------------------------------

    function errorMessage(error) {
        return [
            error?.message,
            error?.details,
            error?.hint,
            error?.code ? `Kód: ${error.code}` : ""
        ].filter(Boolean).join(" | ") || "Ismeretlen hiba.";
    }

    // --------------------------------------------------
    // BIZONYLATOK BETÖLTÉSE
    // --------------------------------------------------

    async function loadReceipts() {
        const { data, error } = await db
            .from("receipts")
            .select("*, children(full_name)")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Bizonylatok betöltési hibája:", error);

            notify(
                "A bizonylatok betöltése sikertelen: " +
                errorMessage(error),
                "error"
            );

            return;
        }

        receipts = data || [];
        renderReceipts();
    }

    // --------------------------------------------------
    // GYERMEKEK BETÖLTÉSE
    // --------------------------------------------------

    async function loadChildren() {
        const { data, error } = await db
            .from("children")
            .select("id, full_name, archived_at")
            .is("archived_at", null)
            .order("full_name", { ascending: true });

        if (error) {
            console.error("Gyermeklista Supabase-hiba:", error);
            throw error;
        }

        children = data || [];
        return children;
    }

    // --------------------------------------------------
    // BIZONYLATOK MEGJELENÍTÉSE
    // --------------------------------------------------

    function renderReceipts() {
        const container = $("receiptsList");
        if (!container) return;

        const search =
            $("receiptSearch")?.value?.trim()?.toLowerCase() || "";

        const filtered = receipts.filter(receipt => {
            const name = receipt.original_filename || "";
            const merchant = receipt.merchant || "";
            const child = receipt.children?.full_name || "";
            const number = receipt.receipt_number || "";

            return [
                name,
                merchant,
                child,
                number
            ].join(" ").toLowerCase().includes(search);
        });

        container.innerHTML = filtered.length
            ? filtered.map(receipt => `
                <article class="receipt-card">

                    <h3>
                        ${escapeHTML(
                            receipt.merchant ||
                            receipt.original_filename ||
                            "Bizonylat"
                        )}
                    </h3>

                    <p>
                        <strong>Gyermek:</strong>
                        ${escapeHTML(
                            receipt.children?.full_name || "–"
                        )}
                    </p>

                    <p>
                        <strong>Bizonylat száma:</strong>
                        ${escapeHTML(
                            receipt.receipt_number || "Nincs megadva"
                        )}
                    </p>

                    <p>
                        <strong>Fájl:</strong>
                        ${escapeHTML(
                            receipt.original_filename || "–"
                        )}
                    </p>

                    <p>
                        <strong>Vásárlás időpontja:</strong>
                        ${receipt.purchase_date
                            ? date(receipt.purchase_date)
                            : "–"}
                    </p>

                    <p>
                        <strong>Végösszeg:</strong>
                        ${receipt.total_amount !== null &&
                          receipt.total_amount !== undefined
                            ? money(receipt.total_amount)
                            : "–"}
                    </p>

                    <span class="status">
                        ${escapeHTML(
                            receipt.review_status || "Rögzítve"
                        )}
                    </span>

                    <div class="receipt-actions">

                        <button
                            type="button"
                            class="secondary-button"
                            data-receipt-view="${receipt.id}">
                            Megtekintés
                        </button>

                        ${R.isAdmin() ? `
                            <button
                                type="button"
                                class="danger-button"
                                data-receipt-delete="${receipt.id}">
                                Törlés
                            </button>
                        ` : ""}

                    </div>
                </article>
            `).join("")
            : "<p>Nem található bizonylat.</p>";
    }

    // --------------------------------------------------
    // FELTÖLTÉSI ŰRLAP
    // --------------------------------------------------

    async function uploadForm() {
        if (!R.canCreatePurchase()) {
            notify(
                "Nincs jogosultságod bizonylat feltöltéséhez.",
                "error"
            );
            return;
        }

        try {
            await loadChildren();

            if (!children.length) {
                notify(
                    "Nem található olyan gyermek, akihez hozzáférésed van.",
                    "error"
                );
                return;
            }

            R.showModal(`
                <h2>Bizonylat feltöltése</h2>

                <form id="receiptUploadForm">

                    <label>Gyermek</label>

                    <select id="receiptChild" required>
                        <option value="">Válassz gyermeket</option>

                        ${children.map(child => `
                            <option value="${child.id}">
                                ${escapeHTML(child.full_name)}
                            </option>
                        `).join("")}
                    </select>

                    <label>Bizonylat fájlja (JPG, PNG, PDF)</label>

                    <input
                        type="file"
                        id="receiptFile"
                        accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                        required
                    >

                    <label>Üzlet neve</label>
                    <input
                        id="receiptMerchant"
                        maxlength="200"
                    >

                    <label>Vásárlás időpontja (számla/nyugta kelte)</label>
                    <input
                        id="receiptDate"
                        type="date"
                    >

                    <label>Végösszeg (Ft)</label>
                    <input
                        id="receiptAmount"
                        type="number"
                        min="0"
                        step="1"
                    >

                    <label>Nyugta/számla sorszáma</label>
                    <input
                        id="receiptNumber"
                        maxlength="100"
                    >

                    <button
                        type="submit"
                        class="primary-button">
                        Bizonylat feltöltése
                    </button>

                </form>
            `);

            $("receiptUploadForm")?.addEventListener(
                "submit",
                uploadReceipt
            );

        } catch (error) {
            console.error("Gyermeklista betöltési hiba:", error);

            notify(
                "A gyermeklista betöltése sikertelen: " +
                errorMessage(error),
                "error"
            );
        }
    }

    // --------------------------------------------------
    // BIZONYLAT FELTÖLTÉSE
    // --------------------------------------------------

    async function uploadReceipt(event) {
        event.preventDefault();

        const form = $("receiptUploadForm");
        if (!form) return;

        const button = form.querySelector(
            'button[type="submit"]'
        );

        const childId = $("receiptChild")?.value;
        const file = $("receiptFile")?.files?.[0];

        if (!childId || !file) {
            notify("Válassz gyermeket és fájlt.", "error");
            return;
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            notify(
                "Csak JPG, PNG és PDF fájl tölthető fel.",
                "error"
            );
            return;
        }

        if (file.size > MAX_FILE_SIZE) {
            notify(
                "A fájl legfeljebb 10 MB lehet.",
                "error"
            );
            return;
        }

        const amountValue = $("receiptAmount")?.value ?? "";

        const amount = amountValue === ""
            ? null
            : Number(amountValue);

        if (
            amount !== null &&
            (!Number.isSafeInteger(amount) || amount < 0)
        ) {
            notify("A végösszeg nem megfelelő.", "error");
            return;
        }

        const purchaseDate = $("receiptDate")?.value || null;

        if (
            purchaseDate &&
            !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)
        ) {
            notify("A vásárlás dátuma nem megfelelő.", "error");
            return;
        }

        if (button) {
            button.disabled = true;
            button.textContent = "Feltöltés...";
        }

        let uploaded = false;
        let filePath = null;

        try {
            const { data: authData, error: authError } =
                await db.auth.getUser();

            if (authError) throw authError;

            const userId = authData?.user?.id;

            if (!userId) {
                throw new Error(
                    "Nem található bejelentkezett felhasználó."
                );
            }

            const safeName = file.name
                .normalize("NFKD")
                .replace(/[^a-zA-Z0-9._-]/g, "_")
                .slice(-120);

            filePath =
                `${childId}/${crypto.randomUUID()}-${safeName}`;

            const { error: uploadError } = await db.storage
                .from(BUCKET)
                .upload(filePath, file, {
                    contentType: file.type,
                    upsert: false
                });

            if (uploadError) throw uploadError;

            uploaded = true;

            const payload = {
                child_id: childId,
                uploaded_by: userId,
                file_path: filePath,
                original_filename: file.name,
                merchant:
                    $("receiptMerchant")?.value.trim() || null,
                purchase_date: purchaseDate,
                total_amount: amount,
                receipt_number:
                    $("receiptNumber")?.value.trim() || null
            };

            const { error: insertError } = await db
                .from("receipts")
                .insert(payload);

            if (insertError) throw insertError;

            R.closeModal();

            notify("A bizonylat sikeresen feltöltve.");

            await loadReceipts();

            if (typeof R.loadDashboard === "function") {
                await R.loadDashboard();
            }

            if (window.RuhatarChildren?.refresh) {
                await window.RuhatarChildren.refresh();
            }

        } catch (error) {
            console.error("Bizonylatfeltöltési hiba:", error);

            if (uploaded && filePath) {
                const { error: removeError } = await db.storage
                    .from(BUCKET)
                    .remove([filePath]);

                if (removeError) {
                    console.error(
                        "Árva fájl eltávolítása sikertelen:",
                        removeError
                    );
                }
            }

            notify(
                "A bizonylat feltöltése sikertelen: " +
                errorMessage(error),
                "error"
            );

        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Bizonylat feltöltése";
            }
        }
    }

    // --------------------------------------------------
    // BIZONYLAT MEGTEKINTÉSE
    // --------------------------------------------------

    async function viewReceipt(receiptId) {
        const receipt = receipts.find(
            item => item.id === receiptId
        );

        if (!receipt) {
            notify("A bizonylat nem található.", "error");
            return;
        }

        const { data, error } = await db.storage
            .from(BUCKET)
            .createSignedUrl(receipt.file_path, 300);

        if (error || !data?.signedUrl) {
            console.error("Bizonylat megnyitási hiba:", error);

            notify(
                "A bizonylat megnyitása sikertelen.",
                "error"
            );
            return;
        }

        window.open(
            data.signedUrl,
            "_blank",
            "noopener,noreferrer"
        );
    }

    // --------------------------------------------------
    // BIZONYLAT TÖRLÉSE
    // --------------------------------------------------

    async function deleteReceipt(receiptId) {
        if (!R.isAdmin()) {
            notify(
                "Nincs jogosultságod a törléshez.",
                "error"
            );
            return;
        }

        const receipt = receipts.find(
            item => item.id === receiptId
        );

        if (!receipt) {
            notify("A bizonylat nem található.", "error");
            return;
        }

        const confirmed = window.confirm(
            `Biztosan törlöd ezt a bizonylatot?\n\n` +
            `${receipt.original_filename || "Bizonylat"}\n\n` +
            `A vásárlási tételek és elszámolások megmaradnak, ` +
            `de a bizonylatkapcsolat megszűnik.`
        );

        if (!confirmed) return;

        try {
            // 1. Vásárlási tételek leválasztása.
            const { error: purchaseError } = await db
                .from("purchase_items")
                .update({ receipt_id: null })
                .eq("receipt_id", receiptId);

            if (purchaseError) throw purchaseError;

            // 2. Elszámolások leválasztása.
            const { error: approvalError } = await db
                .from("approvals")
                .update({ receipt_id: null })
                .eq("receipt_id", receiptId);

            if (approvalError) throw approvalError;

            // 3. Bizonylat rekord törlése.
            const { data, error } = await db
                .from("receipts")
                .delete()
                .eq("id", receiptId)
                .select("id");

            if (error) throw error;

            if (!data || data.length === 0) {
                throw new Error(
                    "A bizonylat nem törölhető. Ellenőrizd az adminisztrátori jogosultságot."
                );
            }

            // 4. Fájl törlése Storage-ból.
            const { error: storageError } = await db.storage
                .from(BUCKET)
                .remove([receipt.file_path]);

            if (storageError) {
                console.error(
                    "Storage törlési hiba:",
                    storageError
                );

                notify(
                    "A bizonylat adata törölve, de a fájl eltávolítása nem sikerült.",
                    "error"
                );
            } else {
                notify("A bizonylat sikeresen törölve.");
            }

            await loadReceipts();

            if (typeof R.loadDashboard === "function") {
                await R.loadDashboard();
            }

            if (window.RuhatarChildren?.refresh) {
                await window.RuhatarChildren.refresh();
            }

        } catch (error) {
            console.error("Bizonylattörlési hiba:", error);

            notify(
                "A bizonylat törlése sikertelen: " +
                errorMessage(error),
                "error"
            );
        }
    }

    // --------------------------------------------------
    // ESEMÉNYKEZELŐK
    // --------------------------------------------------

    function initialize() {
        $("uploadReceiptButton")?.addEventListener(
            "click",
            uploadForm
        );

        $("receiptSearch")?.addEventListener(
            "input",
            renderReceipts
        );

        $("receiptsList")?.addEventListener(
            "click",
            event => {
                const viewButton = event.target.closest(
                    "[data-receipt-view]"
                );

                if (viewButton) {
                    viewReceipt(viewButton.dataset.receiptView);
                    return;
                }

                const deleteButton = event.target.closest(
                    "[data-receipt-delete]"
                );

                if (deleteButton) {
                    deleteReceipt(
                        deleteButton.dataset.receiptDelete
                    );
                }
            }
        );
    }

    // --------------------------------------------------
    // MODUL REGISZTRÁLÁSA
    // --------------------------------------------------

    R.registerModule("receipts", loadReceipts);

    window.RuhatarReceipts = {
        loadReceipts,
        loadChildren,
        uploadForm,
        viewReceipt,
        deleteReceipt
    };

    initialize();

})();
