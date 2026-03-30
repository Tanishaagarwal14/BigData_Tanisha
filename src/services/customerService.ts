import Papa from 'papaparse';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, doc, setDoc, getDoc, query, where, getDocs, orderBy, limit, writeBatch, Timestamp } from 'firebase/firestore';
import { analyzeSentiment, Sentiment } from './geminiService';

export interface CustomerData {
  id: string;
  email: string;
  lastPurchaseDate: string;
  riskScore: number;
  isAtRisk: boolean;
  lastReviewSentiment?: Sentiment;
  secondLastReviewSentiment?: Sentiment;
}

export interface ReviewData {
  id: string;
  customerId: string;
  text: string;
  sentiment: Sentiment;
  date: string;
}

export interface CSVRow {
  customerId: string;
  email: string;
  reviewText: string;
  purchaseDate: string;
  reviewDate: string;
}

export async function processCSV(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = results.data;
          const customersMap = new Map<string, { email: string; lastPurchaseDate: string; reviews: { text: string; date: string }[] }>();

          // Aggregate data by customer
          for (const row of rows) {
            if (!row.customerId || !row.email) continue;
            
            const existing = customersMap.get(row.customerId) || {
              email: row.email,
              lastPurchaseDate: row.purchaseDate,
              reviews: []
            };

            // Update last purchase date if this row has a more recent one
            if (new Date(row.purchaseDate) > new Date(existing.lastPurchaseDate)) {
              existing.lastPurchaseDate = row.purchaseDate;
            }

            existing.reviews.push({ text: row.reviewText, date: row.reviewDate });
            customersMap.set(row.customerId, existing);
          }

          const batch = writeBatch(db);
          const now = new Date();

          for (const [customerId, data] of customersMap.entries()) {
            // Sort reviews by date descending
            const sortedReviews = data.reviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            
            // Analyze sentiment for the last 2 reviews
            const lastReview = sortedReviews[0];
            const secondLastReview = sortedReviews[1];

            const lastSentiment = lastReview ? await analyzeSentiment(lastReview.text) : null;
            const secondLastSentiment = secondLastReview ? await analyzeSentiment(secondLastReview.text) : null;

            // Churn Logic
            const lastPurchase = new Date(data.lastPurchaseDate);
            const daysSinceLastPurchase = (now.getTime() - lastPurchase.getTime()) / (1000 * 3600 * 24);
            
            const isAtRisk = daysSinceLastPurchase > 30 && lastSentiment === "Negative" && secondLastSentiment === "Negative";
            
            // Calculate a simple risk score (0-100)
            let riskScore = 0;
            if (daysSinceLastPurchase > 30) riskScore += 40;
            if (lastSentiment === "Negative") riskScore += 30;
            if (secondLastSentiment === "Negative") riskScore += 30;
            if (lastSentiment === "Positive") riskScore -= 20;
            riskScore = Math.max(0, Math.min(100, riskScore));

            const customerDoc: CustomerData = {
              id: customerId,
              email: data.email,
              lastPurchaseDate: data.lastPurchaseDate,
              riskScore,
              isAtRisk,
              lastReviewSentiment: lastSentiment || undefined,
              secondLastReviewSentiment: secondLastSentiment || undefined
            };

            const customerRef = doc(db, 'customers', customerId);
            batch.set(customerRef, customerDoc);

            // Save reviews
            for (const review of sortedReviews.slice(0, 5)) { // Save only last 5 reviews for demo
              const reviewId = `${customerId}_${new Date(review.date).getTime()}`;
              const reviewSentiment = review === lastReview ? lastSentiment : (review === secondLastReview ? secondLastSentiment : await analyzeSentiment(review.text));
              
              const reviewDoc: ReviewData = {
                id: reviewId,
                customerId,
                text: review.text,
                sentiment: reviewSentiment || "Neutral",
                date: review.date
              };
              const reviewRef = doc(db, 'reviews', reviewId);
              batch.set(reviewRef, reviewDoc);
            }
          }

          try {
            await batch.commit();
            resolve();
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, 'batch_commit');
          }
        } catch (error) {
          console.error("Error processing CSV data:", error);
          reject(error);
        }
      },
      error: (error) => {
        reject(error);
      }
    });
  });
}
