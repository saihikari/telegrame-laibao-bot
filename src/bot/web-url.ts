function normalizeConfigUrl(value: string | undefined) {
  if (!value) return '';
  let current = value.trim();
  for (let i = 0; i < 5; i += 1) {
    const next =
      current.length >= 2 &&
      ((current.startsWith('`') && current.endsWith('`')) ||
        (current.startsWith('"') && current.endsWith('"')) ||
        (current.startsWith("'") && current.endsWith("'")))
        ? current.slice(1, -1).trim()
        : current;
    if (next === current) break;
    current = next;
  }
  return current;
}

export function getPublicWebBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const adminPort = (env.ADMIN_PORT || env.PORT || '8090').trim();
  const configured =
    normalizeConfigUrl((env as NodeJS.ProcessEnv & { WEBDOMAIN?: string }).WEBDOMAIN) ||
    normalizeConfigUrl(env.WEB_DOMAIN) ||
    normalizeConfigUrl(env.WEBHOOK_URL);

  if (!configured) {
    return `http://127.0.0.1:${adminPort}`;
  }

  const trimmed = configured.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/:\d+$/.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return `http://${trimmed}:${adminPort}`;
}

export function getAdminBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return `${getPublicWebBaseUrl(env)}/admin/`;
}

export function isPublicWebBaseUrlSecure(env: NodeJS.ProcessEnv = process.env) {
  return /^https:\/\//i.test(getPublicWebBaseUrl(env));
}
