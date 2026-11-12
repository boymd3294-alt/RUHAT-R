
"use strict";

/*
 * RUHATÁR – Supabase konfiguráció
 */

(() => {
    const SUPABASE_URL = "https://rqhpkunulnfohzkoiqkc.supabase.co";

    const SUPABASE_PUBLISHABLE_KEY =
        "sb_publishable_t6raeC3TQEKbE_WDKN37rw_Ttgc0Jgu";

    if (!window.supabase) {
        console.error("A Supabase könyvtár nem töltődött be.");
        return;
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        console.error("Hiányzó Supabase konfiguráció.");
        return;
    }

    window.supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
            auth: {
                autoRefreshToken: true,
                persistSession: true,
                detectSessionInUrl: true,
                storage: window.localStorage
            }
        }
    );

    console.log("RUHATÁR – Supabase kapcsolat inicializálva.");
})();
