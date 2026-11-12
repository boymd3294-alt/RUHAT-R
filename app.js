"use strict";

/*
 * RUHATÁR – Alkalmazás központi modul
 * Supabase Auth, jogosultságok, navigáció, vezérlőpult.
 */

(() => {
    const db = window.supabaseClient;

    const ROLE_NAMES = {
        admin: "Adminisztrátor",
        foster_parent: "Nevelőszülő",
        advisor: "Nevelőszülői tanácsadó",
        viewer: "Megfigyelő"
    };

    const STATUS_NAMES = {
        recorded: "Rögzítve",
        pending: "Ellenőrzésre vár",
        reviewed: "Ellenőrizve",
        approved: "Jóváhagyva",
        rejected: "Elutasítva"
    };

    const state = {
        user: null,
        profile: null,
        currentPage: "dashboard",
        currentChild: null
    };

    const modules = {};

    // ==========================================
    // SEGÉDFÜGGVÉNYEK
    // ==========================================

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function money(value) {
        return new Intl.NumberFormat("hu-HU", {
            style: "currency",
            currency: "HUF",
            maximumFractionDigits: 0
        }).format(Number(value) || 0);
    }

    function date(value) {
        if (!value) return "–";

        const parsedDate = new Date(value);

        if (Number.isNaN(parsedDate.getTime())) {
            return "–";
        }

        return new Intl.DateTimeFormat("hu-HU").format(
            parsedDate
        );
    }

    function notify(message, type = "success") {
        const container = $("notificationContainer");
        if (!container) return;

        const element = document.createElement("div");
        element.className = `notification ${type}`;
        element.textContent = message;

        container.appendChild(element);

        setTimeout(() => element.remove(), 4000);
    }

    function showModal(content) {
        const modalContent = $("modalContent");
        const modalOverlay = $("modalOverlay");

        if (!modalContent || !modalOverlay) return;

        modalContent.innerHTML = content;
        modalOverlay.hidden = false;
    }

    function closeModal() {
        const modalOverlay = $("modalOverlay");
        const modalContent = $("modalContent");

        if (modalOverlay) {
            modalOverlay.hidden = true;
        }

        if (modalContent) {
            modalContent.innerHTML = "";
        }
    }

    // ==========================================
    // AUTH NÉZETEK
    // ==========================================

    function showAuthView(view) {
        $("authSection").hidden = false;
        $("appSection").hidden = true;

        $("loginView").hidden = view !== "login";
        $("registerView").hidden = view !== "register";
        $("pendingView").hidden = view !== "pending";
    }

    function showApplication() {
        $("authSection").hidden = true;
        $("appSection").hidden = false;
    }

    // ==========================================
    // JOGOSULTSÁGOK
    // ==========================================

    function isAdmin() {
        return (
            state.profile?.role === "admin" &&
            state.profile?.status === "approved"
        );
    }

    function canManageChildren() {
        return isAdmin();
    }

    function canCreatePurchase() {
        return (
            isAdmin() ||
            (
                state.profile?.role === "foster_parent" &&
                state.profile?.status === "approved"
            )
        );
    }

    function canReview() {
        return (
            isAdmin() ||
            (
                state.profile?.role === "advisor" &&
                state.profile?.status === "approved"
            )
        );
    }

    function getRoleName(role) {
        return ROLE_NAMES[role] || "Ismeretlen szerepkör";
    }

    function getStatusName(status) {
        return STATUS_NAMES[status] || status || "–";
    }

    // ==========================================
    // FELHASZNÁLÓI INFORMÁCIÓK
    // ==========================================

    function setUserInformation() {
        const profile = state.profile;
        if (!profile) return;

        const name = profile.full_name || "Felhasználó";

        if ($("sidebarUserName")) {
            $("sidebarUserName").textContent = name;
        }

        if ($("topbarUserName")) {
            $("topbarUserName").textContent = name;
        }

        if ($("sidebarUserRole")) {
            $("sidebarUserRole").textContent =
                getRoleName(profile.role);
        }

        if ($("userAvatar")) {
            $("userAvatar").textContent =
                name.trim().charAt(0).toUpperCase() || "U";
        }

        document.querySelectorAll(".admin-only").forEach(element => {
            element.hidden = !isAdmin();
        });

        document.querySelectorAll(".foster-only").forEach(element => {
            element.hidden = !canCreatePurchase();
        });

        document.querySelectorAll(".advisor-only").forEach(element => {
            element.hidden = !canReview();
        });
    }

    // ==========================================
    // BEJELENTKEZÉS
    // ==========================================

    async function login(event) {
        event.preventDefault();

        const email = $("loginEmail").value.trim();
        const password = $("loginPassword").value;

        const button = $("loginForm").querySelector(
            'button[type="submit"]'
        );

        button.disabled = true;
        button.textContent = "Bejelentkezés...";

        try {
            const { error } = await db.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            await loadUser();

        } catch (error) {
            notify(
                error.message || "Sikertelen bejelentkezés.",
                "error"
            );

        } finally {
            button.disabled = false;
            button.textContent = "Bejelentkezés";
        }
    }

    // ==========================================
    // REGISZTRÁCIÓ
    // ==========================================

    async function register(event) {
        event.preventDefault();

        const fullName = $("registerName").value.trim();
        const email = $("registerEmail").value.trim();
        const password = $("registerPassword").value;
        const requestedRole = $("registerRole").value;

        if (!fullName || !email || !password || !requestedRole) {
            notify("Minden mező kitöltése kötelező.", "error");
            return;
        }

        const button = $("registerForm").querySelector(
            'button[type="submit"]'
        );

        button.disabled = true;
        button.textContent = "Regisztráció...";

        try {
            const { data, error } = await db.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        requested_role: requestedRole
                    }
                }
            });

            if (error) throw error;

            if (data.session) {
                await db.auth.signOut();
            }

            $("registerForm").reset();

            showAuthView("pending");

        } catch (error) {
            notify(
                error.message || "Sikertelen regisztráció.",
                "error"
            );

        } finally {
            button.disabled = false;
            button.textContent = "Regisztráció";
        }
    }

    // ==========================================
    // FELHASZNÁLÓ ADATAINAK BETÖLTÉSE
    // ==========================================

    async function loadUser() {
        const { data: sessionData, error: sessionError } =
            await db.auth.getSession();

        if (sessionError) throw sessionError;

        const session = sessionData.session;

        if (!session) {
            state.user = null;
            state.profile = null;
            state.currentChild = null;

            showAuthView("login");
            return;
        }

        state.user = session.user;

        const { data: profile, error } = await db
            .from("profiles")
            .select("*")
            .eq("id", state.user.id)
            .maybeSingle();

        if (error) throw error;

        if (!profile) {
            notify(
                "A felhasználói profil nem található.",
                "error"
            );

            await db.auth.signOut();
            showAuthView("login");
            return;
        }

        state.profile = profile;

        if (profile.status !== "approved" || !profile.role) {
            showAuthView("pending");
            return;
        }

        showApplication();
        setUserInformation();

        navigate("dashboard");
        await loadDashboard();
    }

    // ==========================================
    // KIJELENTKEZÉS
    // ==========================================

    async function logout() {
        const { error } = await db.auth.signOut();

        if (error) {
            notify(error.message, "error");
            return;
        }

        state.user = null;
        state.profile = null;
        state.currentChild = null;

        showAuthView("login");
        notify("Sikeres kijelentkezés.");
    }

    // ==========================================
    // NAVIGÁCIÓ
    // ==========================================

    function navigate(page) {
        const target = $("page-" + page);

        if (!target || target.hidden) {
            notify(
                "Ehhez az oldalhoz nincs jogosultságod.",
                "error"
            );
            return;
        }

        state.currentPage = page;

        document.querySelectorAll(".page").forEach(element => {
            element.classList.toggle(
                "active",
                element.id === "page-" + page
            );
        });

        document.querySelectorAll(".nav-item").forEach(element => {
            element.classList.toggle(
                "active",
                element.dataset.page === page
            );
        });

        const titles = {
            dashboard: [
                "Vezérlőpult",
                "A RUHATÁR rendszer áttekintése"
            ],
            children: [
                "Gyermekek",
                "Gyermekek adatainak kezelése"
            ],
            purchases: [
                "Vásárlások",
                "Rögzített vásárlások"
            ],
            receipts: [
                "Bizonylatok",
                "Feltöltött bizonylatok"
            ],
            settlements: [
                "Elszámolások",
                "Éves elszámolási adatok"
            ],
            users: [
                "Felhasználók",
                "Felhasználók és jogosultságok"
            ],
            settings: [
                "Beállítások",
                "Rendszerbeállítások"
            ]
        };

        $("pageTitle").textContent =
            titles[page]?.[0] || "RUHATÁR";

        $("pageSubtitle").textContent =
            titles[page]?.[1] || "";

        window.dispatchEvent(
            new CustomEvent("ruhat ar:pagechange", {
                detail: { page }
            })
        );

        window.dispatchEvent(
            new CustomEvent("ruhat ar-pagechange", {
                detail: { page }
            })
        );

        if (modules[page]) {
            modules[page]();
        }
    }

    // ==========================================
    // VEZÉRLŐPULT
    // ==========================================

    async function loadDashboard() {
        try {
            const [
                childrenResult,
                purchasesResult,
                receiptsResult
            ] = await Promise.all([

                // Aktív gyermekek száma
                db.from("children")
                    .select("id", {
                        count: "exact",
                        head: true
                    })
                    .is("archived_at", null),

                // Vásárlási tételek
                db.from("purchase_items")
                    .select(`
                        id,
                        child_id,
                        product_name,
                        quantity,
                        receipt_number,
                        category,
                        purchase_date,
                        total_price,
                        children(full_name)
                    `, {
                        count: "exact"
                    })
                    .order("purchase_date", {
                        ascending: false
                    })
                    .limit(5),

                // Feltöltött bizonylatok száma
                db.from("receipts")
                    .select("id", {
                        count: "exact",
                        head: true
                    })

            ]);

            if (childrenResult.error) {
                throw childrenResult.error;
            }

            if (purchasesResult.error) {
                throw purchasesResult.error;
            }

            if (receiptsResult.error) {
                throw receiptsResult.error;
            }

            // ==================================
            // STATISZTIKAI KÁRTYÁK
            // ==================================

            if ($("statChildren")) {
                $("statChildren").textContent =
                    childrenResult.count ?? 0;
            }

            if ($("statPurchases")) {
                // Az összes vásárlási tétel száma,
                // nem csak az utolsó öt elemé.
                $("statPurchases").textContent =
                    purchasesResult.count ?? 0;
            }

            if ($("statReceipts")) {
                $("statReceipts").textContent =
                    receiptsResult.count ?? 0;
            }

            if ($("statPending")) {
                $("statPending").textContent = "–";
            }

            // ==================================
            // LEGUTÓBBI VÁSÁRLÁSOK
            // ==================================

            const rows = purchasesResult.data || [];
            const container = $("dashboardRecentPurchases");

            if (!container) return;

            container.innerHTML = rows.length
                ? rows.map(item => `
                    <tr>

                        <!-- Gyermek -->
                        <td>
                            ${escapeHTML(
                                item.children?.full_name || "–"
                            )}
                        </td>

                        <!-- Vásárlás időpontja -->
                        <td>
                            ${date(item.purchase_date)}
                        </td>

                        <!-- Bizonylatszám -->
                        <td>
                            ${escapeHTML(
                                item.receipt_number || "–"
                            )}
                        </td>

                        <!-- Termék megnevezése -->
                        <td>
                            ${escapeHTML(
                                item.product_name || "–"
                            )}
                        </td>

                        <!-- Mennyiség -->
                        <td>
                            ${escapeHTML(
                                item.quantity ?? "–"
                            )}
                        </td>

                        <!-- Teljes vételár -->
                        <td>
                            <strong>
                                ${money(item.total_price)}
                            </strong>
                        </td>

                        <!-- Kategória -->
                        <td>
                            ${escapeHTML(
                                item.category === "sports"
                                    ? "Sport"
                                    : "Ruhanemű / lábbeli"
                            )}
                        </td>

                    </tr>
                `).join("")
                : `
                    <tr>
                        <td colspan="7">
                            Még nincs rögzített vásárlás.
                        </td>
                    </tr>
                `;

        } catch (error) {
            console.error("Vezérlőpult hiba:", error);

            notify(
                "A vezérlőpult adatainak betöltése sikertelen: " +
                (error.message || "Ismeretlen hiba"),
                "error"
            );
        }
    }

    // ==========================================
    // MODULOK REGISZTRÁLÁSA
    // ==========================================

    function registerModule(page, callback) {
        modules[page] = callback;
    }

    // ==========================================
    // ESEMÉNYEK
    // ==========================================

    function initializeEvents() {
        $("loginForm")?.addEventListener("submit", login);
        $("registerForm")?.addEventListener("submit", register);

        $("showRegister")?.addEventListener("click", () => {
            showAuthView("register");
        });

        $("showLogin")?.addEventListener("click", () => {
            showAuthView("login");
        });

        $("logoutButton")?.addEventListener("click", logout);
        $("pendingLogout")?.addEventListener("click", logout);

        $("modalClose")?.addEventListener("click", closeModal);

        $("modalOverlay")?.addEventListener("click", event => {
            if (event.target === $("modalOverlay")) {
                closeModal();
            }
        });

        document.querySelectorAll(".nav-item").forEach(button => {
            button.addEventListener("click", () => {
                navigate(button.dataset.page);
            });
        });
    }

    // ==========================================
    // INDÍTÁS
    // ==========================================

    async function initialize() {
        if (!db) {
            showAuthView("login");

            notify(
                "A Supabase kapcsolat nem érhető el.",
                "error"
            );

            return;
        }

        initializeEvents();

        db.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_OUT") {
                state.user = null;
                state.profile = null;
                state.currentChild = null;

                showAuthView("login");
            }

            if (event === "SIGNED_IN" && session) {
                setTimeout(() => {
                    loadUser().catch(error => {
                        console.error(error);

                        notify(
                            "A felhasználó betöltése sikertelen.",
                            "error"
                        );
                    });
                }, 0);
            }
        });

        try {
            await loadUser();

        } catch (error) {
            console.error(error);

            notify(
                "Az alkalmazás indítása sikertelen.",
                "error"
            );

            showAuthView("login");
        }
    }

    // ==========================================
    // NYILVÁNOS SEGÉDFÜGGVÉNYEK
    // ==========================================

    window.Ruhatar = {
        db,
        state,
        ROLE_NAMES,
        STATUS_NAMES,
        $,
        escapeHTML,
        money,
        date,
        notify,
        showModal,
        closeModal,
        navigate,
        registerModule,
        loadDashboard,
        loadUser,
        isAdmin,
        canManageChildren,
        canCreatePurchase,
        canReview,
        getRoleName,
        getStatusName
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize
        );
    } else {
        initialize();
    }

})();