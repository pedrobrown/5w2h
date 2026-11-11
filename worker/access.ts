import { createRemoteJWKSet, jwtVerify, type RemoteJWKSet } from 'jose'
import type { MiddlewareHandler } from 'hono'

const jwksByIssuer = new Map<string, RemoteJWKSet>()

function remoteKeys(issuer: string): RemoteJWKSet {
  let keys = jwksByIssuer.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
    jwksByIssuer.set(issuer, keys)
  }
  return keys
}

export const requireAccess: MiddlewareHandler<{ Bindings: Env }> = async (context, next) => {
  const hostname = new URL(context.req.url).hostname
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    await next()
    return
  }

  const issuer = context.env.ACCESS_ISSUER.replace(/\/$/, '')
  const audience = context.env.ACCESS_AUD
  if (issuer.endsWith('.example') || audience.startsWith('configure-')) {
    return context.json({ error: 'Cloudflare Access ainda não está configurado.' }, 503)
  }

  const assertion = context.req.header('Cf-Access-Jwt-Assertion')
  if (!assertion) return context.json({ error: 'Autenticação necessária.' }, 401)

  try {
    await jwtVerify(assertion, remoteKeys(issuer), { issuer, audience })
  } catch {
    return context.json({ error: 'Sessão Cloudflare Access inválida ou expirada.' }, 401)
  }

  await next()
}
