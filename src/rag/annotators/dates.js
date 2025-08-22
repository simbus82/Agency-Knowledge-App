// Date annotator: AI-driven date extraction.
const { claudeRequest, CLAUDE_MODEL_UTILITY } = require('../ai/claudeClient');

async function extractDatesWithAI(chunks) {
    if (!process.env.CLAUDE_API_KEY) {
        throw new Error('CLAUDE_API_KEY is required for AI-based date annotation.');
    }

    const prompt = `Dato il seguente array di blocchi di testo, estrai tutte le date da ciascun blocco.
Normalizza le date nel formato YYYY-MM-DD.
Riconosci formati come "dd/mm/yyyy", "yyyy-mm-dd", nomi di mesi, e date relative come "ieri", "la settimana scorsa".
Oggi è il ${new Date().toISOString().split('T')[0]}.

Input:
${JSON.stringify(chunks.map(c => ({ id: c.id, text: c.text.slice(0, 500) })))}

Rispondi con un array JSON dove ogni oggetto contiene l'ID del blocco e un array di date trovate.
Formato della risposta:
[
  {
    "id": "chunk_id_1",
    "dates": [
      { "raw": "testo originale", "norm": "YYYY-MM-DD" },
      ...
    ]
  },
  ...
]

Fornisci solo il JSON come risposta.`;

    try {
        const rawResult = await claudeRequest(CLAUDE_MODEL_UTILITY, prompt, 1500, 0);
        const jsonStart = rawResult.indexOf('[');
        const jsonEnd = rawResult.lastIndexOf(']');
        if (jsonStart === -1 || jsonEnd === -1) {
            console.warn('AI date annotator returned invalid JSON.');
            return [];
        }
        return JSON.parse(rawResult.substring(jsonStart, jsonEnd + 1));
    } catch (e) {
        console.error("Error extracting dates with AI:", e);
        return [];
    }
}

module.exports.annotateDates = async function annotateDates(chunks) {
    if (!chunks || chunks.length === 0) {
        return [];
    }

    const annotations = await extractDatesWithAI(chunks);
    const annotationsMap = new Map(annotations.map(a => [a.id, a.dates]));

    return chunks.map(chunk => {
        return {
            ...chunk,
            dates: annotationsMap.get(chunk.id) || []
        };
    });
};
