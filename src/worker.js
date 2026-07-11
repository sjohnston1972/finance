import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT =
  'You are a UK pension and tax adviser reviewing a plan produced by a pension calculator. ' +
  'Give practical, specific guidance grounded in the figures provided. Use UK English and ' +
  'markdown headings and bullet points. Be concise but thorough. Always close with a one-line ' +
  'reminder that this is general information, not regulated financial advice.';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_HISTORY_TURNS = 20;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/analyse') {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
      }
      return analyse(request, env, ctx);
    }

    // Anything else that reached the worker isn't a known asset or route.
    return json({ error: 'Not found' }, 404);
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function analyse(request, env, ctx) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI analysis is not configured on this deployment.' }, 503);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'Request too large.' }, 413);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON.' }, 400);
  }

  const { plan, question, history } = body ?? {};
  if (typeof plan !== 'string' || plan.length === 0) {
    return json({ error: 'Missing plan summary.' }, 400);
  }

  const messages = [
    {
      role: 'user',
      content:
        `Here is my pension plan as calculated by the planner:\n\n${plan}\n\n` +
        'Please provide:\n' +
        '1. A brief assessment of my current position\n' +
        '2. Whether my contribution level looks adequate for retirement\n' +
        '3. Tax optimisation suggestions for my region and bands\n' +
        '4. Annual allowance considerations\n' +
        '5. Risks or things to watch out for\n' +
        '6. Specific, actionable recommendations',
    },
  ];

  if (Array.isArray(history)) {
    for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
      if (
        turn &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string' &&
        turn.content.length > 0
      ) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }
  }
  if (typeof question === 'string' && question.trim()) {
    messages.push({ role: 'user', content: question.trim().slice(0, 4000) });
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event) => writer.write(encoder.encode(JSON.stringify(event) + '\n'));

  const run = async () => {
    try {
      const stream = client.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages,
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          await send({ type: 'text', text: event.delta.text });
        }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        await send({ type: 'error', error: 'The analysis was declined. Try rephrasing your question.' });
      }
      await send({ type: 'done' });
    } catch (err) {
      await send({ type: 'error', error: describeError(err) });
    } finally {
      await writer.close();
    }
  };

  // Keep streaming after the response is returned.
  ctx.waitUntil(run());

  return new Response(readable, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The AI service rejected the configured API key.';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'The AI service is rate limited right now — try again in a minute.';
  }
  if (err instanceof Anthropic.APIError) {
    return `AI service error (${err.status}).`;
  }
  return 'Unexpected error contacting the AI service.';
}
