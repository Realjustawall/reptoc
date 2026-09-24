import { supabase } from "../postgres";

function extractJson(value: string) {
  const match = value.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI detector returned no JSON result");
  return JSON.parse(match[0]);
}

export async function detectAIWriting(content: string) {
  const { data } = await supabase.from("ai_settings").select("setting_value").eq("setting_key", "ai_config").single();
  const config: any = data?.setting_value || {};
  const provider = String(config.detection_provider || "gemini").toLowerCase();
  const key = config[`${provider}_api_key`];
  if (!config.detection_enabled || !key) return null;
  const base = config.detection_base_prompt || "Assess whether this novel excerpt is substantially AI-generated. Return only JSON with aiScore (0-100), confidence (0-100), and summary.";
  const prompt = `${base}\n\nEXCERPT:\n${String(content).replace(/<[^>]*>/g, " ").slice(0, 30000)}`;
  let response: Response;
  if (provider === "openai") {
    response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: config.detection_model || "gpt-4.1-mini", temperature: 0, messages: [{ role: "user", content: prompt }] }) });
  } else if (provider === "groq") {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: config.detection_model || "llama-3.3-70b-versatile", temperature: 0, messages: [{ role: "user", content: prompt }] }) });
  } else {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.detection_model || "gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }) });
  }
  if (!response.ok) throw new Error(`AI provider request failed (${response.status})`);
  const body: any = await response.json();
  const text = provider === "gemini" ? body?.candidates?.[0]?.content?.parts?.[0]?.text : body?.choices?.[0]?.message?.content;
  const parsed = extractJson(String(text || ""));
  return { aiScore: Math.max(0, Math.min(100, Number(parsed.aiScore) || 0)), confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)), summary: String(parsed.summary || "AI provider analysis complete").slice(0, 1000), provider };
}
