// In-app replacements for window.prompt / window.confirm, which aren't
// supported in some embedded webviews (e.g. the VS Code webview this app
// runs in — calling them throws "prompt() is not supported").
//
//   await uiPrompt("Name:", "default")  → string | null   (null = cancelled)
//   await uiConfirm("Sure?")            → true | false
//
// Both render a small centered modal over a dimming backdrop. Enter = OK,
// Escape / backdrop click / Cancel = dismiss.

let current = null;

function dialog(message, { input, okLabel = "OK" } = {}) {
    return new Promise((resolve) => {
        if (current) current.cleanup();

        const hasInput = input !== undefined;
        const cancelVal = hasInput ? null : false;

        const backdrop = document.createElement("div");
        backdrop.className = "overlay";
        backdrop.innerHTML = `
            <div class="wiz-box" role="dialog" aria-modal="true">
                <div class="ui-dialog-msg"></div>
                ${hasInput ? `<input class="ui-dialog-input" type="text">` : ""}
                <div class="wiz-foot">
                    <button class="btn ui-dialog-cancel">Cancel</button>
                    <button class="btn primary ui-dialog-ok"></button>
                </div>
            </div>`;
        backdrop.querySelector(".ui-dialog-msg").textContent = message;
        backdrop.querySelector(".ui-dialog-ok").textContent = okLabel;
        const inputEl = hasInput ? backdrop.querySelector(".ui-dialog-input") : null;
        if (inputEl) inputEl.value = input ?? "";

        function cleanup() {
            document.removeEventListener("keydown", onKey, true);
            backdrop.remove();
            current = null;
        }
        function finish(val) { cleanup(); resolve(val); }
        function onKey(e) {
            if (e.key === "Escape") { e.preventDefault(); finish(cancelVal); }
            else if (e.key === "Enter") { e.preventDefault(); finish(hasInput ? inputEl.value : true); }
        }

        current = { cleanup };
        document.addEventListener("keydown", onKey, true);
        backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) finish(cancelVal); });
        backdrop.querySelector(".ui-dialog-cancel").onclick = () => finish(cancelVal);
        backdrop.querySelector(".ui-dialog-ok").onclick = () => finish(hasInput ? inputEl.value : true);

        document.body.appendChild(backdrop);
        if (inputEl) { inputEl.focus(); inputEl.select(); }
    });
}

/** Prompt for text. Resolves to the entered string, or null if cancelled. */
export function uiPrompt(message, defaultValue = "") {
    return dialog(message, { input: defaultValue });
}

/** Yes/no confirmation. Resolves to true (OK) or false (cancel). */
export function uiConfirm(message, okLabel = "OK") {
    return dialog(message, { okLabel });
}

/** Pick one option from a list (radio-style, each with an optional colour
 *  swatch). `options` = [{ value, label, color? }]. Resolves to the chosen
 *  value, or null if cancelled. `defaultValue` pre-selects an option. */
export function uiChoose(message, options, { defaultValue, okLabel = "OK" } = {}) {
    return new Promise((resolve) => {
        if (current) current.cleanup();
        let selected = defaultValue ?? (options[0] && options[0].value);

        const backdrop = document.createElement("div");
        backdrop.className = "overlay";
        backdrop.innerHTML = `
            <div class="wiz-box" role="dialog" aria-modal="true">
                <div class="ui-dialog-msg"></div>
                <div class="ui-dialog-choices"></div>
                <div class="wiz-foot">
                    <button class="btn ui-dialog-cancel">Cancel</button>
                    <button class="btn primary ui-dialog-ok"></button>
                </div>
            </div>`;
        backdrop.querySelector(".ui-dialog-msg").textContent = message;
        backdrop.querySelector(".ui-dialog-ok").textContent = okLabel;

        const choicesEl = backdrop.querySelector(".ui-dialog-choices");
        const rows = options.map((o) => {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "ui-dialog-choice";
            row.dataset.value = String(o.value);
            if (o.color) {
                const sw = document.createElement("span");
                sw.className = "ui-dialog-choice-sw";
                sw.style.background = String(o.color).replace(/[^#0-9a-zA-Z(),.% ]/g, "");
                row.appendChild(sw);
            }
            const lbl = document.createElement("span");
            lbl.className = "ui-dialog-choice-label";
            lbl.textContent = o.label;
            row.appendChild(lbl);
            row.onclick = () => { selected = o.value; sync(); };
            choicesEl.appendChild(row);
            return row;
        });
        const sync = () => rows.forEach(r => r.classList.toggle("selected", r.dataset.value === String(selected)));
        sync();

        function cleanup() { document.removeEventListener("keydown", onKey, true); backdrop.remove(); current = null; }
        function finish(val) { cleanup(); resolve(val); }
        function onKey(e) {
            if (e.key === "Escape") { e.preventDefault(); finish(null); }
            else if (e.key === "Enter") { e.preventDefault(); finish(selected ?? null); }
        }
        current = { cleanup };
        document.addEventListener("keydown", onKey, true);
        backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) finish(null); });
        backdrop.querySelector(".ui-dialog-cancel").onclick = () => finish(null);
        backdrop.querySelector(".ui-dialog-ok").onclick = () => finish(selected ?? null);
        document.body.appendChild(backdrop);
    });
}
