import type { APIRoute } from 'astro';
import OpenAI from 'openai';
import { AKRASIA_SYSTEM_PROMPT } from '../../data/systemPrompt';
import { upsertVisitor, getOrCreateConversation, saveMessage, upsertLead } from '../../lib/supabase';
import { extractContactData } from '../../lib/extractContactData';
import { sendLeadNotification } from '../../lib/notify';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'OpenRouter API key not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: { messages?: Array<{ role: string; content: string }>; visitor_id?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const messages = body.messages;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Messages array required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const visitorId = body.visitor_id || '';

  if (visitorId) {
    await upsertVisitor(visitorId);
  }

  const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
  const extracted = lastUserMessage ? extractContactData(lastUserMessage.content) : null;

  if (visitorId && extracted && (extracted.emails.length > 0 || extracted.phones.length > 0)) {
    const conversationId = await getOrCreateConversation(visitorId);
    if (conversationId) {
      await saveMessage(conversationId, 'user', lastUserMessage!.content);
      await upsertLead(visitorId, conversationId, {
        email: extracted.emails[0] || null,
        phone: extracted.phones[0] || null,
        projectType: extracted.projectType || null,
      });
      await sendLeadNotification({
        email: extracted.emails[0],
        phone: extracted.phones[0],
        projectType: extracted.projectType,
        visitorId,
        lastMessage: lastUserMessage!.content,
      });
    }
  } else if (visitorId && lastUserMessage) {
    const conversationId = await getOrCreateConversation(visitorId);
    if (conversationId) {
      await saveMessage(conversationId, 'user', lastUserMessage.content);
      if (extracted?.projectType) {
        await upsertLead(visitorId, conversationId, { projectType: extracted.projectType });
      }
    }
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://akrasia.studio',
      'X-Title': 'Akrasia Studio',
    },
  });

  try {
    const stream = await openai.chat.completions.create({
      model: 'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: AKRASIA_SYSTEM_PROMPT },
        ...messages.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
      max_tokens: 500,
      temperature: 0.7,
      stream: true,
    });

    const encoder = new TextEncoder();
    let fullResponse = '';

    const conversationId = visitorId ? await getOrCreateConversation(visitorId) : null;

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          if (conversationId && fullResponse) {
            await saveMessage(conversationId, 'assistant', fullResponse);
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
