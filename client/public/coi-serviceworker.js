/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
//
// Vendored verbatim (github.com/gzuidhof/coi-serviceworker). This single file
// is loaded TWICE: once as a normal <script> in index.html (the `else` branch
// runs in the page and registers the SW + reloads once so it controls the
// page), and once as the service worker itself (the `if` branch injects the
// COOP/COEP/CORP response headers that enable cross-origin isolation —
// `crossOriginIsolated === true`, which mGBA's threaded WASM needs for
// SharedArrayBuffer). GitHub Pages cannot set these headers itself, so this
// shim is what makes the threaded emulator work on a static host (SPEC §9).
//
// COEP is hardcoded to `credentialless` (NOT require-corp): both give
// cross-origin isolation + SharedArrayBuffer, but require-corp BLOCKS Firebase
// RTDB's cross-origin traffic (the long-poll fallback fails with
// ERR_BLOCKED_BY_RESPONSE...DefaultedToSameOriginByCoep). Hardcoding the SW
// default (rather than relying on the window→SW postMessage, which only takes
// effect after a reload) makes the mode deterministic on first control. See
// DECISIONS D15.
let coepCredentialless = true;
if (typeof window === 'undefined') {
    // App-shell cache for offline launch + installability (SPEC §10). This is
    // layered ON TOP of the COOP/COEP header injection below — every response,
    // cached or network, gets the isolation headers re-applied, so caching
    // never weakens cross-origin isolation. Bump CACHE to invalidate old shells.
    const CACHE = "gba-shell-v3";

    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil((async () => {
        // Drop stale shell caches from older deploys.
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
    })()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    // Re-apply the cross-origin isolation headers to ANY response (network or
    // cache). Unchanged from upstream coi-serviceworker — this is the part that
    // makes crossOriginIsolated/SharedArrayBuffer work on a static host.
    function withCoiHeaders(response) {
        if (!response || response.status === 0) return response;
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy", coepCredentialless ? "credentialless" : "require-corp");
        if (!coepCredentialless) {
            newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
        }
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    }

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }
        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, { credentials: "omit" })
            : r;

        const url = new URL(r.url);
        const cacheable = r.method === "GET" && url.origin === self.location.origin;
        // The HTML entry point (and the runtime config) must never be served
        // stale, or a redeploy's new hashed bundle is never picked up. GitHub
        // Pages puts a short max-age on index.html, so bypass the HTTP cache for
        // navigations and the config file. Hashed JS/CSS are immutable by name.
        const bypassHttpCache = r.mode === "navigate" || url.pathname.endsWith("/firebase-config.json");
        const netRequest = bypassHttpCache ? new Request(request, { cache: "reload" }) : request;

        event.respondWith((async () => {
            // Network-first so live deploys + Firebase traffic stay fresh; the
            // app-shell cache is a fallback for offline launch only.
            try {
                const net = await fetch(netRequest);
                if (cacheable && net && net.status === 200 && net.type === "basic") {
                    const copy = net.clone();
                    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
                }
                return withCoiHeaders(net);
            } catch (e) {
                if (cacheable) {
                    const cached = await caches.match(request);
                    if (cached) return withCoiHeaders(cached);
                }
                throw e;
            }
        })());
    });

} else {
    (() => {
        const reloadedBySelf = window.sessionStorage.getItem("coiReloadedBySelf");
        window.sessionStorage.removeItem("coiReloadedBySelf");
        const coepDegrading = (reloadedBySelf == "coepdegrade");

        // You can customize the behavior of this script through a global `coi` variable.
        const coi = {
            shouldRegister: () => !reloadedBySelf,
            shouldDeregister: () => false,
            coepCredentialless: () => false,
            coepDegrade: () => true,
            doReload: () => window.location.reload(),
            quiet: false,
            ...window.coi
        };

        const n = navigator;
        const controlling = n.serviceWorker && n.serviceWorker.controller;

        // Record the failure if the page is served by serviceWorker.
        if (controlling && !window.crossOriginIsolated) {
            window.sessionStorage.setItem("coiCoepHasFailed", "true");
        }
        const coepHasFailed = window.sessionStorage.getItem("coiCoepHasFailed");

        if (controlling) {
            // Reload only on the first failure.
            const reloadToDegrade = coi.coepDegrade() && !(
                coepDegrading || window.crossOriginIsolated
            );
            n.serviceWorker.controller.postMessage({
                type: "coepCredentialless",
                value: (reloadToDegrade || coepHasFailed && coi.coepDegrade())
                    ? false
                    : coi.coepCredentialless(),
            });
            if (reloadToDegrade) {
                !coi.quiet && console.log("Reloading page to degrade COEP.");
                window.sessionStorage.setItem("coiReloadedBySelf", "coepdegrade");
                coi.doReload("coepdegrade");
            }

            if (coi.shouldDeregister()) {
                n.serviceWorker.controller.postMessage({ type: "deregister" });
            }
        }

        // If we're already coi: do nothing. Perhaps it's due to this script doing its job, or COOP/COEP are
        // already set from the origin server. Also if the browser has no notion of crossOriginIsolated, just give up here.
        if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;

        if (!window.isSecureContext) {
            !coi.quiet && console.log("COOP/COEP Service Worker not registered, a secure context is required.");
            return;
        }

        // In some environments (e.g. Firefox private mode) this won't be available
        if (!n.serviceWorker) {
            !coi.quiet && console.error("COOP/COEP Service Worker not registered, perhaps due to private mode.");
            return;
        }

        n.serviceWorker.register(window.document.currentScript.src).then(
            (registration) => {
                !coi.quiet && console.log("COOP/COEP Service Worker registered", registration.scope);

                registration.addEventListener("updatefound", () => {
                    !coi.quiet && console.log("Reloading page to make use of updated COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "updatefound");
                    coi.doReload();
                });

                // If the registration is active, but it's not controlling the page
                if (registration.active && !n.serviceWorker.controller) {
                    !coi.quiet && console.log("Reloading page to make use of COOP/COEP Service Worker.");
                    window.sessionStorage.setItem("coiReloadedBySelf", "notcontrolling");
                    coi.doReload();
                }
            },
            (err) => {
                !coi.quiet && console.error("COOP/COEP Service Worker failed to register:", err);
            }
        );
    })();
}
