import express, { Request, Response } from "express";
import mongoose, { Document } from "mongoose";
import * as dotenv from "dotenv";
import cors from "cors";
import axios from "axios";
import { ParsedQs } from "qs";

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

// === OAuth hh.ru: redirect to HH auth page ===
app.get("/auth/hh", (req: Request, res: Response) => {
    const telegramId = req.query.telegramId;
    if (!telegramId) return res.status(400).send("telegramId required");

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

        // Проверка типов
        if (!code || typeof code !== 'string' || !telegramId) {
            return res.status(400).send("Missing or invalid code or state");
        }

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
                code: code,
            })
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
            await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                chat_id: telegramId,
                text: "✅ Авторизация на hh.ru прошла успешно!\n\nНажми кнопку ниже, чтобы начать поиск вакансий:",
                reply_markup: {
                    inline_keyboard: [[{ text: "🔍 Начать поиск", callback_data: "start_search" }]],
                },
            });
        } catch (tgErr) {
            console.error("Failed to notify user in Telegram:", tgErr);
        }

        res.send(`Авторизация успешна! Можно закрыть это окно и вернуться в Telegram.\nTelegram ID: ${telegramId}`);
    } catch (error) {
        console.error("OAuth callback error:", error);
        res.status(500).send("Ошибка авторизации");
    }
});

// === Get resumes from HH for user ===
app.get("/user/:telegramId/resumes", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId }) as IUser;
        if (!user || !user.hhAccessToken) return res.status(404).json({ error: "Нет токена HH или пользователь" });

        const hhRes = await axios.get("https://api.hh.ru/resumes/mine", {
            headers: { Authorization: `Bearer ${user.hhAccessToken}` },
        });

        // HH API возвращает объект с items
        const resumes = hhRes.data.items || [];
        res.json(resumes);
    } catch (e) {
        console.error("Error fetching resumes:", e);
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Check subscription ===
app.get("/user/:telegramId/subscription", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId }) as IUser;
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json({ subscribed: user.subscribed });
    } catch (e) {
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Real search endpoint ===
app.post("/search", async (req: Request, res: Response) => {
    try {
        const {
            telegramId,
            resumeId,
            region,
            workSchedule,
            employmentType,
            professionalArea,
            keywords,
            coverLetter
        } = req.body;

        // Находим пользователя
        const user = await User.findOne({ telegramId }) as IUser;
        if (!user || !user.hhAccessToken) {
            return res.status(401).json({ error: "Требуется авторизация" });
        }

        // Формируем параметры запроса к HH API
        const params: any = {
            text: keywords,
            area: region,
            schedule: workSchedule,
            employment: employmentType,
            specialization: professionalArea,
            per_page: 20 // Ограничиваем количество результатов
        };

        // Удаляем пустые параметры
        Object.keys(params).forEach(key => {
            if (!params[key] || params[key] === "ANY") {
                delete params[key];
            }
        });

        console.log("Параметры поиска:", params);

        // Выполняем поиск через HH API
        const hhRes = await axios.get("https://api.hh.ru/vacancies", {
            headers: { Authorization: `Bearer ${user.hhAccessToken}` },
            params
        });

        // Возвращаем результаты поиска
        res.json(hhRes.data.items || []);
    } catch (e) {
        console.error("Ошибка поиска:", e);
        res.status(500).json({ error: (e as Error).message });
    }
});

// === Server ===
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});