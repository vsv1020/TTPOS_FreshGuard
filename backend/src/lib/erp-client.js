// Pure HTTP client for the ERPNext (Frappe) REST API. No DB access. Uses the
// global fetch (Node 18+). Every error is a typed { kind, message } object with
// any Authorization header / api_secret scrubbed before it can reach a log or
// audit trail.
//
// kind:
//   'timeout'     request exceeded timeoutMs
//   'auth'        401/403 from Frappe
//   'unreachable' network failure (DNS, refused, reset)
//   'frappe'      any other non-2xx, or a malformed body

const DEFAULT_TIMEOUT_MS = 10000;

class ErpError extends Error {
  constructor(kind, message) {
    super(sanitizeMessage(message));
    this.name = 'ErpError';
    this.kind = kind;
  }
}

// Strips anything that looks like a credential out of a free-text message so a
// thrown error never leaks `token key:secret` into logs/audit detail.
function sanitizeMessage(message) {
  let text = String(message == null ? '' : message);
  // `Authorization: token <key>:<secret>` (any casing, with or without quotes)
  text = text.replace(/authorization\s*[:=]\s*["']?token\s+[^\s"']+/gi, 'Authorization: token [REDACTED]');
  // bare `token key:secret`
  text = text.replace(/token\s+[^\s"':]+:[^\s"']+/gi, 'token [REDACTED]');
  return text;
}

function buildUrl(baseUrl, resourcePath, query) {
  const trimmedBase = String(baseUrl || '').replace(/\/+$/, '');
  const path = String(resourcePath || '').replace(/^\/+/, '');
  const url = new URL(`${trimmedBase}/${path}`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) {
        continue;
      }
      url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
  return url.toString();
}

// Single GET against a Frappe resource. Resolves the parsed JSON body, or
// rejects with a typed ErpError (credentials scrubbed). The Authorization
// header is built locally and never attached to any rejection.
async function erpGet({ baseUrl, apiKey, apiSecret, resourcePath, query, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = buildUrl(baseUrl, resourcePath, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `token ${apiKey}:${apiSecret}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error && error.name === 'AbortError') {
      throw new ErpError('timeout', `ERP request timed out after ${timeoutMs}ms`);
    }
    throw new ErpError('unreachable', `ERP host unreachable: ${error?.message || error}`);
  }
  clearTimeout(timer);

  if (response.status === 401 || response.status === 403) {
    throw new ErpError('auth', `ERP authentication failed (HTTP ${response.status})`);
  }

  let body;
  let rawText = '';
  try {
    rawText = await response.text();
    body = rawText ? JSON.parse(rawText) : {};
  } catch (_error) {
    throw new ErpError('frappe', `ERP returned a non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const detail = body && body.message ? body.message : rawText.slice(0, 200);
    throw new ErpError('frappe', `ERP error (HTTP ${response.status}): ${detail}`);
  }

  return body;
}

// Offset pagination over a Frappe doctype list. FULLY succeeds or FULLY fails:
// any page error aborts the whole walk and propagates the typed error, so a
// caller never sees a partial item list.
async function listAll({
  baseUrl,
  apiKey,
  apiSecret,
  resourcePath,
  fields,
  filters,
  pageSize = 100,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const all = [];
  let limitStart = 0;

  // Hard upper bound so a misbehaving server can't loop forever.
  for (let page = 0; page < 10000; page += 1) {
    const query = {
      limit_start: limitStart,
      limit_page_length: pageSize
    };
    if (fields) {
      query.fields = fields;
    }
    if (filters) {
      query.filters = filters;
    }

    // No try/catch: a thrown ErpError aborts the entire fetch (fail-closed).
    const body = await erpGet({ baseUrl, apiKey, apiSecret, resourcePath, query, timeoutMs });
    const rows = Array.isArray(body && body.data) ? body.data : [];
    all.push(...rows);

    if (rows.length < pageSize) {
      // Short page => last page.
      break;
    }
    limitStart += pageSize;
  }

  return all;
}

module.exports = {
  ErpError,
  sanitizeMessage,
  erpGet,
  listAll
};
