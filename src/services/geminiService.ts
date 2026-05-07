import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// Cache configuration
const CACHE_EXPIRATION_MS = 4 * 60 * 60 * 1000; // 4 hours for matches
const ANALYSIS_CACHE_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours for specific analyses

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Robust wrapper for AI calls with exponential backoff for 429 errors
 */
async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isQuotaError = err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED");
      const isOverloaded = err.message?.includes("503") || err.message?.includes("overloaded");
      
      if (isQuotaError || isOverloaded) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, i);
        console.warn(`Tentativa ${i + 1} falhou (Cota/Sobrecarga). Tentando novamente em ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw err; // For other errors (like 400, 403, 404), throw immediately
    }
  }
  throw lastError;
}

export interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  time: string;
  date: string;
  source: string;
  sport: "Futebol" | "Basquete" | "Vôlei" | "Tênis" | "Tênis de Mesa";
  isHighlight: boolean;
}

export interface Analysis {
  recentForm: string;
  h2h: string;
  homeAway: string;
  lineups: string;
  stats: string;
  odds: string;
  prediction: {
    market: string;
    probability: number;
    confidence: "Baixo" | "Médio" | "Alto";
  };
}

export async function fetchDailyMatches(date: string): Promise<Match[]> {
  // 1. Check Cache
  const cacheKey = `matches_cache_${date}`;
  try {
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp < CACHE_EXPIRATION_MS) {
        console.log("Usando jogos em cache para:", date);
        return data;
      }
    }
  } catch (e) {
    console.warn("Erro ao ler cache de jogos:", e);
  }

  const prompt = `Você é um Analista Esportivo Profissional e Investigador de Dados.
Hoje é dia ${date}.

Sua tarefa CRÍTICA é encontrar jogos de destaque (mínimo de 15-20 jogos) que ocorrem EXATAMENTE no dia ${date}.
Use fontes confiáveis em tempo real como Flashscore, SofaScore, GE, 365Scores ou sites oficiais de ligas.

Considere as principais competições de:
- Futebol (Ligas Europeias, Brasileirão, Libertadores, Champions, etc)
- Basquete (NBA, NBB, EuroLeague)
- Vôlei (Superliga, Ligas Internacionais)
- Tênis (ATP, WTA)
- Tênis de Mesa (WTT, ITTF)

Instruções Adicionais:
- Se houver poucos jogos no dia solicitado, busque em ligas secundárias importantes.
- Garanta que os horários correspondam ao fuso horário de Brasília (BRT).
- 'isHighlight' deve ser verdadeiro para confrontos entre times conhecidos ou decisões.

Retorne APENAS um array JSON seguindo estritamente este esquema:
[
  {
    "homeTeam": "Nome do Time Casa",
    "awayTeam": "Nome do Time Fora",
    "league": "Nome da Competição",
    "time": "HH:MM",
    "date": "DD/MM/AAAA",
    "source": "Fonte da informação",
    "sport": "Futebol" | "Basquete" | "Vôlei" | "Tênis" | "Tênis de Mesa",
    "isHighlight": boolean
  }
]`;

  const callAi = async (useSearch: boolean) => {
    try {
      console.log(`Chamando Gemini (${useSearch ? 'com' : 'sem'} busca) para o dia: ${date}`);
      
      return await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          tools: useSearch ? [{ googleSearch: {} }] : [],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                homeTeam: { type: Type.STRING },
                awayTeam: { type: Type.STRING },
                league: { type: Type.STRING },
                time: { type: Type.STRING },
                date: { type: Type.STRING },
                source: { type: Type.STRING },
                sport: { 
                  type: Type.STRING, 
                  description: 'Modalidade esportiva',
                  enum: ["Futebol", "Basquete", "Vôlei", "Tênis", "Tênis de Mesa"] 
                },
                isHighlight: { type: Type.BOOLEAN },
              },
              required: ["homeTeam", "awayTeam", "league", "time", "date", "source", "sport", "isHighlight"],
            },
          },
        }
      });
    } catch (err: any) {
      console.warn(`Erro na tentativa de chamada AI (Search=${useSearch}):`, err.message);
      throw err;
    }
  };

  try {
    let response: any;
    
    // Use retry logic for the entire operation
    await withRetry(async () => {
      try {
        // First attempt with search
        response = await callAi(true);
      } catch (searchError: any) {
        const isQuotaError = searchError.message?.includes("429") || searchError.message?.includes("quota") || searchError.message?.includes("RESOURCE_EXHAUSTED");
        if (isQuotaError) {
          throw searchError; // Pass to withRetry for backoff
        }
        console.warn("Busca falhou, tentando sem busca:", searchError.message);
        // Fallback without search
        response = await callAi(false);
      }
    });

    if (!response || !response.text) {
      throw new Error("Resposta vazia da IA.");
    }

    const data = JSON.parse(response.text.trim());
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("IA retornou uma lista vazia de jogos.");
      return [];
    }

    console.log(`Sucesso: ${data.length} jogos encontrados.`);
    const results = data.map((m: any) => {
      // Create a deterministic ID based on the teams and league to help with stable caching
      const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = `${m.sport}-${cleanName(m.homeTeam)}-${cleanName(m.awayTeam)}-${cleanName(m.league)}`.substring(0, 100);
      return { ...m, id };
    });

    // Save to Cache
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        data: results,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn("Falha ao salvar cache no localStorage:", e);
    }

    return results;
  } catch (e: any) {
    console.error("Erro fatal na busca de jogos:", e);
    throw e;
  }
}

export async function analyzeMatch(match: Match): Promise<Analysis> {
  const dateStr = new Date().toISOString().split('T')[0];
  const cacheKey = `analysis_v1_${match.homeTeam}_${match.awayTeam}_${dateStr}`.replace(/\s+/g, '_');
  
  try {
    const cachedData = localStorage.getItem(cacheKey);
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData);
      if (Date.now() - timestamp < ANALYSIS_CACHE_EXPIRATION_MS) {
        console.log(`Usando análise em cache para: ${match.homeTeam} x ${match.awayTeam}`);
        return data as Analysis;
      }
    }
  } catch (e) {
    console.warn("Erro ao ler cache de análise:", e);
  }

  const prompt = `Analise PROFISSIONAL para o jogo de HOJE (${match.homeTeam} x ${match.awayTeam}):
Esporte: ${match.sport} | Liga: ${match.league} | Horário: ${match.time}

Use a busca para validar:
- Forma recente (últimos 5 jogos)
- Confrontos diretos (H2H)
- Desfalques e lesões confirmadas
- Odds de mercado atuais

Regras:
1. Seja objetivo e baseado em dados.
2. Identifique o mercado com melhor valor (ex: Ambas Marcam, Over 2.5, Handicap +1.5).
3. Estime a probabilidade real de sucesso entre 0-100.
4. Nível de confiança: Baixo, Médio ou Alto.

Retorne APENAS o JSON.`;

  const callAnalyze = async (useSearch: boolean) => {
    try {
      return await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          tools: useSearch ? [{ googleSearch: {} }] : [],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              recentForm: { type: Type.STRING },
              h2h: { type: Type.STRING },
              homeAway: { type: Type.STRING },
              lineups: { type: Type.STRING },
              stats: { type: Type.STRING },
              odds: { type: Type.STRING },
              prediction: {
                type: Type.OBJECT,
                properties: {
                  market: { type: Type.STRING },
                  probability: { type: Type.NUMBER },
                  confidence: { type: Type.STRING, enum: ["Baixo", "Médio", "Alto"] },
                },
                required: ["market", "probability", "confidence"],
              },
            },
            required: ["recentForm", "h2h", "homeAway", "lineups", "stats", "odds", "prediction"],
          },
        }
      });
    } catch (err: any) {
      console.warn(`Erro na análise (Search=${useSearch}):`, err.message);
      throw err;
    }
  };

  try {
    let response: any;
    
    await withRetry(async () => {
      try {
        response = await callAnalyze(true);
      } catch (searchError: any) {
        const isQuotaError = searchError.message?.includes("429") || searchError.message?.includes("quota") || searchError.message?.includes("RESOURCE_EXHAUSTED");
        if (isQuotaError) {
          throw searchError; // Pass to withRetry for backoff
        }
        console.warn("Busca na análise falhou, tentando sem busca.");
        response = await callAnalyze(false);
      }
    });

    if (!response || !response.text) {
      throw new Error("Resposta de análise vazia.");
    }
    
    const analysis = JSON.parse(response.text.trim());

    // Save to Cache
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        data: analysis,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn("Falha ao salvar cache de análise:", e);
    }

    return analysis;
  } catch (e: any) {
    console.error(`Erro ao analisar ${match.homeTeam}:`, e);
    throw new Error(`Falha ao analisar o jogo ${match.homeTeam}.`);
  }
}
