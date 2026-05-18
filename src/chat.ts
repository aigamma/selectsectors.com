// SelectBot — the chat panel.
//
// A focused, self-contained module. The chat UI is a floating toggle
// button at the bottom-right that opens a slide-up panel containing
// the conversation, an input area, and a clear-conversation button.
// Conversation history is persisted to localStorage so a refresh
// preserves context; the server-side chat function is stateless and
// receives the full history on every turn.
//
// The streaming wire format is SSE: each chunk arrives as a
// `data: {...}\n\n` frame with a typed payload (text_delta, done, or
// error). The DOM accumulates the streaming text into the last
// assistant message and saves to localStorage after each frame so a
// refresh mid-stream loses only the unsent suffix.

import { formatTimeUntilReset } from './page-utils.ts';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SseTextDelta {
  type: 'text_delta';
  text: string;
}

interface SseDone {
  type: 'done';
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  rateLimits?: ChatRateLimitInfo;
}

interface SseError {
  type: 'error';
  message: string;
}

type SseEvent = SseTextDelta | SseDone | SseError;

interface ChatRateLimitInfo {
  hourly: { limit: number; used: number; remaining: number; resetAt: number };
  daily: { limit: number; used: number; remaining: number; resetAt: number };
}

interface ChatStatusResponse extends ChatRateLimitInfo {
  caps: { hour: number; day: number };
  /** False when ANTHROPIC_API_KEY is not set on the deploy. The
   *  chat function returns 503 for every send when this is false;
   *  the panel disables the send button preemptively. */
  available?: boolean;
}

const STORAGE_KEY = 'selectbot-conversation-v1';
const MAX_HISTORY = 30;
const MAX_MESSAGE_CHARS = 4000;

const WELCOME_PROMPTS = [
  'What does the Rust crate actually do?',
  'How does Sharpe ratio work?',
  'What is the no-lookahead constraint?',
  'How can a backtest mislead me?',
];

let conversation: ChatMessage[] = [];
let streaming = false;

function loadConversation(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ChatMessage[])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveConversation(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(conversation.slice(-MAX_HISTORY))
    );
  } catch (err) {
    console.warn('chat: failed to persist conversation', err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

// Lightweight markdown-ish renderer for assistant messages. Handles
// fenced code blocks (` ``` `), inline backticks, bold (`**`), italic
// (`*` or `_`), and paragraph breaks. Doesn't pull in a full markdown
// library because the bundle cost is not worth the marginal gain on
// the limited set of formatting the assistant actually produces.
function renderMarkdown(raw: string): string {
  const lines = raw.split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join(' ').trim();
    if (joined) out.push(`<p>${renderInline(joined)}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = /^```(\w*)\s*$/.exec(line);
    if (fenceMatch) {
      flushPara();
      const lang = fenceMatch[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      const codeHtml = escapeHtml(codeLines.join('\n'));
      const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${langClass}>${codeHtml}</code></pre>`);
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join('');
}

function renderInline(s: string): string {
  // Strip first, then re-introduce formatting via segment markers.
  // Order: inline-code (so backtick content isn't formatted further),
  // bold (**), italic (single * or _).
  const parts: string[] = [];
  let rest = s;
  // Inline code:
  const codeRe = /`([^`]+)`/g;
  let lastIdx = 0;
  for (const m of rest.matchAll(codeRe)) {
    const before = rest.slice(lastIdx, m.index);
    parts.push(formatNonCode(escapeHtml(before)));
    parts.push(`<code>${escapeHtml(m[1])}</code>`);
    lastIdx = (m.index ?? 0) + m[0].length;
  }
  parts.push(formatNonCode(escapeHtml(rest.slice(lastIdx))));
  return parts.join('');
}

function formatNonCode(s: string): string {
  // Bold **text**:
  let out = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text* (but not the surviving ** from above, which is gone)
  out = out.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
  // Italic _text_:
  out = out.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');
  return out;
}

function renderConversation(): void {
  const el = document.getElementById('chat-conversation');
  if (!el) return;
  if (conversation.length === 0) {
    el.innerHTML = `
      <div class="chat-welcome">
        <p>Ask about Rust, this site, quant finance, or the philosophy of backtesting. Try:</p>
        <div class="chat-welcome-chips">
          ${WELCOME_PROMPTS.map(
            (p) => `<button type="button" class="chat-chip" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`
          ).join('')}
        </div>
      </div>
    `;
    return;
  }
  el.innerHTML = conversation
    .map((m) => {
      const cls = m.role === 'user' ? 'chat-msg chat-msg-user' : 'chat-msg chat-msg-assistant';
      const body =
        m.role === 'user' ? `<p>${escapeHtml(m.content)}</p>` : renderMarkdown(m.content);
      return `<div class="${cls}"><div class="chat-msg-body">${body}</div></div>`;
    })
    .join('');
  el.scrollTop = el.scrollHeight;
}

function updateLastAssistantMessage(text: string): void {
  const el = document.getElementById('chat-conversation');
  if (!el) return;
  const lastEl = el.querySelector('.chat-msg-assistant:last-child .chat-msg-body');
  if (lastEl) lastEl.innerHTML = renderMarkdown(text);
  el.scrollTop = el.scrollHeight;
}

function setStreamingButtonState(isStreaming: boolean): void {
  const sendBtn = document.getElementById('chat-send') as HTMLButtonElement | null;
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  const clearBtn = document.getElementById('chat-clear') as HTMLButtonElement | null;
  if (isStreaming) {
    if (sendBtn) sendBtn.disabled = true;
    if (input) input.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    return;
  }
  // Streaming finished. Re-enable, except respect the iter-91
  // rate-limit-exhausted disable which persists past the streaming
  // boundary. The dataset.rateLimitDisabled marker tells us whether
  // the rate-limit-aware code path set the disable, so we know to
  // leave it in place. The ANTHROPIC_API_KEY case (iter 85) only
  // fires at panel-open time and gates the user from ever
  // submitting, so this exit path doesn't reach it.
  const rateLimitStillActive = input?.dataset.rateLimitDisabled === 'true';
  if (sendBtn) sendBtn.disabled = rateLimitStillActive;
  if (input) input.disabled = rateLimitStillActive;
  if (clearBtn) clearBtn.disabled = false;
}

function setChatStatus(message: string, kind: 'info' | 'error' = 'info'): void {
  const el = document.getElementById('chat-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', kind === 'error');
}

async function loadChatRateStatus(): Promise<void> {
  try {
    const res = await fetch('/api/chat-status');
    if (!res.ok) return;
    const info = (await res.json()) as ChatStatusResponse;
    renderChatRateHint(info);
    // When the deploy reports the API key as unset, disable send
    // immediately so the user doesn't waste effort writing a message
    // that can't be delivered. The unavailable=true state is the
    // primary-deploy default after Eric sets the key on Netlify;
    // this path mostly matters for fresh deploys or for the local
    // dev environment where the key isn't always present.
    if (info.available === false) {
      const send = document.getElementById('chat-send') as HTMLButtonElement | null;
      const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
      if (send) send.disabled = true;
      if (input) {
        input.disabled = true;
        input.placeholder =
          'SelectBot is unavailable on this deploy (ANTHROPIC_API_KEY not set).';
      }
      setChatStatus(
        'SelectBot is unavailable on this deploy. The Anthropic API key is not set; chat messages cannot be delivered.',
        'error'
      );
    }
  } catch (err) {
    console.warn('chat-status fetch failed', err);
  }
}

function renderChatRateHint(info: ChatRateLimitInfo): void {
  const el = document.getElementById('chat-rate-hint');
  if (!el) return;
  const hourRemaining = info.hourly.remaining;
  const dayRemaining = info.daily.remaining;
  if (hourRemaining === 0) {
    el.textContent = `Out of messages this hour. Resets ${formatTimeUntilReset(info, 'hour')}.`;
    el.classList.add('exhausted');
    applyRateLimitDisable('hour', info);
    return;
  }
  if (dayRemaining === 0) {
    el.textContent = `Out of messages today. Resets ${formatTimeUntilReset(info, 'day')}.`;
    el.classList.add('exhausted');
    applyRateLimitDisable('day', info);
    return;
  }
  el.classList.remove('exhausted');
  el.textContent = `${hourRemaining} of ${info.hourly.limit} this hour · ${dayRemaining} of ${info.daily.limit} today`;
  // Clear any rate-limit disable that was set when an earlier
  // response had remaining=0. The 503 ANTHROPIC_API_KEY disable
  // path is separate and stays disabled regardless.
  clearRateLimitDisable();
}

/**
 * Disable the send button + input when the chat rate limit is
 * exhausted, and re-enable automatically when the window resets.
 * The setTimeout is bounded to the actual time-to-reset so the panel
 * recovers without requiring the user to refresh or re-open it.
 */
let rateLimitResetTimer: ReturnType<typeof setTimeout> | null = null;
function applyRateLimitDisable(
  window: 'hour' | 'day',
  info: ChatRateLimitInfo
): void {
  const send = document.getElementById('chat-send') as HTMLButtonElement | null;
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (send) send.disabled = true;
  if (input) {
    input.disabled = true;
    input.dataset.rateLimitDisabled = 'true';
  }
  if (rateLimitResetTimer) clearTimeout(rateLimitResetTimer);
  const resetAt = window === 'hour' ? info.hourly.resetAt : info.daily.resetAt;
  const delay = Math.max(0, resetAt - Date.now()) + 1_000;
  rateLimitResetTimer = setTimeout(() => {
    clearRateLimitDisable();
    rateLimitResetTimer = null;
  }, delay);
}

function clearRateLimitDisable(): void {
  const send = document.getElementById('chat-send') as HTMLButtonElement | null;
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (input?.dataset.rateLimitDisabled === 'true') {
    input.disabled = false;
    delete input.dataset.rateLimitDisabled;
  }
  // Only re-enable send if the input is also enabled. The
  // ANTHROPIC_API_KEY disable path sets input.disabled = true with
  // no rateLimitDisabled marker; we don't want to clobber that.
  if (send && input && !input.disabled) {
    send.disabled = false;
  }
  if (rateLimitResetTimer) {
    clearTimeout(rateLimitResetTimer);
    rateLimitResetTimer = null;
  }
}

async function sendMessage(content: string): Promise<void> {
  if (streaming) return;
  const trimmed = content.trim();
  if (!trimmed) return;
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    setChatStatus(`message too long (max ${MAX_MESSAGE_CHARS} chars)`, 'error');
    return;
  }

  streaming = true;
  setStreamingButtonState(true);
  setChatStatus('thinking...');

  conversation.push({ role: 'user', content: trimmed });
  conversation.push({ role: 'assistant', content: '' });
  saveConversation();
  renderConversation();

  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: conversation.slice(0, -1).slice(-MAX_HISTORY),
      }),
    });
  } catch (err) {
    finishWithError(`network error: ${(err as Error).message}`);
    return;
  }

  if (!res.ok || !res.body) {
    let message = `chat error (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = `chat error: ${body.error}`;
      // For 429 responses specifically, append the actual time-
      // until-reset to the error message so the user sees the
      // recovery time inline rather than having to look at the
      // rate-hint panel. Matches the backtest dispatcher's
      // rate-exceeded UX (iter 78). The reason field on the chat
      // function's 429 body is 'hour-exceeded' or 'day-exceeded'
      // exactly like the backtest dispatcher's.
      if (res.status === 429 && body?.rateLimits && body?.reason) {
        const window =
          body.reason === 'hour-exceeded' ? 'hour' : 'day';
        message = `chat error: rate limit exceeded; resets ${formatTimeUntilReset(body.rateLimits, window)}`;
      }
      if (body?.rateLimits) renderChatRateHint(body.rateLimits);
    } catch {
      // body wasn't JSON; keep the status-code message
    }
    finishWithError(message);
    return;
  }

  await consumeSseStream(res.body);
}

async function consumeSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let assistantText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by `\n\n`. Process complete frames and
    // keep any partial frame in the buffer for the next read.
    let frameEnd = buffer.indexOf('\n\n');
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (line) {
        const json = line.slice(5).trimStart();
        try {
          const event = JSON.parse(json) as SseEvent;
          if (event.type === 'text_delta') {
            assistantText += event.text;
            // Update the last assistant message in conversation state
            // and re-render. Persist after each chunk so a refresh
            // mid-stream keeps as much as we've received.
            conversation[conversation.length - 1].content = assistantText;
            updateLastAssistantMessage(assistantText);
            saveConversation();
          } else if (event.type === 'error') {
            finishWithError(`SelectBot error: ${event.message}`);
            return;
          } else if (event.type === 'done') {
            if (event.rateLimits) renderChatRateHint(event.rateLimits);
          }
        } catch (err) {
          console.warn('chat: malformed SSE frame', json, err);
        }
      }
      frameEnd = buffer.indexOf('\n\n');
    }
  }

  finishOk();
}

function finishOk(): void {
  streaming = false;
  setStreamingButtonState(false);
  setChatStatus('');
  // Refresh the rate hint after the response completes; the SSE done
  // event usually carries this but we re-fetch on completion to be
  // robust to the case where the done event was lost.
  loadChatRateStatus().catch(() => {});
  saveConversation();
  // Refocus the input so the user can keep the conversation flowing.
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (input) input.focus();
}

function finishWithError(message: string): void {
  streaming = false;
  setStreamingButtonState(false);
  setChatStatus(message, 'error');
  // Roll back the trailing empty assistant message we added optimistically.
  if (
    conversation.length > 0 &&
    conversation[conversation.length - 1].role === 'assistant' &&
    conversation[conversation.length - 1].content === ''
  ) {
    conversation.pop();
  }
  saveConversation();
  renderConversation();
}

function clearConversation(): void {
  if (streaming) return;
  conversation = [];
  saveConversation();
  renderConversation();
  setChatStatus('');
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (input) {
    input.value = '';
    input.style.height = '';
  }
}

function openPanel(): void {
  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const root = document.getElementById('chat-root');
  if (!panel || !toggle || !root) return;
  panel.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  root.classList.add('open');
  loadChatRateStatus().catch(() => {});
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  if (input) setTimeout(() => input.focus(), 50);
}

function closePanel(): void {
  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const root = document.getElementById('chat-root');
  if (!panel || !toggle || !root) return;
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  root.classList.remove('open');
}

export function initChat(): void {
  conversation = loadConversation();
  renderConversation();

  const toggle = document.getElementById('chat-toggle');
  const closeBtn = document.getElementById('chat-close');
  const form = document.getElementById('chat-form') as HTMLFormElement | null;
  const clearBtn = document.getElementById('chat-clear');
  const conversationEl = document.getElementById('chat-conversation');

  toggle?.addEventListener('click', () => {
    const panel = document.getElementById('chat-panel');
    if (panel?.hidden) openPanel();
    else closePanel();
  });

  closeBtn?.addEventListener('click', () => closePanel());

  form?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (!input) return;
    const text = input.value;
    input.value = '';
    // Reset the auto-grown height so the textarea collapses back to
    // its base size after the message is sent.
    input.style.height = '';
    sendMessage(text).catch((err) => {
      console.error('sendMessage threw', err);
      finishWithError(`unexpected error: ${(err as Error).message}`);
    });
  });

  // Enter to send, Shift+Enter for newline. Cmd/Ctrl+Enter also sends
  // as a convenience for users who prefer the explicit modifier.
  const input = document.getElementById('chat-input') as HTMLTextAreaElement | null;
  input?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      form?.requestSubmit();
    }
  });

  // Auto-grow the textarea as the user types so long composed
  // messages are fully visible. Caps at 200px to avoid the panel
  // expanding past a sensible size; beyond that the textarea
  // scrolls internally. The reset-to-auto-then-set pattern is the
  // standard idiom for textarea auto-grow because setting height
  // directly on a non-empty textarea doesn't shrink it on delete.
  const MAX_INPUT_HEIGHT_PX = 200;
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, MAX_INPUT_HEIGHT_PX) + 'px';
  });

  clearBtn?.addEventListener('click', () => clearConversation());

  // Welcome prompt chips: clicking a chip sets the input and sends.
  conversationEl?.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const chip = target.closest('.chat-chip') as HTMLButtonElement | null;
    if (!chip) return;
    const prompt = chip.dataset.prompt;
    if (!prompt) return;
    sendMessage(prompt).catch((err) => {
      console.error('chip sendMessage threw', err);
    });
  });

  // Escape closes the panel.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const panel = document.getElementById('chat-panel');
      if (panel && !panel.hidden) closePanel();
    }
  });
}
