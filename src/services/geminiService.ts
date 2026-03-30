import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export type Sentiment = "Positive" | "Neutral" | "Negative";

export async function analyzeSentiment(text: string): Promise<Sentiment> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the sentiment of the following e-commerce review. Respond with ONLY one of these three words: "Positive", "Neutral", or "Negative".\n\nReview: "${text}"`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: {
              type: Type.STRING,
              enum: ["Positive", "Neutral", "Negative"],
              description: "The sentiment of the review."
            }
          },
          required: ["sentiment"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return (result.sentiment as Sentiment) || "Neutral";
  } catch (error) {
    console.error("Error analyzing sentiment:", error);
    return "Neutral";
  }
}
