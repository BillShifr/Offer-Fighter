import express, {Request, Response} from "express";
import mongoose, {Document} from "mongoose";
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
    telegramId: {type: String, required: true, unique: true},
    hhAccessToken: String,
    hhRefreshToken: String,
    hhExpiresAt: Date,
    resumeId: String,
    filters: Object,
    subscribed: {type: Boolean, default: false},
});

const User = mongoose.model<any>("User", userSchema);

// === Проверка валидности токена ===
const isTokenValid = (expiresAt: Date): boolean => {
    return expiresAt && new Date(expiresAt) > new Date();
};

// === Обновление токена ===
const refreshToken = async (refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number
} | null> => {
    try {
        const response = await axios.post(
            "https://hh.ru/oauth/token",
            new URLSearchParams({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: process.env.HH_CLIENT_ID || "",
                client_secret: process.env.HH_CLIENT_SECRET || "",
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error("Token refresh error:", error);
        return null;
    }
};

// === Получение пользователя с валидным токеном ===
const getUserWithValidToken = async (telegramId: string): Promise<IUser | null> => {
    try {
        const user = await User.findOne({telegramId});
        if (!user || !user.hhAccessToken || !user.hhRefreshToken) return null;

        // Проверяем, не истек ли токен
        if (user.hhExpiresAt && isTokenValid(user.hhExpiresAt)) {
            return user;
        }

        // Если токен истек, пытаемся обновить
        const newTokenData = await refreshToken(user.hhRefreshToken);
        if (!newTokenData) return null;

        // Обновляем токен в базе
        const expiresAt = new Date(Date.now() + newTokenData.expires_in * 1000);
        await User.findOneAndUpdate(
            {telegramId},
            {
                hhAccessToken: newTokenData.access_token,
                hhRefreshToken: newTokenData.refresh_token,
                hhExpiresAt: expiresAt,
            }
        );

        return {
            ...user.toObject(),
            hhAccessToken: newTokenData.access_token,
            hhRefreshToken: newTokenData.refresh_token,
            hhExpiresAt: expiresAt,
        } as IUser;
    } catch (error) {
        console.error("Error getting user with valid token:", error);
        return null;
    }
};

// === Проверка авторизации ===
app.get("/user/:telegramId/auth-status", async (req: Request, res: Response) => {
    try {
        const user = await getUserWithValidToken(req.params.telegramId);
        res.json({isAuthenticated: !!user});
    } catch (e) {
        res.status(500).json({error: (e as Error).message});
    }
});

// === OAuth hh.ru: redirect to HH auth page ===
app.get("/auth/hh", (req: Request, res: Response) => {
    const telegramId = req.query.telegramId;
    if (!telegramId) return res.status(400).send("telegramId required");

    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.HH_CLIENT_ID || "",
        redirect_uri: process.env.HH_REDIRECT_URI || "",
        state: String(telegramId),
    });

    res.redirect(`https://hh.ru/oauth/authorize?${params.toString()}`);
});

// === OAuth callback ===
app.get("/auth/callback", async (req: Request, res: Response) => {
    try {
        const {code, state} = req.query;
        const telegramId = String(state || "");
        if (!code || !telegramId) return res.status(400).send("Missing code or state");

        const tokenRes = await axios.post(
            "https://hh.ru/oauth/token",
            new URLSearchParams({
                grant_type: "authorization_code",
                client_id: process.env.HH_CLIENT_ID || "",
                client_secret: process.env.HH_CLIENT_SECRET || "",
                redirect_uri: process.env.HH_REDIRECT_URI || "",
                code: code as string,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            }
        );

        const {access_token, refresh_token, expires_in} = tokenRes.data;
        const expiresAt = new Date(Date.now() + expires_in * 1000);

        await User.findOneAndUpdate(
            {telegramId},
            {
                hhAccessToken: access_token,
                hhRefreshToken: refresh_token,
                hhExpiresAt: expiresAt,
            },
            {upsert: true, new: true}
        );

        // Notify user in Telegram
        try {
            await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                chat_id: telegramId,
                text: "✅ Авторизация на hh.ru прошла успешно!\n\nНажми кнопку ниже, чтобы начать поиск вакансий:",
                reply_markup: {
                    inline_keyboard: [[{text: "🔍 Начать поиск", callback_data: "start_search"}]],
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

// === Get user data ===
app.get("/user/:telegramId", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({telegramId: req.params.telegramId});
        if (!user) return res.status(404).json({error: "Пользователь не найден"});
        res.json(user);
    } catch (e) {
        res.status(500).json({error: (e as Error).message});
    }
});

// === Get resumes from HH for user ===
app.get("/user/:telegramId/resumes", async (req: Request, res: Response) => {
    try {
        const user = await getUserWithValidToken(req.params.telegramId);
        if (!user) return res.status(401).json({error: "Требуется авторизация"});

        const hhRes = await axios.get("https://api.hh.ru/resumes/mine", {
            headers: {Authorization: `Bearer ${user.hhAccessToken}`},
        });

        // HH API возвращает объект с items
        const resumes = hhRes.data.items || [];
        res.json(resumes);
    } catch (e) {
        console.error("Error fetching resumes:", (e as any).response?.data || (e as any).message);

        if ((e as any).response?.status === 401) {
            // Токен недействителен, даже после попытки обновления
            res.status(401).json({error: "Требуется повторная авторизация"});
        } else {
            res.status(500).json({error: (e as Error).message});
        }
    }
});

// === Select resume for user ===
app.post("/user/:telegramId/selectResume", async (req: Request, res: Response) => {
    try {
        const {resumeId} = req.body;
        if (!resumeId) return res.status(400).json({error: "resumeId обязателен"});

        const user = await User.findOneAndUpdate(
            {telegramId: req.params.telegramId},
            {resumeId},
            {new: true}
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({error: (e as Error).message});
    }
});

// === Update filters ===
app.post("/user/:telegramId/filters", async (req: Request, res: Response) => {
    try {
        const filters = req.body;
        const user = await User.findOneAndUpdate(
            {telegramId: req.params.telegramId},
            {filters},
            {new: true}
        );
        res.json(user);
    } catch (e) {
        res.status(500).json({error: (e as Error).message});
    }
});

// === Check subscription ===
app.get("/user/:telegramId/subscription", async (req: Request, res: Response) => {
    try {
        const user = await User.findOne({telegramId: req.params.telegramId});
        if (!user) return res.status(404).json({error: "Пользователь не найден"});
        res.json({subscribed: user.subscribed});
    } catch (e) {
        res.status(500).json({error: (e as Error).message});
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

        // Находим пользователя с валидным токеном
        const user = await getUserWithValidToken(telegramId);
        if (!user) {
            return res.status(401).json({error: "Требуется авторизация"});
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
            headers: {Authorization: `Bearer ${user.hhAccessToken}`},
            params
        });

        // Возвращаем результаты поиска
        res.json(hhRes.data.items || []);
    } catch (error: any) {
        console.error("Ошибка поиска:", error.response?.data || error.message);
        res.status(500).json({error: error.message});
    }
});

// === Server ===
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
});