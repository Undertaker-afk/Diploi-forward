import { createServer } from 'node:http';
import { parse as parseYaml } from 'yaml';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const TOKEN = process.env.DIPLOI_AI_TOKEN;
const BASE_URL = process.env.DIPLOI_AI_API_BASE_URL;
const MAX_PAYLOAD_SIZE_BYTES = 1024 * 1024;

if (!TOKEN || !BASE_URL) {
  console.error('Missing required env vars: DIPLOI_AI_TOKEN and DIPLOI_AI_API_BASE_URL');
  process.exit(1);
}

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': '*'
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);

const lastDiscoveredConfig = {
  repo: null,
  ref: null,
  path: null,
  providers: []
};

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_PAYLOAD_SIZE_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseRepoIdentifier(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();

  const shortMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2].replace(/\.git$/, '') };
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'github.com') {
      return null;
    }

    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) {
      return null;
    }

    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, '')
    };
  } catch {
    return null;
  }
}

function normalizeProxyPath(rawPath) {
  if (rawPath.startsWith('/openai/')) {
    return rawPath.slice('/openai'.length);
  }

  if (rawPath.startsWith('/anthropic/')) {
    return rawPath.slice('/anthropic'.length);
  }

  return rawPath;
}

function buildTargetUrl(baseUrl, incomingPath, incomingSearch) {
  const upstream = new URL(baseUrl);
  const upstreamBasePath = upstream.pathname.replace(/\/$/, '');
  const cleanPath = incomingPath.startsWith('/') ? incomingPath : `/${incomingPath}`;

  upstream.pathname = `${upstreamBasePath}${cleanPath}`;
  upstream.search = incomingSearch;

  return upstream.toString();
}

function toFetchHeaders(req) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(','));
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  return headers;
}

function shouldProxy(pathname) {
  return pathname.startsWith('/v1/') || pathname.startsWith('/openai/v1/') || pathname.startsWith('/anthropic/v1/');
}

function sanitizeGitRef(ref) {
  if (typeof ref !== 'string') {
    throw new Error('Invalid ref format.');
  }

  const trimmedRef = ref.trim();
  const isValidPattern = /^[A-Za-z0-9._/-]+$/.test(trimmedRef);
  const hasTraversal = trimmedRef.includes('..');

  if (!trimmedRef || trimmedRef.startsWith('/') || trimmedRef.endsWith('/') || hasTraversal || !isValidPattern) {
    throw new Error('Invalid ref. Use only alphanumeric, dot, underscore, hyphen and slash.');
  }

  return trimmedRef;
}

async function discoverDiploiConfig(repoInput, explicitRef) {
  const parsed = parseRepoIdentifier(repoInput);
  if (!parsed) {
    throw new Error('Invalid repo format. Use "owner/repo" or "https://github.com/owner/repo".');
  }

  const refsToTry = explicitRef ? [sanitizeGitRef(explicitRef)] : ['main', 'master'];
  const pathsToTry = ['diploi.yaml', 'diploi.yml', '.diploi/diploi.yaml', '.diploi/diploi.yml'];

  for (const ref of refsToTry) {
    for (const configPath of pathsToTry) {
      const encodedRef = ref
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${encodedRef}/${configPath}`;
      const response = await fetch(rawUrl);
      if (!response.ok) {
        continue;
      }

      const yamlText = await response.text();
      const parsedYaml = parseYaml(yamlText);
      const models = Array.isArray(parsedYaml?.models) ? parsedYaml.models : [];
      const providerValues = models.map((model) => model?.provider).filter(Boolean);
      const uniqueProviders = new Set(providerValues);
      const providers = [...uniqueProviders];

      return {
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        path: configPath,
        providers,
        modelCount: models.length,
        models: models.map((model) => ({
          name: model?.name ?? null,
          provider: model?.provider ?? null,
          model: model?.model ?? null,
          apiBase: model?.apiBase ?? null,
          apiKey: model?.apiKey ? 'configured' : 'not_configured'
        }))
      };
    }
  }

  throw new Error('Unable to find diploi.yaml/diploi.yml in the target repository.');
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (requestUrl.pathname === '/health' && req.method === 'GET') {
    writeJson(res, 200, {
      ok: true,
      service: 'diploi-forward',
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (requestUrl.pathname === '/config' && req.method === 'GET') {
    writeJson(res, 200, {
      baseUrlConfigured: Boolean(BASE_URL),
      tokenConfigured: Boolean(TOKEN),
      lastDiscoveredConfig
    });
    return;
  }

  if (requestUrl.pathname === '/configure/repo' && req.method === 'POST') {
    try {
      const rawBody = await collectBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const discovered = await discoverDiploiConfig(body.repo ?? body.githubRepo, body.ref);

      lastDiscoveredConfig.repo = `${discovered.owner}/${discovered.repo}`;
      lastDiscoveredConfig.ref = discovered.ref;
      lastDiscoveredConfig.path = discovered.path;
      lastDiscoveredConfig.providers = discovered.providers;

      writeJson(res, 200, {
        ok: true,
        discovered
      });
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid request'
      });
    }

    return;
  }

  if (!shouldProxy(requestUrl.pathname)) {
    writeJson(res, 404, {
      ok: false,
      error: 'Not found. Use /v1/*, /openai/v1/*, /anthropic/v1/*, /configure/repo, /health or /config.'
    });
    return;
  }

  const method = req.method ?? 'GET';
  const proxiedPath = normalizeProxyPath(requestUrl.pathname);
  const targetUrl = buildTargetUrl(BASE_URL, proxiedPath, requestUrl.search);

  try {
    const headers = toFetchHeaders(req);
    headers.set('authorization', `Bearer ${TOKEN}`);

    if (requestUrl.pathname.startsWith('/anthropic/')) {
      headers.set('x-api-key', TOKEN);
    }

    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : req,
      duplex: ['GET', 'HEAD'].includes(method) ? undefined : 'half'
    });

    const responseHeaders = {};
    upstreamResponse.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    res.writeHead(upstreamResponse.status, {
      ...CORS_HEADERS,
      ...responseHeaders
    });

    if (!upstreamResponse.body) {
      res.end();
      return;
    }

    for await (const chunk of upstreamResponse.body) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    writeJson(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : 'Upstream request failed'
    });
  }
});

server.listen(PORT, () => {
  console.log(`diploi-forward listening on port ${PORT}`);
});
