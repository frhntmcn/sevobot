"use client";

import { useState } from "react";
import styles from "./CoinToss.module.css";

export default function CoinToss() {
  const [isFlipping, setIsFlipping] = useState(false);
  const [result, setResult] = useState(null); // "Yazı" or "Tura"

  const handleToss = async () => {
    if (isFlipping) return;

    setIsFlipping(true);
    setResult(null);

    // Artificial delay for animation
    setTimeout(async () => {
      try {
        const res = await fetch("/api/toss");
        const data = await res.json();
        setResult(data.result);
      } catch (error) {
        console.error("Failed to fetch toss result", error);
        setResult("Hata");
      } finally {
        setIsFlipping(false);
      }
    }, 2000); // 2 seconds flip animation
  };

  return (
    <div className={styles.container}>
      {/* Coin Container */}
      <div className={styles.coinContainer}>
        <div
          className={styles.coin}
          style={{
            transform: isFlipping
              ? "rotateY(1800deg)"
              : result === "Tura"
              ? "rotateY(180deg)"
              : "rotateY(0deg)",
          }}
        >
          {/* Front (Yazı) */}
          <div className={`${styles.side} ${styles.front}`}>YAZI</div>

          {/* Back (Tura) */}
          <div className={`${styles.side} ${styles.back}`}>TURA</div>
        </div>
      </div>

      <div className={styles.controls}>
        <button
          className="btn-primary"
          onClick={handleToss}
          disabled={isFlipping}
          style={{
            opacity: isFlipping ? 0.7 : 1,
            transform: isFlipping ? "scale(0.95)" : "scale(1)",
            minWidth: "150px",
          }}
        >
          {isFlipping ? "Çevriliyor..." : "Para At"}
        </button>

        <div
          className={`${styles.result} ${
            result === "Yazı" ? styles.resultYazi : styles.resultTura
          }`}
          style={{ opacity: result ? 1 : 0 }}
        >
          {result && `${result} geldi!`}
        </div>
      </div>
    </div>
  );
}
