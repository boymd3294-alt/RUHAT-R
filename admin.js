
"use strict";

/*
 * RUHATÁR – Adminisztrációs modul
 */

(() => {
    const R = window.Ruhatar;
    if (!R) return;

    const { db, $, escapeHTML, notify, showModal } = R;

    const ROLE_NAMES = {
        admin: "Adminisztrátor",
        foster_parent: "Nevelőszülő",
        advisor: "Tanácsadó",
        viewer: "Megtekintő"
    };

    let pendingUsers = [];
    let activeUsers = [];
    let initialized = false;

    function ensureAdmin() {
        if (R.isAdmin()) return true;

        notify("Ehhez adminisztrátori jogosultság szükséges.", "error");
        return false;
    }

    function roleName(role) {
        return ROLE_NAMES[role] || role || "Nincs megadva";
    }

    async function loadUsers() {
        if (!ensureAdmin()) return;

        const { data, error } = await db
            .from("profiles")
            .select("id,full_name,role,requested_role,status,created_at")
            .order("created_at", { ascending: false });

        if (error) {
            console.error(error);
            notify("A felhasználók betöltése sikertelen.", "error");
            return;
        }

        const users = data || [];

        pendingUsers = users.filter(user => user.status === "pending");
        activeUsers = users.filter(user => user.status === "approved");

        renderPendingUsers();
        renderActiveUsers();
    }

    function renderPendingUsers() {
        const container = $("pendingUsersTable");
        if (!container) return;

        container.innerHTML = pendingUsers.length
            ? pendingUsers.map(user => `
                <tr>
                    <td>${escapeHTML(user.full_name || "Névtelen")}</td>
                    <td>${escapeHTML(roleName(user.requested_role))}</td>
                    <td>${user.created_at
                        ? new Date(user.created_at).toLocaleDateString("hu-HU")
                        : "–"}</td>
                    <td>
                        <button class="primary-button"
                            data-user-approve="${user.id}">
                            Jóváhagyás
                        </button>

                        <button class="secondary-button"
                            data-user-reject="${user.id}">
                            Elutasítás
                        </button>
                    </td>
                </tr>
            `).join("")
            : `<tr><td colspan="4">Nincs jóváhagyásra váró felhasználó.</td></tr>`;
    }

    function renderActiveUsers() {
        const container = $("activeUsersTable");
        if (!container) return;

        container.innerHTML = activeUsers.length
            ? activeUsers.map(user => `
                <tr>
                    <td>${escapeHTML(user.full_name || "Névtelen")}</td>
                    <td>${escapeHTML(roleName(user.role))}</td>
                    <td>${escapeHTML(user.status)}</td>
                    <td>
                        <button class="secondary-button"
                            data-user-role="${user.id}">
                            Szerepkör módosítása
                        </button>
                    </td>
                </tr>
            `).join("")
            : `<tr><td colspan="4">Nincs jóváhagyott felhasználó.</td></tr>`;
    }

    async function approveUser(userId) {
        if (!ensureAdmin()) return;

        const user = pendingUsers.find(item => item.id === userId);
        if (!user) return;

        const requestedRole = Object.hasOwn(ROLE_NAMES, user.requested_role)
            ? user.requested_role
            : "viewer";

        if (!window.confirm(
            `${user.full_name || "A felhasználó"} jóváhagyása ${roleName(requestedRole)} szerepkörrel?`
        )) return;

        const { error } = await db
            .from("profiles")
            .update({
                role: requestedRole,
                status: "approved"
            })
            .eq("id", userId)
            .eq("status", "pending");

        if (error) {
            notify("A jóváhagyás sikertelen: " + error.message, "error");
            return;
        }

        notify("A felhasználó jóváhagyva.");
        await loadUsers();
    }

    async function rejectUser(userId) {
        if (!ensureAdmin()) return;

        const user = pendingUsers.find(item => item.id === userId);
        if (!user) return;

        if (!window.confirm(
            `${user.full_name || "A felhasználó"} regisztrációjának elutasítása?`
        )) return;

        const { error } = await db
            .from("profiles")
            .update({ status: "rejected" })
            .eq("id", userId)
            .eq("status", "pending");

        if (error) {
            notify("Az elutasítás sikertelen: " + error.message, "error");
            return;
        }

        notify("A regisztráció elutasítva.");
        await loadUsers();
    }

    async function changeRole(userId) {
        if (!ensureAdmin()) return;

        const user = activeUsers.find(item => item.id === userId);
        if (!user) return;

        const options = Object.entries(ROLE_NAMES).map(([value, label]) => `
            <option value="${value}" ${user.role === value ? "selected" : ""}>
                ${label}
            </option>
        `).join("");

        showModal(`
            <h2>Szerepkör módosítása</h2>
            <p>${escapeHTML(user.full_name || "Felhasználó")}</p>

            <form id="changeRoleForm">
                <label>Új szerepkör</label>
                <select id="newUserRole" required>
                    ${options}
                </select>

                <button type="submit" class="primary-button">
                    Mentés
                </button>
            </form>
        `);

        $("changeRoleForm").addEventListener("submit", async event => {
            event.preventDefault();

            const role = $("newUserRole").value;

            if (!Object.hasOwn(ROLE_NAMES, role)) {
                notify("Érvénytelen szerepkör.", "error");
                return;
            }

            const { error } = await db
                .from("profiles")
                .update({ role })
                .eq("id", userId)
                .eq("status", "approved");

            if (error) {
                notify("A módosítás sikertelen: " + error.message, "error");
                return;
            }

            R.closeModal();
            notify("A szerepkör módosítva.");

            await loadUsers();
        });
    }

    async function loadAuditLogs() {
        if (!ensureAdmin()) return;

        const container = $("auditLogsTable");
        if (!container) return;

        const { data, error } = await db
            .from("audit_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {
            console.error(error);
            notify("A napló betöltése sikertelen.", "error");
            return;
        }

        const logs = data || [];

        const actorIds = [...new Set(
            logs.map(log => log.actor_id).filter(Boolean)
        )];

        let profiles = [];

        if (actorIds.length) {
            const result = await db
                .from("profiles")
                .select("id,full_name")
                .in("id", actorIds);

            if (!result.error) profiles = result.data || [];
        }

        container.innerHTML = logs.length
            ? logs.map(log => {
                const actor = profiles.find(
                    item => item.id === log.actor_id
                );

                return `
                    <tr>
                        <td>${log.created_at
                            ? new Date(log.created_at).toLocaleString("hu-HU")
                            : "–"}</td>
                        <td>${escapeHTML(actor?.full_name || "Ismeretlen")}</td>
                        <td>${escapeHTML(log.table_name || "–")}</td>
                        <td>${escapeHTML(log.operation || "–")}</td>
                        <td>${escapeHTML(log.record_id || "–")}</td>
                    </tr>
                `;
            }).join("")
            : `<tr><td colspan="5">Még nincs naplózott módosítás.</td></tr>`;
    }

    function initializeEvents() {
        if (initialized) return;
        initialized = true;

        document.addEventListener("click", event => {
            const approve = event.target.closest("[data-user-approve]");
            const reject = event.target.closest("[data-user-reject]");
            const role = event.target.closest("[data-user-role]");

            if (approve) approveUser(approve.dataset.userApprove);
            if (reject) rejectUser(reject.dataset.userReject);
            if (role) changeRole(role.dataset.userRole);
        });
    }

    async function loadAdminPage() {
        if (!ensureAdmin()) return;

        initializeEvents();
        await loadUsers();
    }

    R.registerModule("users", loadAdminPage);
    R.registerModule("settings", loadAuditLogs);

    window.RuhatarAdmin = {
        loadUsers,
        loadAdminPage,
        approveUser,
        rejectUser,
        changeRole,
        loadAuditLogs
    };

})();
