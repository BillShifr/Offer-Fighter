import express, { Request, Response } from "express";
import mongoose, { Document, Model } from "mongoose";
import * as dotenv from "dotenv";
import cors from "cors";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// === Types ===
interface IUser extends Document {
    telegramId: string;
    hhAccessToken?: string;
    hhRefreshToken?: string;
    hhExpiresAt?: Date;
    resumeId?: string;
    filters?: Record<string, any>;
    subscribed?: boolean;
}

// === MongoDB ===
const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/hhbot";
mongoose
    .connect(mongoUri)
    .then(() => console.log("MongoDB connected"))
    .catch((e) => console.error("MongoDB connection error:", e));

// === Mongoose model ===
const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    hhAccessToken: String,
    hhRefreshToken: String,
    hhExpiresAt: Date,
    resumeId: String,
    filters: Object,
    subscribed: { type: Boolean, default: false },
});

const User = mongoose.model<any>("User", userSchema);

// === Вспомогательная функция для проверки и обновления токена ===
async function ensureValidToken(telegramId: string): Promise<boolean> {
    try {
        const user = await User.findOne({ telegramId });
        if (!user || !user.hhAccessToken) {
            return false;
        }

        // Проверяем, не истек ли токен (с запасом в 5 минут)
        const hasValidToken = user.hhExpiresAt && new Date(user.hhExpiresAt.getTime() - 5 * 60 * 1000) > new Date();

        if (hasValidToken) {
            return true;
        }

        // Если токен истек, пытаемся обновить
        if (!user.hhRefreshToken) {
            return false;
        }

        const tokenRes = await axios.post(
            "https://hh.ru/oauth/token",
            new URLSearchParams({
                grant_type: "refresh_token",
                client_id: process.env.HH_CLIENT_ID!,
                client_secret: process.env.HH_CLIENT_SECRET!,
                refresh_token: user.hhRefreshToken,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        await User.findOneAndUpdate(
            { telegramId },
            {
                hhAccessToken: access_token,
                hhRefreshToken: refresh_token || user.hhRefreshToken, // Если новый refresh_token не предоставлен, сохраняем старый
                hhExpiresAt: expiresAt,
            }
        );

        return true;
    } catch (error) {
        console.error("Token refresh failed:", error);
        return false;
    }
}

// === OAuth hh.ru: redirect to HH auth page ===
app.get("/auth/hh", (req: Request, res: Response) => {
    const telegramId = req.query.telegramId;
    if (!telegramId) return res.status(400).send("telegramId required");

    // Проверяем наличие обязательных переменных окружения
    if (!process.env.HH_CLIENT_ID || !process.env.HH_REDIRECT_URI) {
        return res.status(500).send("Server configuration error");
    }

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.HH_CLIENT_ID,
        redirect_uri: process.env.HH_REDIRECT_URI,
        state: String(telegramId),
    });

    res.redirect(`https://hh.ru/oauth/authorize?${params.toString()}`);
});

// === OAuth callback ===
app.get("/auth/callback", async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;
        const telegramId = String(state || "");
        if (!code || !telegramId) return res.status(400).send("Missing code or state");

        // Проверяем наличие обязательных переменных окружения
        if (!process.env.HH_CLIENT_ID || !process.env.HH_CLIENT_SECRET || !process.env.HH_REDIRECT_URI) {
            return res.status(500).send("Server configuration error");
        }

        const tokenRes = await axios.post(
            "https://hh.ru/oauth/token",
            new URLSearchParams({
                grant_type: "authorization_code",
                client_id: process.env.HH_CLIENT_ID,
                client_secret: process.env.HH_CLIENT_SECRET,
                redirect_uri: process.env.HH_REDIRECT_URI,
                code: code as string,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        await User.findOneAndUpdate(
            { telegramId },
            {
                hhAccessToken: access_token,
                hhRefreshToken: refresh_token,
                hhExpiresAt: expiresAt,
            },
            { upsert: true, new: true }
        );

        // Notify user in Telegram
        try {
            if (!process.env.BOT_TOKEN) {
                throw new Error("BOT_TOKEN is not defined");
            }

            await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                chat_id: telegramId,
                text: "✅ Авторизация на hh.ru прошла успешно!\n\nНажми кнопку ниже, чтобы начать поиск вакансий:",
                reply_markup: {
                    inline_keyboard: [[{ text: "🔍 Начать поиск", callback_data: "start_search" }]],
                },
            });
        } catch (tgErr) {
            console.error("Failed to notify user in Telegram:", (tgErr as any).response?.data || (tgErr as any).message);
        }

        res.send(`Авторизация успешна! Можно закрыть это окно и вернуться в Telegram.\nTelegram ID: ${telegramId}`);
    } catch (error) {
        console.error("OAuth callback error:", (error as any).response?.data || (error as any).message);
        res.status(500).send("Ошибка авторизации");
    }
});

// === Check if user has valid HH token ===
app.get("/user/:telegramId/has-valid-token", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user || !user.hhAccessToken) {
            return res.json({ hasValidToken: false });
        }

        // Проверяем, не истек ли токен (с запасом в 5 минут)
        const hasValidToken = user.hhExpiresAt && new Date(user.hhExpiresAt.getTime() - 5 * 60 * 1000) > new Date();
        res.json({ hasValidToken: !!hasValidToken });
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Refresh HH token ===
app.post("/user/:telegramId/refresh-token", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user || !user.hhRefreshToken) {
            return res.status(404).json({ error: "Пользователь или refresh token не найден" });
        }

        // Проверяем наличие обязательных переменных окружения
        if (!process.env.HH_CLIENT_ID || !process.env.HH_CLIENT_SECRET) {
            return res.status(500).json({ error: "Server configuration error" });
        }

        const tokenRes = await axios.post(
            "https://hh.ru/oauth/token",
            new URLSearchParams({
                grant_type: "refresh_token",
                client_id: process.env.HH_CLIENT_ID,
                client_secret: process.env.HH_CLIENT_SECRET,
                refresh_token: user.hhRefreshToken,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token, refresh_token, expires_in } = tokenRes.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        const updatedUser = await User.findOneAndUpdate(
            { telegramId: req.params.telegramId },
            {
                hhAccessToken: access_token,
                hhRefreshToken: refresh_token || user.hhRefreshToken, // Если новый refresh_token не предоставлен, сохраняем старый
                hhExpiresAt: expiresAt,
            },
            { new: true }
        );

        res.json(updatedUser);
    } catch (e) {
        console.error("Token refresh error:", (e as any).response?.data || (e as any).message);
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Get user data ===
app.get("/user/:telegramId", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Get resumes from HH for user ===
app.get("/user/:telegramId/resumes", async (req: Request, res: Response) => {
    try {
        // Проверяем и обновляем токен при необходимости
        const tokenValid = await ensureValidToken(req.params.telegramId);
        if (!tokenValid) {
            return res.status(401).json({ error: "Требуется авторизация" });
        }

        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user || !user.hhAccessToken) return res.status(404).json({ error: "Нет токена HH или пользователь" });

        const hhRes = await axios.get("https://api.hh.ru/resumes/mine", {
            headers: { Authorization: `Bearer ${user.hhAccessToken}` },
        });

        res.json(hhRes.data);
    } catch (e) {
        console.error("Error fetching resumes:", (e as any).response?.data || (e as any).message);
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Select resume for user ===
app.post("/user/:telegramId/selectResume", async (req: Request, res: Response) => {
    try {
        const { resumeId } = req.body;
        if (!resumeId) return res.status(400).json({ error: "resumeId обязателен" });

        const user = await User.findOneAndUpdate(
            { telegramId: req.params.telegramId },
            { resumeId },
            { new: true }
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Update filters ===
app.post("/user/:telegramId/filters", async (req: Request, res: Response) => {
    try {
        const filters = req.body;
        const user = await User.findOneAndUpdate(
            { telegramId: req.params.telegramId },
            { filters },
            { new: true }
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Check subscription ===
app.get("/user/:telegramId/subscription", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json({ subscribed: user.subscribed });
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Simple /search endpoint (placeholder) ===
app.post("/search", async (req: Request, res: Response) => {
    try {
        // TODO: реализовать поиск вакансий
        // Пока возвращаем заглушку
        res.json([]);
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Server ===
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});