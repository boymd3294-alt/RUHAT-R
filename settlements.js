
"use strict";

/*
 * RUHATÁR – Elszámolások modul
 * Éves elszámolás, kategóriánkénti összesítés,
 * CSV export és nyomtatás.
 */

(() => {
    const R = window.Ruhatar;
    if (!R) return;

    const { db, $, money, date, escapeHTML, notify } = R;

    let purchases = [];

    const currentYear = new Date().getFullYear();

    function initializeYear() {
        const select = $("settlementYear");
        if (!select) return;

        const years = [currentYear, currentYear - 1, currentYear - 2];

        select.innerHTML = years.map(year => `
            <option value="${year}" ${year === currentYear ? "selected" : ""}>
                ${year}
            </option>
        `).join("");
    }

    async function loadSettlements() {
        const { data, error } = await db
            .from("purchase_items")
            .select("*, children(full_name), receipts(review_status)")
            .order("purchase_date", { ascending: false });

        if (error) {
            console.error(error);
            notify("Az elszámolások betöltése sikertelen.", "error");
            return;
        }

        purchases = data || [];
        renderSettlements();
    }

    function getFilteredPurchases() {
        const year = Number($("settlementYear")?.value || currentYear);
        const category = $("settlementCategory")?.value || "";
        const search = ($("settlementSearch")?.value || "").toLowerCase();

        return purchases.filter(item => {
            const purchaseYear = item.purchase_date
                ? Number(item.purchase_date.slice(0, 4))
                : null;

            const matchesYear = purchaseYear === year;
            const matchesCategory = !category || item.category === category;

            const childName = item.children?.full_name || "";
            const productName = item.product_name || "";

            const matchesSearch =
                !search ||
                childName.toLowerCase().includes(search) ||
                productName.toLowerCase().includes(search);

            return matchesYear && matchesCategory && matchesSearch;
        });
    }

    function renderSettlements() {
        const container = $("settlementsTable");
        if (!container) return;

        const filtered = getFilteredPurchases();

        if (!filtered.length) {
            container.innerHTML = `
                <tr>
                    <td colspan="8">Nincs elszámolható vásárlás.</td>
                </tr>
            `;
            return;
        }

        container.innerHTML = filtered.map(item => `
            <tr>
                <td>${escapeHTML(item.children?.full_name || "–")}</td>
                <td>${escapeHTML(item.product_name || "–")}</td>
                <td>${escapeHTML(item.quantity)}</td>
                <td>${money(item.unit_price)}</td>
                <td>${money(item.total_price)}</td>
                <td>
                    ${item.category === "sports"
                        ? "Sport"
                        : "Ruhanemű / lábbeli"}
                </td>
                <td>${date(item.purchase_date)}</td>
                <td>
                    <span class="status">
                        ${escapeHTML(item.receipts?.review_status || "Rögzítve")}
                    </span>
                </td>
            </tr>
        `).join("");

        renderSummary(filtered);
    }

    function renderSummary(items) {
        const clothing = items
            .filter(item => item.category === "clothing")
            .reduce((sum, item) => sum + Number(item.total_price || 0), 0);

        const sports = items
            .filter(item => item.category === "sports")
            .reduce((sum, item) => sum + Number(item.total_price || 0), 0);

        const total = clothing + sports;

        const container = document.getElementById("settlementSummary");

        if (container) {
            container.innerHTML = `
                <div class="summary-card">
                    <span>Ruházati kiadás</span>
                    <strong>${money(clothing)}</strong>
                    <small>Éves keret: ${money(200000)}</small>
                    <small>Fennmaradó: ${money(200000 - clothing)}</small>
                </div>

                <div class="summary-card">
                    <span>Sportkiadás</span>
                    <strong>${money(sports)}</strong>
                    <small>Éves keret: ${money(50000)}</small>
                    <small>Fennmaradó: ${money(50000 - sports)}</small>
                </div>

                <div class="summary-card">
                    <span>Összes kiadás</span>
                    <strong>${money(total)}</strong>
                </div>
            `;
        }
    }

    function exportCSV() {
        const items = getFilteredPurchases();

        if (!items.length) {
            notify("Nincs exportálható adat.", "warning");
            return;
        }

        const rows = [
            [
                "Gyermek",
                "Termék",
                "Mennyiség",
                "Egységár (Ft)",
                "Teljes ár (Ft)",
                "Kategória",
                "Dátum",
                "Állapot"
            ],
            ...items.map(item => [
                item.children?.full_name || "",
                item.product_name || "",
                item.quantity,
                item.unit_price,
                item.total_price,
                item.category === "sports" ? "Sport" : "Ruházat",
                item.purchase_date || "",
                item.receipts?.review_status || "Rögzítve"
            ])
        ];

        const csv = "\uFEFF" + rows.map(row =>
            row.map(value =>
                `"${String(value ?? "").replace(/"/g, '""')}"`
            ).join(";")
        ).join("\r\n");

        const blob = new Blob([csv], {
            type: "text/csv;charset=utf-8;"
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = `ruhat ar-elszamolas-${$("settlementYear")?.value || currentYear}.csv`;
        link.click();

        URL.revokeObjectURL(url);

        notify("Az Excelben megnyitható CSV export elkészült.");
    }

    function printSettlement() {
        const items = getFilteredPurchases();

        if (!items.length) {
            notify("Nincs nyomtatható elszámolás.", "warning");
            return;
        }

        window.print();
    }

    function initialize() {
        initializeYear();

        $("settlementSearch")?.addEventListener("input", renderSettlements);
        $("settlementYear")?.addEventListener("change", renderSettlements);
        $("settlementCategory")?.addEventListener("change", renderSettlements);

        $("exportExcelButton")?.addEventListener("click", exportCSV);

        $("exportPdfButton")?.addEventListener("click", () => {
            notify("A megnyíló nyomtatási ablakban válaszd a Mentés PDF-ként lehetőséget.");
            printSettlement();
        });

        $("printSettlementButton")?.addEventListener("click", printSettlement);
    }

    R.registerModule("settlements", loadSettlements);

    window.RuhatarSettlements = {
        loadSettlements,
        renderSettlements,
        exportCSV,
        printSettlement
    };

    initialize();

})();
