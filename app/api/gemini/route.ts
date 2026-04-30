// app/api/gemini/route.ts
// Proxy seguro: la GEMINI_API_KEY vive solo en el servidor, nunca en el navegador.
// La ruta además valida el APP_PASSWORD antes de llamar a Gemini.

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    // ── 1. Validar password ──────────────────────────────────────────────────
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) {
      return NextResponse.json({ error: "APP_PASSWORD no configurado en el servidor" }, { status: 500 });
    }

    const authHeader = req.headers.get("x-app-password");
    if (!authHeader || authHeader !== appPassword) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // ── 2. Validar API key ───────────────────────────────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY no configurada" }, { status: 500 });
    }

    // ── 3. Leer body ─────────────────────────────────────────────────────────
    const body = await req.json();
    if (!body?.pdfBase64) {
      return NextResponse.json({ error: "Falta pdfBase64 en el body" }, { status: 400 });
    }

    // ── 4. Llamar a Gemini ───────────────────────────────────────────────────
    const SYSTEM_PROMPT = `Eres experto en meteorología de México. Analiza el pronóstico y extrae datos estructurados.

REGLAS:
1. Ignora el PRIMER período (primeras 24 h). Empieza desde el SEGUNDO.
2. EXCLUYE temperaturas máximas y lluvias aisladas (<5 mm).
3. Lluvia >=5 mm → "Tormentas eléctricas y granizo*", intensidad vacía.
4. Nieve/aguanieve → "Posible caída de nieve o aguanieve", intensidad vacía.
5. Mantén separados: "Torbellinos o tornados","Viento","Mar de fondo","Oleaje","Temperatura mínima".
6. "dia": "de [día] [N] a [día] [N]" (ej: "de martes 28 a miércoles 29"). Sin mes.
7. "validez": rango completo primer→último día analizado (ej: "del 28 de abril al 2 de mayo"), minúsculas.
8. "fenomenos_destacados": fenómenos únicos desde el segundo período, separados por coma.
9. "sistemas_atmosfericos": sistemas del doc EXCLUYENDO "onda de calor","sistema de alta presión","altas presiones","alta presión".
10. "num_aviso": solo el número (ej: "117").
11. "fecha": formato "DD de mes de AAAA".
12. Temperatura mínima: agrupa estados del mismo prefijo geográfico en un solo elemento.

Devuelve ÚNICAMENTE JSON válido (sin markdown):
{"periodos":[{"dia":"...","fenomenos":[{"tipo":"...","registros":[{"intensidad":"...","estados":["..."]}]}]}],"metadatos":{"titulo":"Aviso núm. X","fecha":"DD de mes de AAAA","validez":"...","fenomenos_destacados":"...","sistemas_atmosfericos":["..."],"num_aviso":"117"}}

Tipos: "Tormentas eléctricas y granizo*","Posible caída de nieve o aguanieve","Torbellinos o tornados","Viento","Mar de fondo","Oleaje","Temperatura mínima".`;

    const geminiBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { inline_data: { mime_type: "application/pdf", data: body.pdfBase64 } },
          { text: "Extrae los datos del pronóstico. Devuelve solo JSON." },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const geminiResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      return NextResponse.json({ error: `Gemini HTTP ${geminiResp.status}: ${errText}` }, { status: 502 });
    }

    const geminiData = await geminiResp.json();
    return NextResponse.json(geminiData);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
