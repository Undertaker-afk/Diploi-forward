const PORT = Bun.env.PORT || 3000;
const HOSTNAME = Bun.env.HOSTNAME || "0.0.0.0";
const DIPLOI_AI_TOKEN = Bun.env.DIPLOI_AI_TOKEN;
const DIPLOI_AI_API_BASE_URL = Bun.env.DIPLOI_AI_API_BASE_URL || "http://core.diploi/ai-core-proxy/v1";

// Generate a random API key for this session/deployment
const GENERATED_API_KEY = "diploi-" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

console.log(`Starting server on ${HOSTNAME}:${PORT}`);
console.log(`Generated API Key: ${GENERATED_API_KEY}`);

const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static files from src/public
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(Bun.file("src/public/index.html"));
    }
    if (url.pathname === "/script.js") {
      return new Response(Bun.file("src/public/script.js"));
    }
    if (url.pathname === "/style.css") {
      return new Response(Bun.file("src/public/style.css"));
    }

    // Endpoint for frontend to get config
    if (url.pathname === "/api/config") {
      return Response.json({
        apiKey: GENERATED_API_KEY,
        models: [
          { name: "GPT-5.3-Codex", id: "gpt-5.3-codex", provider: "openai" },
          { name: "Claude Sonnet 4.6", id: "claude-sonnet-4-6", provider: "anthropic" }
        ]
      });
    }

    // Proxy AI requests
    if (url.pathname.startsWith("/v1/")) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.split(" ")[1] !== GENERATED_API_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }

      // Ensure the target URL correctly combines the base and the incoming path
      // DIPLOI_AI_API_BASE_URL is usually http://core.diploi/ai-core-proxy/v1
      const basePath = new URL(DIPLOI_AI_API_BASE_URL).pathname.replace(/\/$/, "");
      const incomingPath = url.pathname.replace(/^\/v1/, "");
      const targetUrl = new URL(basePath + "/v1" + incomingPath + url.search, DIPLOI_AI_API_BASE_URL);

      const headers = new Headers(req.headers);
      headers.set("Authorization", `Bearer ${DIPLOI_AI_TOKEN}`);
      // Remove host header to avoid issues with proxying
      headers.delete("host");

      try {
        const proxyReq = new Request(targetUrl, {
          method: req.method,
          headers: headers,
          body: req.body,
          redirect: "manual"
        });

        const response = await fetch(proxyReq);

        // Create a new response with the same body and status but potentially modified headers
        const newHeaders = new Headers(response.headers);
        newHeaders.delete("content-encoding"); // Let Bun handle encoding if needed

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      } catch (error) {
        console.error("Proxy error:", error);
        return new Response("Proxy error", { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});
