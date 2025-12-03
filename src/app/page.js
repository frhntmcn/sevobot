import styles from "./page.module.css";
import CoinToss from "@/components/CoinToss";
import MotivationQuote from "@/components/MotivationQuote";
import XoxConsole from "@/components/XoxConsole";

export default function Home() {
  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          Yazı Tura & Motivasyon
        </h1>
        <p className={styles.subtitle}>
          İster şansını dene, ister ilham al.
        </p>
      </div>

      <div className={styles.content}>
        <CoinToss />

        <div className={styles.divider}></div>

        <MotivationQuote />

        <div className={styles.divider}></div>

        <XoxConsole />
      </div>
    </main>
  );
}
