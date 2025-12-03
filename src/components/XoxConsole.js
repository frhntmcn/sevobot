"use client";

import { useState } from "react";
import styles from "./XoxConsole.module.css";

export default function XoxConsole() {
    const [user, setUser] = useState("");
    const [command, setCommand] = useState("");
    const [output, setOutput] = useState("Sonuç burada görünecek...");
    const [isLoading, setIsLoading] = useState(false);

    const handleSendCommand = async () => {
        if (!user || !command) {
            setOutput("Lütfen kullanıcı adı ve komut girin.");
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch('/api/xox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user, command })
            });
            const data = await res.json();
            setOutput(data.message || "Hata oluştu.");
        } catch (e) {
            setOutput("Sunucu hatası: " + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>XOX Test Konsolu</h2>
            <div className={`glass-panel ${styles.consoleBox}`}>
                <div className={styles.inputGroup}>
                    <input
                        type="text"
                        placeholder="Kullanıcı Adı (örn: ali)"
                        className={`${styles.input} ${styles.inputUser}`}
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                    />
                    <input
                        type="text"
                        placeholder="Komut (örn: !xox davet veli, !xox 5)"
                        className={`${styles.input} ${styles.inputCmd}`}
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                    />
                </div>
                <button
                    className="btn-primary"
                    onClick={handleSendCommand}
                    disabled={isLoading}
                >
                    {isLoading ? "Gönderiliyor..." : "Komutu Gönder"}
                </button>
                <pre className={styles.output}>
                    {output}
                </pre>
            </div>
            <p className={styles.hint}>
                İpucu: İki farklı tarayıcı sekmesi açarak veya kullanıcı adını değiştirerek kendinle oynayabilirsin.
            </p>
        </div>
    );
}
