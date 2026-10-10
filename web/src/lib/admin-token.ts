/**
 * POST for admin actions (report review, dispatch). Sends the saved admin token; if the server asks for one (the live
 * site sets ADMIN_TOKEN, a laptop usually doesn't), a small box appears where the action was, then the action retries.
 */
const KEY = "admin-token";
const saved = () => { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } };
const save = (t: string) => { try { sessionStorage.setItem(KEY, t); } catch { /* storage blocked: asked again next time */ } };

/** A token box next to `near`; resolves with what was typed, or "" if closed. */
function ask(near: HTMLElement, wrong: boolean): Promise<string> {
  document.getElementById("admin-token-ask")?.remove();
  const box = document.createElement("div");
  box.id = "admin-token-ask";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Admin token");
  box.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:8px 0;padding:8px;border:1px solid #5b4111;border-radius:8px;background:#1c160b;font-size:12px";
  box.innerHTML = `<span style="color:#f59e0b">${wrong ? "Wrong admin token." : "This needs the admin token."}</span>
    <input type="password" placeholder="Admin token" aria-label="Admin token" style="flex:1;min-width:120px;background:#141c26;color:#dbe5ef;border:1px solid #1f2b38;border-radius:6px;padding:6px 8px" />
    <button class="btn small">Save</button><button class="link small">Cancel</button>`;
  near.after(box);
  const input = box.querySelector("input")!;
  input.focus();
  return new Promise((resolve) => {
    const done = (v: string) => { box.remove(); resolve(v); };
    box.querySelector<HTMLButtonElement>(".btn")!.onclick = () => done(input.value.trim());
    box.querySelector<HTMLButtonElement>(".link")!.onclick = () => done("");
    input.onkeydown = (e) => { if (e.key === "Enter") done(input.value.trim()); if (e.key === "Escape") done(""); };
  });
}

export async function adminPost(url: string, body: unknown, near: HTMLElement): Promise<Response> {
  const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": saved() }, body: JSON.stringify(body) });
  let r = await send();
  for (let tries = 0; r.status === 401 && tries < 3; tries++) {
    const t = await ask(near, tries > 0 || !!saved());
    if (!t) return r;
    save(t);
    r = await send();
  }
  return r;
}
