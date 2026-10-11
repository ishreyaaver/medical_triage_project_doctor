import { createClient } from "@supabase/supabase-js";

/*
  Supabase client for the Doctor Portal.

  Only the PUBLIC project URL and anon (publishable) key belong in the browser.
  Row-Level Security in your existing Doctor Supabase project is what protects
  the data. Never put a service-role or secret key in any VITE_* variable:
  Vite copies every VITE_* value into the public JavaScript bundle.
*/
const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

function isPrivilegedKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  try {
    const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).role === "service_role";
  } catch {
    return false;
  }
}

let issue = "";
let client = null;

if (!url || !anonKey) {
  issue = "The Supabase project URL and anon key have not been set.";
} else if (/YOUR[-_]/i.test(url) || /YOUR[-_]/i.test(anonKey)) {
  issue = "The Supabase settings still contain placeholder values.";
} else if (!/^https:\/\//.test(url)) {
  issue = "VITE_SUPABASE_URL must be an https:// project URL.";
} else if (isPrivilegedKey(anonKey)) {
  issue =
    "The configured key is a secret or service-role key. Remove it and use the public anon key. Rotate the exposed key in Supabase.";
} else {
  client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export const supabase = client;
export const supabaseConfig = { configured: client !== null, issue };
