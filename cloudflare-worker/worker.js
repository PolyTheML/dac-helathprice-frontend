/**
 * DAC HealthPrice — Cloudflare Worker (Groq Proxy)
 * Translates Anthropic-format requests → Groq API → Anthropic-format responses
 * Groq is free + works in Cambodia (no regional restrictions)
 *
 * Secret needed in Cloudflare:
 *   Name:  GROQ_API_KEY
 *   Value: gsk_... (from console.groq.com)
 */

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ error: "Method not allowed" }), {
                status: 405, headers: { ...corsHeaders(), "Content-Type": "application/json" },
            });
        }
        let body;
        try { body = await request.json(); }
        catch {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), {
                status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" },
            });
        }

        const groqRequest = convertToGroq(body);

        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            },
            body: JSON.stringify(groqRequest),
        });

        const groqData = await groqResponse.json();
        const anthropicData = convertToAnthropic(groqData);

        return new Response(JSON.stringify(anthropicData), {
            status: groqResponse.ok ? 200 : groqResponse.status,
            headers: { ...corsHeaders(), "Content-Type": "application/json" },
        });
    },
};

// ── Convert Anthropic request → Groq (OpenAI format) ──────────────────────
function convertToGroq({ system, messages, tools, max_tokens }) {
    const openaiMessages = [];

    if (system) openaiMessages.push({ role: "system", content: system });

    for (const msg of messages) {
        if (typeof msg.content === "string") {
            openaiMessages.push({ role: msg.role, content: msg.content });
            continue;
        }
        const textBlocks = msg.content.filter(b => b.type === "text");
        const toolUseBlocks = msg.content.filter(b => b.type === "tool_use");
        const toolResults = msg.content.filter(b => b.type === "tool_result");

        if (toolResults.length > 0) {
            for (const tr of toolResults) {
                const content = typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content);
                openaiMessages.push({ role: "tool", content, tool_call_id: tr.tool_use_id });
            }
        } else if (toolUseBlocks.length > 0) {
            openaiMessages.push({
                role: "assistant",
                content: textBlocks.map(b => b.text).join("\n") || null,
                tool_calls: toolUseBlocks.map(b => ({
                    id: b.id,
                    type: "function",
                    function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
                })),
            });
        } else {
            openaiMessages.push({ role: msg.role, content: textBlocks.map(b => b.text).join("\n") });
        }
    }

    const openaiTools = tools?.length ? tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
    })) : undefined;

    const req = {
        model: "llama-3.3-70b-versatile",
        messages: openaiMessages,
        max_tokens: max_tokens || 800,
    };
    if (openaiTools) { req.tools = openaiTools; req.tool_choice = "auto"; }
    return req;
}

// ── Convert Groq response → Anthropic format ──────────────────────────────
function convertToAnthropic(groqData) {
    if (groqData.error) return { error: groqData.error };

    const choice = groqData.choices?.[0];
    if (!choice) return { error: { type: "api_error", message: "No response from Groq" } };

    const message = choice.message;
    const content = [];
    let hasToolCall = false;

    if (message.content) content.push({ type: "text", text: message.content });

    if (message.tool_calls?.length) {
        hasToolCall = true;
        for (const tc of message.tool_calls) {
            let input = {};
            try { input = JSON.parse(tc.function.arguments || "{}"); } catch { }
            content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
    }

    return {
        content,
        stop_reason: hasToolCall ? "tool_use" : "end_turn",
        model: "llama-3.3-70b-versatile",
    };
}

// ── CORS ─────────────────────────────────────────────────────────────────────
function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}
