import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("MongoDB connected"))
    .catch(e => console.error("MongoDB connection error:", e));

// User модель
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    hhAccessToken: String,
    hhRefreshToken: String,
    hhExpiresAt: Date,
    resumeId: String,
    filters: Object,
    subscribed: { type: Boolean, default: false },
});

const User = mongoose.model("User", userSchema);

// OAuth: редирект на hh.ru авторизацию
app.get("/auth/hh", (req, res) => {
    const { telegramId } = req.query;
    if (!telegramId) return res.status(400).send("telegramId required");
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.HH_CLIENT_ID,
        redirect_uri: process.env.HH_REDIRECT_URI,
        state: telegramId, // передаем telegramId в state для связи с пользователем
    });
    res.redirect(`https://hh.ru/oauth/authorize?${params.toString()}`);
});

// OAuth callback — обмен кода на токен
app.get("/auth/callback", async (req, res) => {
    try {
        const { code, state: telegramId } = req.query;
        if (!code || !telegramId) return res.status(400).send("Missing code or state");

        const tokenRes = await axios.post("https://hh.ru/oauth/token", null, {
            params: {
                grant_type: "authorization_code",
                client_id: process.env.HH_CLIENT_ID,
                client_secret: process.env.HH_CLIENT_SECRET,
                redirect_uri: process.env.HH_REDIRECT_URI,
                code,
            },
        });

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        // Сохраняем или обновляем пользователя в БД
        const user = await User.findOneAndUpdate(
            { telegramId },
            {
                hhAccessToken: access_token,
                hhRefreshToken: refresh_token,
                hhExpiresAt: expiresAt,
            },
            { upsert: true, new: true }
        );

        res.send(
            `Авторизация успешна! Можно закрыть это окно и вернуться в Telegram.\nTelegram ID: ${telegramId}`
        );
    } catch (error) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).send("Ошибка авторизации");
    }
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});
