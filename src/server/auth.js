import { createHmac, timingSafeEqual } from 'crypto'
import { getAppConfigValue } from './db.js'

const COOKIE_NAME = 'duckpull_session'
const SESSION_TTL_SECONDS = 60 * 60 * 12

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function getSessionSecret() {
  const secret = getAppConfigValue('session_secret')
  if (!secret) {
    throw new Error('Segredo de sessão não configurado.')
  }
  return secret
}

function signPayload(payload) {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('hex')
}

function parseCookies(headerValue) {
  if (!headerValue) {
    return {}
  }
  return Object.fromEntries(
    headerValue.split(';').map((part) => {
      const [rawKey, ...rest] = part.trim().split('=')
      return [rawKey, decodeURIComponent(rest.join('='))]
    })
  )
}

export function createSessionCookie() {
  const expiresAt = nowSeconds() + SESSION_TTL_SECONDS
  const payload = `${expiresAt}`
  const signature = signPayload(payload)
  const token = `${payload}.${signature}`
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
}

export function isAuthenticated(request) {
  const cookieHeader = request.headers.get('cookie')
  const cookies = parseCookies(cookieHeader)
  const rawToken = cookies[COOKIE_NAME]
  if (!rawToken) {
    return false
  }

  const [payload, signature] = rawToken.split('.')
  if (!payload || !signature) {
    return false
  }

  const expectedSignature = signPayload(payload)
  const left = Buffer.from(signature)
  const right = Buffer.from(expectedSignature)
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return false
  }

  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds()) {
    return false
  }

  return true
}

export async function verifyPassword(password) {
  const passwordHash = getAppConfigValue('ui_password_hash')
  if (!passwordHash) {
    return false
  }
  return await Bun.password.verify(password, passwordHash)
}
