import express, { Request, Response } from "express";
import mongoose from "mongoose";
import * as dotenv from "dotenv";
import cors from "cors";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// === Types ===
interface IUser extends mongoose.Document {
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
    filters: mongoose.Schema.Types.Mixed,
    subscribed: { type: Boolean, default: false },
});

const User = mongoose.model<any>("User", userSchema);

// Проверка обязательных переменных окружения
const requiredEnvVars = ['HH_CLIENT_ID', 'HH_CLIENT_SECRET', 'HH_REDIRECT_URI', 'BOT_TOKEN'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars);
    process.exit(1);
}

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
        console.error("Error checking token validity:", e);
        res.status(500).json({ error: (e as Error).message });
    }
});

// === OAuth hh.ru: redirect to HH auth page ===
app.get("/auth/hh", (req: Request, res: Response) => {
    const telegramId = req.query.telegramId;
    if (!telegramId) return res.status(400).send("telegramId required");

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.HH_CLIENT_ID!,
        redirect_uri: process.env.HH_REDIRECT_URI!,
        state: String(telegramId),
    });

    res.redirect(`https://hh.ru/oauth/authorize?${params.toString()}`);
});

// === OAuth callback ===
app.get("/auth/callback", async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;
        const telegramId = String(state || "");

        if (!code || typeof code !== 'string' || !telegramId) {
            return res.status(400).send("Missing or invalid code or state");
        }

        const tokenResponse = await axios.post(
            "https://hh.ru/oauth/token",
            new URLSearchParams({
                grant_type: "authorization_code",
                client_id: process.env.HH_CLIENT_ID!,
                client_secret: process.env.HH_CLIENT_SECRET!,
                redirect_uri: process.env.HH_REDIRECT_URI!,
                code: code,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const { access_token, refresh_token, expires_in } = tokenResponse.data;
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
    } catch (error: any) {
        console.error("OAuth callback error:", error.response?.data || error.message);
        res.status(500).send("Ошибка авторизации");
    }
});

// === Get resumes from HH for user ===
app.get("/user/:telegramId/resumes", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user || !user.hhAccessToken) {
            return res.status(404).json({ error: "Нет токена HH или пользователь" });
        }

        const hhRes = await axios.get("https://api.hh.ru/resumes/mine", {
            headers: { Authorization: `Bearer ${user.hhAccessToken}` },
        });

        // HH API возвращает объект с items
        const resumes = hhRes.data.items || [];
        res.json(resumes);
    } catch (error: any) {
        console.error("Error fetching resumes:", error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

// === Check subscription ===
app.get("/user/:telegramId/subscription", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({ telegramId: req.params.telegramId });
        if (!user) return res.status(404).json({ error: "Пользователь не найден" });
        res.json({ subscribed: user.subscribed });
    } catch (error: any) {
        console.error("Error checking subscription:", error);
        res.status(500).json({ error: error.message });
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
        const user = await User.findOne({ telegramId });
        if (!user || !user.hhAccessToken) {
            return res.status(401).json({ error: "Требуется авторизация" });
        }

        // Формируем параметры запроса к HH API
        const params: Record<string, any> = {
            text: keywords,
            area: region,
            schedule: workSchedule,
            employment: employmentType,
            specialization: professionalArea,
            per_page: 20
        };

        // Удаляем пустые параметры
        Object.keys(params).forEach(key => {
            if (params[key] === undefined || params[key] === null || params[key] === "ANY") {
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
    } catch (error: any) {
        console.error("Ошибка поиска:", error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

// === Server ===
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});