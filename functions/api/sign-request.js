const BROWSER_HEADERS = {
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "sec-ch-ua": '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "referer": "https://www.drumkits.site/",
  "content-type": "application/json",
};

function getAllowedOrigin(request) {
  const origin = request.headers.get("origin") ?? "";
  if (
    origin === "https://yekub2026.com" ||
    /^https:\/\/[a-z0-9-]+\.yekub2026\.com$/.test(origin)
  ) {
    return origin;
  }
  return null;
}

export async function onRequestPost({ request }) {
  const allowedOrigin = getAllowedOrigin(request);
  if (!allowedOrigin) return new Response("Forbidden", { status: 403 });

  const body = await request.text();
  const resp = await fetch("https://www.drumkits.site/api/sign-request", {
    method: "POST",
    headers: BROWSER_HEADERS,
    body,
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: { "content-type": "application/json", "access-control-allow-origin": allowedOrigin },
  });
}

export async function onRequestOptions({ request }) {
  const allowedOrigin = getAllowedOrigin(request);
  if (!allowedOrigin) return new Response("Forbidden", { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
}
