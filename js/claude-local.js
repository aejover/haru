// claude-local.js — Claude for the "이 기기에서만" mode: the person's own API key, kept in this browser,
// talks to Anthropic directly. Same request shape and error codes as the 하루 server's /api/ai.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const KEY = 'haru.apiKey', MODEL = 'haru.model';
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const read = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
export const localKey = () => read(KEY);
export const localModel = () => read(MODEL) || 'claude-opus-5-5';
export function setLocalKey(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } client = null; }
export function setLocalModel(v) { try { localStorage.setItem(MODEL, v); } catch { /* storage blocked */ } }

let sdk = null, client = null, clientKey = '';
async function getClient() {
  const key = localKey();
  if (!key) throw Object.assign(new Error('Claude API 키가 없어요. 설정 → Claude에서 내 API 키를 넣어 주세요.'), { code: 'no_key' });
  sdk ||= (await import(SDK_URL)).default;
  if (!client || clientKey !== key) { client = new sdk({ apiKey: key, dangerouslyAllowBrowser: true }); clientKey = key; }
  return client;
}

function claudeError(e) {
  const A = sdk;
  if (A && e instanceof A.AuthenticationError) return { code: 'auth', message: 'Claude API 키가 올바르지 않아요. 설정에서 키를 확인하세요.' };
  if (A && e instanceof A.PermissionDeniedError) return { code: 'permission', message: '이 API 키로는 선택한 모델을 쓸 수 없어요.' };
  if (A && e instanceof A.RateLimitError) return { code: 'rate', message: '요청이 많아요. 잠시 뒤 다시 시도하세요.' };
  if (A && e instanceof A.BadRequestError) return { code: 'bad_request', message: '요청 형식 오류: ' + e.message };
  if (A && e instanceof A.APIConnectionError) return { code: 'network', message: 'Claude 서버에 연결하지 못했어요. 인터넷 연결을 확인하세요.' };
  if (A && e instanceof A.APIError) return { code: 'api', message: `Claude 오류 (${e.status}): ${e.message}` };
  if (e.code) return { code: e.code, message: e.message };
  if (!sdk) return { code: 'network', message: 'Claude 연결 도구를 불러오지 못했어요. 인터넷 연결을 확인하세요.' };
  return { code: 'unknown', message: e.message || '알 수 없는 오류' };
}

export async function runClaudeLocal({ system, messages, tools, effort = 'medium', max_tokens, format }) {
  try {
    const c = await getClient();
    const model = localModel();
    const params = { model, messages, max_tokens: max_tokens || (tools?.length ? 16000 : 32000), output_config: { effort } };
    if (system) params.system = system;
    if (format) params.output_config.format = { type: 'json_schema', schema: format };
    if (FALLBACK_MODELS.has(model)) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    let msg;
    if (tools?.length) { params.tools = tools; msg = await c.beta.messages.create(params); }
    else msg = await c.beta.messages.stream(params).finalMessage();
    return { content: msg.content, stop_reason: msg.stop_reason, stop_details: msg.stop_details ?? null, model: msg.model, usage: msg.usage };
  } catch (e) {
    const err = claudeError(e);
    throw Object.assign(new Error(err.message), { code: err.code });
  }
}
