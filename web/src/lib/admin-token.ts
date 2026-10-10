/** POST for admin actions (report review, dispatch). Open for the demo: no admin token. */
export const adminPost = (url: string, body: unknown, _near?: HTMLElement): Promise<Response> =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
