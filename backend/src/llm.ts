import { GoogleGenAI } from '@google/genai';

export async function generateContentWithSchema(prompt: string, schema: any): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is missing.");
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            temperature: 0,
        }
    });

    const text = response.text;
    return (typeof text === 'string' && text.trim().length > 0) ? text.trim() : null;
}
