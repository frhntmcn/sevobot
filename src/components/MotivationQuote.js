"use client";

import { useState } from "react";
import styles from "./MotivationQuote.module.css";

export default function MotivationQuote() {
    const [quote, setQuote] = useState(null);
    const [isLoadingQuote, setIsLoadingQuote] = useState(false);

    const handleGetQuote = async () => {
        if (isLoadingQuote) return;

        setIsLoadingQuote(true);
        try {
            const res = await fetch("/api/quote");
            const data = await res.json();
            setQuote(data.quote);
        } catch (error) {
            console.error("Failed to fetch quote", error);
            setQuote("Motivasyon yüklenemedi.");
        } finally {
            setIsLoadingQuote(false);
        }
    };

    return (
        <div className={styles.container}>
            <button
                className={`btn-primary ${styles.quoteButton}`}
                onClick={handleGetQuote}
                disabled={isLoadingQuote}
                style={{
                    opacity: isLoadingQuote ? 0.7 : 1,
                }}
            >
                {isLoadingQuote ? "Yükleniyor..." : "Motivasyon Sözü Al"}
            </button>

            {quote && (
                <div className={`glass-panel ${styles.quoteBox}`}>
                    <p className={styles.quoteText}>&quot;{quote}&quot;</p>
                </div>
            )}
        </div>
    );
}
